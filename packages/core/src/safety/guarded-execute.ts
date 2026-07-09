/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────
 *  guardedExecute — THE SINGLE EXECUTION SPINE
 * ─────────────────────────────────────────────────────────────────────────
 *
 * Every trade the SDK executes runs through here, passing the SAME deterministic
 * gates in the SAME order:
 *
 *   kill-switch → idempotency/no-double-execute → mint sanity → per-tx cap →
 *   daily cap → SOL-for-fees → freshness (stale decision + dead price feed) →
 *   rug gate (optional) → leg dispatch (post-gate fill venue).
 *
 * There is NO public path that reaches a fill venue without going through this
 * method. A forker adds a venue by implementing `ExecutorLeg` — and it is STILL
 * behind every gate. This is the moat and the safety guarantee: the safe thing
 * is easy and the unsafe thing is not exposed.
 */

import type { ExecutorLeg, LegContext } from "../interfaces/leg";
import type { RpcProvider } from "../interfaces/rpc";
import type { Signer } from "../interfaces/signer";
import type { PriceSource, QuoteSource, RugChecker } from "../interfaces/data";
import type { Store } from "../interfaces/store";
import type { Notifier } from "../interfaces/notifier";
import type { BlockReason, ExecutionStatus, FillResult, TradeSurface } from "../types";
import { SOL_MINT } from "../types";
import { SafetyConfig } from "./config";

const MINT_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

/** A trade to run through the spine. Caps are MANDATORY; there is no uncapped path. */
export interface GuardedTrade {
  userId: string;
  surface?: TradeSurface;
  /** Fill venue name. Defaults to "jupiter". The leg runs only after every gate passes. */
  leg?: string;
  side?: "buy" | "sell";
  inputMint: string;
  outputMint: string;
  /** USD notional the per-tx + daily caps are checked against. */
  amountUsd: number;
  /** Exact atomic input amount for token-denominated trades (e.g. "sell 10 SOL"). */
  inputAmountAtomic?: string;
  maxPerTxUsd: number;
  dailyCapUsd: number;
  slippageBps?: number;
  /** Rug gate — off by default (score still recorded). See SafetyConfig. */
  rugGate?: boolean;
  /** Acknowledge a warn-band rug score to proceed. Never bypasses a hard block. */
  allowRisky?: boolean;
  /**
   * Repositioning EXISTING funds (rebalance/withdrawal), not new spend. Skips the
   * per-tx + daily cap check + the daily-spend record — every OTHER gate
   * (kill-switch, idempotency, freshness, …) stays unconditional.
   */
  repositionExistingFunds?: boolean;
  /** When the decision was made — the freshness gate blocks if it's too old. */
  evaluatedAtMs?: number;
  /** Deterministic idempotency key — the same key can never double-execute. */
  idempotencyKey: string;
  /** The signer whose custodial wallet funds + signs this trade. */
  signer: Signer;
}

export interface GuardedResult {
  status: ExecutionStatus;
  blockedBy?: BlockReason;
  reason?: string;
  auditId?: string;
  txHash?: string;
  fill?: FillResult;
  slippageBps?: number;
  rugScore?: number;
}

export interface SpineDeps {
  rpc: RpcProvider;
  store: Store;
  prices: PriceSource;
  quotes: QuoteSource;
  rug: RugChecker;
  notifier: Notifier;
  legs: Map<string, ExecutorLeg>;
  config: SafetyConfig;
}

export class GuardedExecutor {
  constructor(private readonly deps: SpineDeps) {}

  private resolveSlippage(trade: GuardedTrade): number {
    const { slippageFloorBps, slippageCeilBps, defaultSlippageBps } = this.deps.config;
    const bps = typeof trade.slippageBps === "number" && trade.slippageBps > 0 ? trade.slippageBps : defaultSlippageBps;
    return Math.max(slippageFloorBps, Math.min(slippageCeilBps, Math.round(bps)));
  }

  private async recordBlocked(trade: GuardedTrade, blockedBy: BlockReason, reason: string, slippageBps: number, rugScore?: number): Promise<string> {
    return this.deps.store.recordAudit({
      userId: trade.userId,
      surface: String(trade.surface ?? "sdk"),
      inputMint: trade.inputMint,
      outputMint: trade.outputMint,
      amountUsd: trade.amountUsd,
      slippageBps,
      status: "BLOCKED",
      blockedBy,
      rugScore,
      errorMessage: reason.slice(0, 300),
    });
  }

  /** The ONE way to execute a trade. */
  async execute(trade: GuardedTrade): Promise<GuardedResult> {
    const { store, rpc, prices, rug, config } = this.deps;
    const slippageBps = this.resolveSlippage(trade);

    // ── 1. Kill switch (unconditional, every path) ────────────────────────────
    if (await store.isKillSwitchEnabled()) {
      const reason = (await store.getKillSwitchReason()) ?? "System-wide kill switch is enabled.";
      const id = await this.recordBlocked(trade, "kill_switch", reason, slippageBps);
      return { status: "blocked", blockedBy: "kill_switch", reason, auditId: id, slippageBps };
    }

    // ── 2. Idempotency / no-double-execute ────────────────────────────────────
    const guard = await store.beginGuard(trade.idempotencyKey);
    if (guard.decision === "done") {
      return { status: "noop", reason: "Already executed (idempotent).", auditId: guard.executionId, slippageBps };
    }
    if (guard.decision === "confirm" && guard.sentSig) {
      return { status: "noop", blockedBy: "inflight", reason: "A transaction for this action is already in flight.", txHash: guard.sentSig, slippageBps };
    }
    if (guard.decision === "failed") {
      return { status: "failed", reason: guard.errorMessage ?? "Prior attempt failed.", auditId: guard.executionId, slippageBps };
    }

    try {
      // ── 3. Mint sanity ──────────────────────────────────────────────────────
      if (!MINT_RE.test(trade.inputMint) || !MINT_RE.test(trade.outputMint) || trade.inputMint === trade.outputMint) {
        const id = await this.recordBlocked(trade, "not_whitelisted", "Invalid or identical token mints", slippageBps);
        await store.failGuard(trade.idempotencyKey, "not_whitelisted", id);
        return { status: "blocked", blockedBy: "not_whitelisted", reason: "Those token mints look invalid.", auditId: id, slippageBps };
      }

      // ── 4 + 4b. Spend caps (skipped ONLY when repositioning existing funds) ───
      if (!trade.repositionExistingFunds) {
        if (!(trade.amountUsd > 0) || trade.amountUsd > trade.maxPerTxUsd) {
          const reason = `Amount $${trade.amountUsd} exceeds the per-trade cap of $${trade.maxPerTxUsd}.`;
          const id = await this.recordBlocked(trade, "over_caps", reason, slippageBps);
          await store.failGuard(trade.idempotencyKey, "over_caps", id);
          return { status: "blocked", blockedBy: "over_caps", reason, auditId: id, slippageBps };
        }
        const daily = await store.checkDailySpend(trade.userId, trade.amountUsd, trade.dailyCapUsd);
        if (!daily.allowed) {
          const reason = `This would exceed your daily cap of $${trade.dailyCapUsd} (spent $${daily.spent.toFixed(2)}, $${daily.remaining.toFixed(2)} left today).`;
          const id = await this.recordBlocked(trade, "over_daily_cap", reason, slippageBps);
          await store.failGuard(trade.idempotencyKey, "over_daily_cap", id);
          return { status: "blocked", blockedBy: "over_daily_cap", reason, auditId: id, slippageBps };
        }
      }

      // ── 5. SOL for fees ───────────────────────────────────────────────────────
      const walletPubkey = await trade.signer.publicKey();
      const lamports = await rpc.getBalanceLamports(walletPubkey);
      if (lamports < config.minSolForFeesLamports) {
        const reason = "Not enough SOL in the wallet to cover network fees.";
        const id = await this.recordBlocked(trade, "insufficient_sol", reason, slippageBps);
        await store.failGuard(trade.idempotencyKey, "insufficient_sol", id);
        return { status: "blocked", blockedBy: "insufficient_sol", reason, auditId: id, slippageBps };
      }

      // ── 6. Freshness — stale decision ─────────────────────────────────────────
      if (trade.evaluatedAtMs && Date.now() - trade.evaluatedAtMs > config.maxStalenessMs) {
        const ageSec = Math.round((Date.now() - trade.evaluatedAtMs) / 1000);
        const reason = `Decision is ${ageSec}s old — too stale to trade on. Re-confirm.`;
        const id = await this.recordBlocked(trade, "stale_trigger", reason, slippageBps);
        await store.failGuard(trade.idempotencyKey, "stale_trigger", id);
        return { status: "blocked", blockedBy: "stale_trigger", reason, auditId: id, slippageBps };
      }
      // ── 6b. Freshness — dead price feed (refuse to trade blind) ───────────────
      const freshPrice = await prices.getPriceUsd(trade.outputMint).catch(() => 0);
      if (!(freshPrice > 0)) {
        const reason = "No live price for that token — refusing to trade blind.";
        const id = await this.recordBlocked(trade, "stale_price", reason, slippageBps);
        await store.failGuard(trade.idempotencyKey, "stale_price", id);
        return { status: "blocked", blockedBy: "stale_price", reason, auditId: id, slippageBps };
      }

      // ── 7. Rug gate (OFF by default — score always recorded, only blocks opt-in) ─
      const assessment = await rug.checkToken(trade.outputMint).catch(() => ({ score: 100, flags: [] }));
      if (trade.rugGate && (assessment.score < config.rugHardBlock || (assessment.score < config.rugWarn && !trade.allowRisky))) {
        const reason = assessment.score < config.rugHardBlock
          ? `Blocked by rug detector (${assessment.score}/100): ${assessment.flags.join("; ")}`
          : `Risky token (${assessment.score}/100). Re-confirm with risk acknowledged to proceed.`;
        const id = await this.recordBlocked(trade, "rug", reason, slippageBps, assessment.score);
        await store.failGuard(trade.idempotencyKey, "rug", id);
        return { status: "blocked", blockedBy: "rug", reason, auditId: id, slippageBps, rugScore: assessment.score };
      }

      // ── 8. Leg dispatch (post-gate fill) ──────────────────────────────────────
      const legName = trade.leg ?? "jupiter";
      const leg = this.deps.legs.get(legName);
      if (!leg) {
        const reason = `No executor leg registered for "${legName}".`;
        const id = await this.recordBlocked(trade, "internal", reason, slippageBps, assessment.score);
        await store.failGuard(trade.idempotencyKey, "internal", id);
        return { status: "failed", blockedBy: "internal", reason, auditId: id, slippageBps };
      }

      const ctx: LegContext = {
        inputMint: trade.inputMint,
        outputMint: trade.outputMint,
        side: trade.side ?? "buy",
        amountUsd: trade.amountUsd,
        inputAmountAtomic: trade.inputAmountAtomic,
        slippageBps,
        signer: trade.signer,
        rpc: this.deps.rpc,
        quotes: this.deps.quotes,
        prices: this.deps.prices,
        onBroadcast: async (sig) => { await store.recordSentSig(trade.idempotencyKey, sig); },
      };

      const fill = await leg.fill(ctx);

      if (!fill.success) {
        if (fill.errorCode === "CONFIRMATION_UNKNOWN") {
          // Broadcast but unconfirmed — never re-send. Leave the guard SENT to reconcile.
          return { status: "noop", blockedBy: "inflight", reason: "Transaction broadcast but unconfirmed — not re-sending.", txHash: fill.txHash, slippageBps };
        }
        const id = await this.deps.store.recordAudit({
          userId: trade.userId, surface: String(trade.surface ?? "sdk"), inputMint: trade.inputMint, outputMint: trade.outputMint,
          amountUsd: trade.amountUsd, slippageBps, status: "FAILED", txHash: fill.txHash, rugScore: assessment.score, errorMessage: (fill.error ?? fill.errorCode ?? "fill_failed").slice(0, 300),
        });
        await store.failGuard(trade.idempotencyKey, fill.error ?? "fill_failed", id);
        return { status: "failed", reason: fill.error ?? "Fill failed.", auditId: id, txHash: fill.txHash, fill, slippageBps };
      }

      const id = await this.deps.store.recordAudit({
        userId: trade.userId, surface: String(trade.surface ?? "sdk"), inputMint: trade.inputMint, outputMint: trade.outputMint,
        amountUsd: trade.amountUsd, slippageBps, status: "EXECUTED", txHash: fill.txHash, rugScore: assessment.score,
      });
      await store.completeGuard(trade.idempotencyKey, id);
      // Repositioning existing funds is not new spend — don't consume the daily envelope.
      if (!trade.repositionExistingFunds) await store.recordDailySpend(trade.userId, trade.amountUsd).catch(() => undefined);
      await this.deps.notifier.send({
        level: "success",
        title: `Executed ${trade.side ?? "buy"} ~$${trade.amountUsd} ${trade.outputMint.slice(0, 6)}…`,
        txHash: fill.txHash,
        dedupeKey: `exec:${id}`,
      }).catch(() => undefined);
      return { status: "executed", auditId: id, txHash: fill.txHash, fill, slippageBps, rugScore: assessment.score };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const id = await this.recordBlocked(trade, "internal", msg, slippageBps).catch(() => undefined);
      await store.failGuard(trade.idempotencyKey, msg, id).catch(() => undefined);
      return { status: "failed", blockedBy: "internal", reason: msg, auditId: id, slippageBps };
    }
  }
}

export const SOL = SOL_MINT;
