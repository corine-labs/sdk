/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AuditRecord, DailySpendCheck, GuardState, Store } from "../../interfaces/store";

interface StoreState {
  killSwitch: { enabled: boolean; reason: string | null };
  guards: Record<string, GuardState>;
  daily: Record<string, number>; // key: `${userId}:${YYYY-MM-DD}`
  audits: Array<AuditRecord & { id: string; at: number }>;
  seq: number;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * MemoryStore — the default `Store` for development, examples and tests. Holds
 * the safety-critical ledgers in-process. Correct and atomic within a process,
 * but NOT durable: idempotency + daily-spend reset on restart. For production
 * use `FileStore` (durable, zero-dependency) or implement `Store` over
 * Postgres/SQLite/Redis. This is stated honestly, not hidden.
 */
export class InMemoryStore implements Store {
  protected state: StoreState = { killSwitch: { enabled: false, reason: null }, guards: {}, daily: {}, audits: [], seq: 0 };

  /** Hook for durable subclasses — called after every mutation. No-op here. */
  protected persist(): void {}

  private nextId(prefix: string): string {
    this.state.seq += 1;
    return `${prefix}_${this.state.seq}_${Date.now().toString(36)}`;
  }

  async isKillSwitchEnabled(): Promise<boolean> {
    return this.state.killSwitch.enabled;
  }
  async setKillSwitch(enabled: boolean, reason?: string): Promise<void> {
    this.state.killSwitch = { enabled, reason: reason ?? null };
    this.persist();
  }
  async getKillSwitchReason(): Promise<string | null> {
    return this.state.killSwitch.reason;
  }

  async beginGuard(idempotencyKey: string): Promise<GuardState> {
    const existing = this.state.guards[idempotencyKey];
    if (existing) return existing;
    const fresh: GuardState = { decision: "proceed" };
    this.state.guards[idempotencyKey] = fresh;
    this.persist();
    return fresh;
  }
  async recordSentSig(idempotencyKey: string, sig: string): Promise<void> {
    const g = this.state.guards[idempotencyKey] ?? { decision: "proceed" };
    g.decision = "confirm";
    g.sentSig = sig;
    this.state.guards[idempotencyKey] = g;
    this.persist();
  }
  async completeGuard(idempotencyKey: string, executionId?: string): Promise<void> {
    const g = this.state.guards[idempotencyKey] ?? { decision: "proceed" };
    g.decision = "done";
    g.executionId = executionId;
    this.state.guards[idempotencyKey] = g;
    this.persist();
  }
  async failGuard(idempotencyKey: string, message: string, executionId?: string): Promise<void> {
    const g = this.state.guards[idempotencyKey] ?? { decision: "proceed" };
    g.decision = "failed";
    g.errorMessage = message;
    g.executionId = executionId;
    this.state.guards[idempotencyKey] = g;
    this.persist();
  }

  async checkDailySpend(userId: string, amountUsd: number, dailyCapUsd: number): Promise<DailySpendCheck> {
    const spent = this.state.daily[`${userId}:${today()}`] ?? 0;
    const remaining = Math.max(0, dailyCapUsd - spent);
    return { allowed: spent + amountUsd <= dailyCapUsd, spent, remaining };
  }
  async recordDailySpend(userId: string, amountUsd: number): Promise<void> {
    const key = `${userId}:${today()}`;
    this.state.daily[key] = (this.state.daily[key] ?? 0) + amountUsd;
    this.persist();
  }

  async recordAudit(record: AuditRecord): Promise<string> {
    const id = this.nextId("audit");
    this.state.audits.push({ ...record, id, at: Date.now() });
    this.persist();
    return id;
  }

  /** Read-only view of the audit trail (not part of the Store interface — a convenience). */
  auditTrail(): ReadonlyArray<AuditRecord & { id: string; at: number }> {
    return this.state.audits;
  }
}
