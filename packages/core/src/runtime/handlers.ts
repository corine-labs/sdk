/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AgentTypeHandler, AgentContext, TradeProposal } from "./registry";
import type { ResolvedStrategy } from "../schema";

/**
 * Built-in, spine-native agent handlers. Each only PROPOSES a trade — the
 * runtime executes it through `guardedExecute`. They need nothing but a price
 * feed, so they are safe defaults a forker can rely on. Protocol-specific types
 * (yield, LP, perps, prediction) are registered as plugins, not baked in.
 */

const dayBucket = (now: number) => new Date(now).toISOString().slice(0, 10);

/** DCA — buy a fixed USD amount every interval. */
export const dcaHandler: AgentTypeHandler = {
  type: "DCA",
  async evaluate(strategy: ResolvedStrategy, ctx: AgentContext): Promise<TradeProposal | null> {
    const intervalMs = (strategy.intervalSeconds ?? 86_400) * 1000;
    const last = Number(ctx.state.lastBuyAt ?? 0);
    if (ctx.now - last < intervalMs) return null;
    ctx.state.lastBuyAt = ctx.now;
    const slot = Math.floor(ctx.now / intervalMs);
    return {
      side: "buy",
      inputMint: strategy.inputMint,
      outputMint: strategy.outputMint,
      amountUsd: strategy.amountUsd,
      idempotencySuffix: `dca:${slot}`,
      reason: `DCA buy $${strategy.amountUsd} of ${strategy.outputMint.slice(0, 6)}`,
    };
  },
};

/** DIP_BUYER — buy when the token trades at/below a price threshold (once per day). */
export const dipBuyerHandler: AgentTypeHandler = {
  type: "DIP_BUYER",
  async evaluate(strategy: ResolvedStrategy, ctx: AgentContext): Promise<TradeProposal | null> {
    if (strategy.priceThresholdUsd == null) return null;
    const price = await ctx.prices.getPriceUsd(strategy.outputMint).catch(() => 0);
    if (!(price > 0) || price > strategy.priceThresholdUsd) return null;
    const bucket = dayBucket(ctx.now);
    if (ctx.state.lastDipBucket === bucket) return null; // one dip buy per day
    ctx.state.lastDipBucket = bucket;
    return {
      side: "buy",
      inputMint: strategy.inputMint,
      outputMint: strategy.outputMint,
      amountUsd: strategy.amountUsd,
      idempotencySuffix: `dip:${bucket}`,
      reason: `Dip buy: price $${price.toPrecision(4)} ≤ threshold $${strategy.priceThresholdUsd}`,
    };
  },
};

/** LIMIT_ORDER — buy once when price crosses at/below the threshold, then stop. */
export const limitOrderHandler: AgentTypeHandler = {
  type: "LIMIT_ORDER",
  async evaluate(strategy: ResolvedStrategy, ctx: AgentContext): Promise<TradeProposal | null> {
    if (strategy.priceThresholdUsd == null || ctx.state.filled) return null;
    const price = await ctx.prices.getPriceUsd(strategy.outputMint).catch(() => 0);
    if (!(price > 0) || price > strategy.priceThresholdUsd) return null;
    ctx.state.filled = true;
    return {
      side: "buy",
      inputMint: strategy.inputMint,
      outputMint: strategy.outputMint,
      amountUsd: strategy.amountUsd,
      idempotencySuffix: `limit:${strategy.priceThresholdUsd}`,
      reason: `Limit fill at $${price.toPrecision(4)}`,
    };
  },
};

/**
 * LADDERED_EXIT — sell rungs as price multiples of the entry are hit. Sells are
 * repositioning existing funds, so the runtime skips the spend cap on them.
 * Requires `state.entryPriceUsd` (set when the position was opened).
 */
export const ladderedExitHandler: AgentTypeHandler = {
  type: "LADDERED_EXIT",
  async evaluate(strategy: ResolvedStrategy, ctx: AgentContext): Promise<TradeProposal | null> {
    const rungs = strategy.ladder;
    const entry = Number(ctx.state.entryPriceUsd ?? 0);
    if (!rungs || rungs.length === 0 || !(entry > 0)) return null;
    const done = new Set<number>((ctx.state.executedRungs as number[]) ?? []);
    const price = await ctx.prices.getPriceUsd(strategy.outputMint).catch(() => 0);
    if (!(price > 0)) return null;
    const idx = rungs.findIndex((r, i) => !done.has(i) && price >= entry * r.multiplier);
    if (idx === -1) return null;
    const rung = rungs[idx]!;
    done.add(idx);
    ctx.state.executedRungs = [...done];
    const sellUsd = (strategy.amountUsd * rung.sellPercent) / 100;
    return {
      side: "sell",
      inputMint: strategy.outputMint,
      outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
      amountUsd: sellUsd,
      repositionExistingFunds: true,
      idempotencySuffix: `ladder:rung${idx}`,
      reason: `Ladder rung ${rung.multiplier}× hit at $${price.toPrecision(4)} — sell ${rung.sellPercent}%`,
    };
  },
};

/** The default handler set registered by `createCorine`. */
export const BUILTIN_HANDLERS: AgentTypeHandler[] = [
  dcaHandler,
  dipBuyerHandler,
  limitOrderHandler,
  ladderedExitHandler,
];
