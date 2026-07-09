/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PriceSource } from "../interfaces/data";
import type { AgentType, ResolvedStrategy } from "../schema";

/** Per-agent scratch state a handler can read/write across ticks (persisted by the runtime). */
export type AgentState = Record<string, unknown>;

export interface AgentContext {
  prices: PriceSource;
  now: number;
  state: AgentState;
}

/**
 * What a handler proposes on a tick. The runtime turns this into a
 * `GuardedTrade` — filling in the caps, the signer and the idempotency key — and
 * runs it through `guardedExecute`. A handler CANNOT execute a trade itself; it
 * can only propose one. This is the safe-by-construction guarantee at the agent
 * layer: proposing is the only power a handler has.
 */
export interface TradeProposal {
  side: "buy" | "sell";
  inputMint: string;
  outputMint: string;
  amountUsd: number;
  /** Exact atomic input for token-denominated actions (e.g. a ladder sell). */
  inputAmountAtomic?: string;
  /** Fill venue (defaults to "jupiter"). */
  leg?: string;
  /** Whether this moves existing funds (a sell/exit) rather than new spend. */
  repositionExistingFunds?: boolean;
  /** Deterministic suffix the runtime appends to the idempotency key (controls dedup). */
  idempotencySuffix: string;
  /** Why the handler is proposing this — surfaced in logs/audit. */
  reason: string;
}

export interface AgentTypeHandler {
  readonly type: AgentType;
  /** Decide whether to act this tick. Return null to do nothing. */
  evaluate(strategy: ResolvedStrategy, ctx: AgentContext): Promise<TradeProposal | null>;
}

/** A pluggable registry of agent-type handlers. Add your own type with `register()`. */
export class AgentTypeRegistry {
  private readonly handlers = new Map<string, AgentTypeHandler>();

  register(handler: AgentTypeHandler): this {
    this.handlers.set(handler.type, handler);
    return this;
  }
  get(type: string): AgentTypeHandler | undefined {
    return this.handlers.get(type);
  }
  has(type: string): boolean {
    return this.handlers.has(type);
  }
  types(): string[] {
    return [...this.handlers.keys()];
  }
}
