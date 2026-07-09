/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { FillResult } from "../types";
import type { Signer } from "./signer";
import type { RpcProvider } from "./rpc";
import type { QuoteSource, PriceSource } from "./data";

/**
 * The context a leg receives AFTER the gate stack has passed. A leg never sees
 * an ungated trade — `guardedExecute` builds this context only once kill-switch,
 * idempotency, caps, freshness and (optionally) rug have all cleared.
 */
export interface LegContext {
  inputMint: string;
  outputMint: string;
  /** Trade side (meaningful for curve/venue legs). */
  side: "buy" | "sell";
  /** USD notional the caps were checked against. */
  amountUsd: number;
  /** Exact atomic input amount when the caller specified one (token-denominated trades). */
  inputAmountAtomic?: string;
  slippageBps: number;
  signer: Signer;
  rpc: RpcProvider;
  quotes: QuoteSource;
  prices: PriceSource;
  /**
   * Fires the instant a transaction is broadcast — BEFORE confirmation — so the
   * spine records the signature to the idempotency guard and never re-sends it.
   * A leg MUST call this as soon as it has a signature.
   */
  onBroadcast: (signature: string) => Promise<void>;
}

/**
 * ExecutorLeg — a pluggable fill venue. The ONLY way a leg runs is via
 * `guardedExecute` after every applicable gate has passed; there is no public
 * entry point that reaches a leg directly. Register legs on the runtime by name
 * (`"jupiter"`, `"pump_curve"`, …); the default build ships the `jupiter` leg.
 *
 * This is the moat: a forker adds a venue by implementing `ExecutorLeg`, and it
 * is STILL behind the full gate stack — you cannot bolt on an unguarded path.
 */
export interface ExecutorLeg {
  /** Stable name used to route to this leg (matches GuardedTrade.leg). */
  readonly name: string;
  /** Fill the (already-gated) trade. Must call ctx.onBroadcast on first signature. */
  fill(ctx: LegContext): Promise<FillResult>;
}
