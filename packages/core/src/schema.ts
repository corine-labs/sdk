/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import { z } from "zod";

/**
 * The agent types the core runtime understands. This is a standalone union —
 * decoupled from any database enum — so the SDK owns its own public surface.
 * Register your own types on the runtime's agent-type registry; these are the
 * spine-native ones shipped by default.
 */
export const AGENT_TYPES = [
  "DCA",
  "DIP_BUYER",
  "LIMIT_ORDER",
  "LADDERED_EXIT",
  "WALLET_COPY",
  "CUSTOM",
] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

/**
 * Caps are MANDATORY. There is no "uncapped" agent — a per-trade cap and a daily
 * cap are the second and third backstops on a custodial key, and the spine
 * refuses to execute without them. This is the safe-by-default posture: the SDK
 * makes the safe thing easy and the unsafe thing impossible.
 */
export const capsSchema = z.object({
  /** Hard per-trade cap (USD). A proposal above this is BLOCKED. */
  maxPerTxUsd: z.number().positive(),
  /** Hard per-user daily cap (USD). The second backstop on a custodial key. */
  dailyCapUsd: z.number().positive(),
  /** Optional explicit slippage; otherwise the spine clamps a dynamic value to [10, 300] bps. */
  slippageBps: z.number().int().min(10).max(300).optional(),
  /**
   * Rug gate — OFF by default. When off, the rug score is still computed +
   * recorded (visibility), it just never blocks. When on, flagged tokens are
   * blocked. Every OTHER gate is unconditional.
   */
  rugGate: z.boolean().optional().default(false),
});
export type Caps = z.input<typeof capsSchema>;
export type ResolvedCaps = z.output<typeof capsSchema>;

/** A per-position exit rule (TP/SL/time), evaluated by the agent runtime. */
export const exitConditionSchema = z.object({
  type: z.enum(["time_elapsed", "pnl_loss_pct", "pnl_profit_pct", "price_threshold"]),
  threshold: z.number(),
  action: z.enum(["close", "pause"]).default("close"),
  direction: z.enum(["below", "above"]).optional(),
});
export type ExitCondition = z.infer<typeof exitConditionSchema>;

/**
 * The typed strategy an agent runs. Everything an agent needs to act is here;
 * the runtime dispatches on `agentType` through its registry, and every action
 * it takes goes through `guardedExecute`.
 */
export const strategySchema = z.object({
  name: z.string().min(1),
  agentType: z.enum(AGENT_TYPES),
  /** Token being traded (output for buys). */
  outputMint: z.string().min(32).max(44),
  /** Token spent (defaults to SOL). */
  inputMint: z.string().min(32).max(44).default("So11111111111111111111111111111111111111112"),
  /** USD size of each action. */
  amountUsd: z.number().positive(),
  /** Trigger cadence for scheduled types (e.g. DCA). Cron or interval seconds. */
  intervalSeconds: z.number().int().positive().optional(),
  cron: z.string().optional(),
  /** Price threshold for DIP_BUYER / LIMIT_ORDER. */
  priceThresholdUsd: z.number().positive().optional(),
  /** Wallet to mirror for WALLET_COPY. */
  watchedWallet: z.string().optional(),
  /** Ladder rungs for LADDERED_EXIT. */
  ladder: z.array(z.object({ multiplier: z.number().positive(), sellPercent: z.number().min(0).max(100) })).optional(),
  exitConditions: z.array(exitConditionSchema).optional(),
  caps: capsSchema,
});
export type Strategy = z.input<typeof strategySchema>;
export type ResolvedStrategy = z.output<typeof strategySchema>;
