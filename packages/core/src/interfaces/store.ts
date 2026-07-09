/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { BlockReason, ExecutionStatus } from "../types";

/**
 * The durable state the safety spine relies on. These are SAFETY-CRITICAL
 * ledgers, not caches — a correct implementation must be atomic and survive a
 * restart, or the guarantees weaken (a crash mid-confirm could double-send; a
 * reset daily ledger could over-spend). Defaults: `MemoryStore` (dev) and
 * `FileStore` (durable, zero-dependency). Implement this interface over
 * Postgres/SQLite/Redis for production scale — see docs/guides/store.md.
 */

/** The idempotency guard's view of a key: has this action already run? */
export type GuardDecision = "proceed" | "confirm" | "done" | "failed";

export interface GuardState {
  decision: GuardDecision;
  /** A signature broadcast under this key but not yet reconciled (no-double-send). */
  sentSig?: string;
  executionId?: string;
  errorMessage?: string;
}

export interface DailySpendCheck {
  allowed: boolean;
  spent: number;
  remaining: number;
}

/** One audit row for a guarded execution attempt (executed / blocked / failed). */
export interface AuditRecord {
  userId: string;
  surface: string;
  inputMint: string;
  outputMint: string;
  amountUsd: number;
  slippageBps: number;
  status: Uppercase<ExecutionStatus> | "EXECUTED" | "BLOCKED" | "FAILED";
  blockedBy?: BlockReason;
  txHash?: string;
  rugScore?: number;
  errorMessage?: string;
}

export interface Store {
  // ── Kill switch — the global halt flag ────────────────────────────────────
  isKillSwitchEnabled(): Promise<boolean>;
  setKillSwitch(enabled: boolean, reason?: string): Promise<void>;
  getKillSwitchReason(): Promise<string | null>;

  // ── Idempotency guard — at-most-once execution (no double trade) ───────────
  /** Begin an attempt for a key. Returns the current decision (atomic upsert). */
  beginGuard(idempotencyKey: string): Promise<GuardState>;
  /** Persist a broadcast signature BEFORE confirmation (the no-double-send hook). */
  recordSentSig(idempotencyKey: string, sig: string): Promise<void>;
  completeGuard(idempotencyKey: string, executionId?: string): Promise<void>;
  failGuard(idempotencyKey: string, message: string, executionId?: string): Promise<void>;

  // ── Daily spend ledger — the second cap backstop on a custodial key ────────
  checkDailySpend(userId: string, amountUsd: number, dailyCapUsd: number): Promise<DailySpendCheck>;
  recordDailySpend(userId: string, amountUsd: number): Promise<void>;

  // ── Audit trail — every attempt, for a durable "what ran and why" ──────────
  /** Persist an audit row; returns an id used to correlate the guard + result. */
  recordAudit(record: AuditRecord): Promise<string>;
}
