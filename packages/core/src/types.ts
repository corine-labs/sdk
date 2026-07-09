/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Well-known Solana mints used across the runtime. */
export const SOL_MINT = "So11111111111111111111111111111111111111112";
export const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Where an execution originated. Purely informational — every surface passes the same gate stack. */
export type TradeSurface = "cli" | "sdk" | "agent" | "web" | "telegram" | string;

/**
 * The single set of reasons the guarded spine can refuse to execute. Every one
 * of these is a deterministic gate — not a heuristic. `internal` is the only
 * non-gate reason (an unexpected error before any funds moved).
 */
export type BlockReason =
  | "kill_switch"
  | "not_whitelisted"
  | "over_caps"
  | "over_daily_cap"
  | "below_min"
  | "insufficient_sol"
  | "stale_trigger"
  | "stale_price"
  | "rug"
  | "inflight"
  | "internal";

/** Terminal status of a guarded execution. */
export type ExecutionStatus = "executed" | "blocked" | "failed" | "noop";

/** The result of a swap fill, returned by an ExecutorLeg. */
export interface FillResult {
  success: boolean;
  txHash?: string;
  /** Filled input amount, UI units (best-effort — a leg may not parse it). */
  inputAmount?: number;
  /** Filled output amount, UI units. */
  outputAmount?: number;
  inputAmountUsd?: number;
  outputAmountUsd?: number;
  /** Machine-readable error code when success is false. */
  errorCode?: string;
  error?: string;
}

/** A recorded rug/safety assessment of a token. */
export interface RugAssessment {
  /** 0–100. Higher is safer. */
  score: number;
  /** Human-readable flags that lowered the score. */
  flags: string[];
}
