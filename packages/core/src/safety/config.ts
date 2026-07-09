/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

/** Tunable thresholds for the safety spine. Every one has a safe default. */
export interface SafetyConfig {
  /** Min lamports the wallet must hold for fees before any trade. */
  minSolForFeesLamports: number;
  /** A decision older than this (ms) is too stale to trade on. */
  maxStalenessMs: number;
  /** Slippage clamp, basis points. Dynamic/explicit slippage is bounded to [floor, ceil]. */
  slippageFloorBps: number;
  slippageCeilBps: number;
  /** Default slippage when none is supplied. */
  defaultSlippageBps: number;
  /** Rug score below this hard-blocks (when the rug gate is on). */
  rugHardBlock: number;
  /** Rug score below this warns (blocks unless allowRisky). */
  rugWarn: number;
  /** How long to poll a broadcast signature before giving up (never blind re-send). */
  confirmTimeoutMs: number;
}

export const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  minSolForFeesLamports: 10_000_000, // 0.01 SOL
  maxStalenessMs: 120_000, // 2 min
  slippageFloorBps: 10,
  slippageCeilBps: 300,
  defaultSlippageBps: 50,
  rugHardBlock: 40,
  rugWarn: 70,
  confirmTimeoutMs: 60_000,
};
