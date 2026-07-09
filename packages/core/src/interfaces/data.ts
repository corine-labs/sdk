/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RugAssessment } from "../types";

/**
 * PriceSource — live USD prices. The freshness gate REFUSES to trade when this
 * returns 0/unavailable ("no live price ⇒ don't trade blind"), so a correct
 * implementation must return 0 (not a stale cache) when it genuinely can't price
 * a token. Default: `JupiterData` (bring your own optional Jupiter key).
 */
export interface PriceSource {
  /** Live USD price of a mint. Return 0 when unavailable — the gate treats 0 as "refuse". */
  getPriceUsd(mint: string): Promise<number>;
}

/** A Jupiter-style route quote the jupiter leg fills against. */
export interface SwapQuote {
  inputMint: string;
  outputMint: string;
  /** Atomic input amount (base units) the quote priced. */
  inAmount: string;
  /** Atomic output amount (base units) expected. */
  outAmount: string;
  /** Opaque venue payload the leg passes back to build the swap tx. */
  raw: unknown;
}

/**
 * QuoteSource — produces an executable quote + can convert a USD notional to an
 * atomic input amount. The jupiter leg uses this to size + price a swap.
 */
export interface QuoteSource {
  /** Atomic input amount for a USD notional of `inputMint`. */
  atomicInputForUsd(inputMint: string, usdNotional: number): Promise<number>;
  /** A routable quote. Throws if no route exists (routability is proven here). */
  getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps: number;
  }): Promise<SwapQuote>;
}

/**
 * RugChecker — the optional rug gate's assessor. It always RUNS (the score is
 * recorded + returned so a UI can surface it); it only BLOCKS when the caller
 * opts in via `rugGate: true`. Default: `NoopRugChecker` (returns a safe score)
 * — swap in your own on-chain heuristics or a provider.
 */
export interface RugChecker {
  checkToken(mint: string, opts?: { liquidityUsdOverride?: number }): Promise<RugAssessment>;
}
