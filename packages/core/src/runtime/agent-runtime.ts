/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { GuardedExecutor, GuardedResult } from "../safety/guarded-execute";
import type { Keystore } from "../interfaces/signer";
import type { PriceSource } from "../interfaces/data";
import type { AgentTypeRegistry, AgentState } from "./registry";
import { strategySchema, type ResolvedStrategy, type Strategy } from "../schema";

export type AgentStatus = "active" | "paused" | "stopped";

export interface Agent {
  id: string;
  userId: string;
  walletRef: string;
  strategy: ResolvedStrategy;
  status: AgentStatus;
  state: AgentState;
  createdAt: number;
}

export interface DeployParams {
  strategy: Strategy;
  userId: string;
  /** Reference the keystore resolves to a signer (e.g. a wallet id). Defaults to userId. */
  walletRef?: string;
  /** Optional seed state (e.g. entryPriceUsd for a LADDERED_EXIT). */
  state?: AgentState;
}

export interface AgentRuntimeDeps {
  guarded: GuardedExecutor;
  registry: AgentTypeRegistry;
  keystore: Keystore;
  prices: PriceSource;
}

/**
 * AgentRuntime — deploy, tick, and manage agents. Every trade an agent makes is
 * routed through `guardedExecute`; a handler can only PROPOSE. Deploying is
 * safe-by-default: the strategy schema requires caps, so there is no way to run
 * an uncapped agent.
 */
export class AgentRuntime {
  private readonly agents = new Map<string, Agent>();
  private seq = 0;

  constructor(private readonly deps: AgentRuntimeDeps) {}

  /** Validate + register an agent. Throws (zod) if the strategy or caps are missing/invalid. */
  async deploy(params: DeployParams): Promise<Agent> {
    const strategy = strategySchema.parse(params.strategy);
    if (!this.deps.registry.has(strategy.agentType)) {
      throw new Error(`No handler registered for agent type "${strategy.agentType}". Register one first.`);
    }
    this.seq += 1;
    const id = `agent_${this.seq}_${Date.now().toString(36)}`;
    const agent: Agent = {
      id,
      userId: params.userId,
      walletRef: params.walletRef ?? params.userId,
      strategy,
      status: "active",
      state: params.state ?? {},
      createdAt: Date.now(),
    };
    this.agents.set(id, agent);
    return agent;
  }

  get(agentId: string): Agent | undefined {
    return this.agents.get(agentId);
  }
  list(): Agent[] {
    return [...this.agents.values()];
  }
  pause(agentId: string): Agent {
    return this.setStatus(agentId, "paused");
  }
  resume(agentId: string): Agent {
    return this.setStatus(agentId, "active");
  }
  kill(agentId: string): Agent {
    return this.setStatus(agentId, "stopped");
  }

  private setStatus(agentId: string, status: AgentStatus): Agent {
    const agent = this.mustGet(agentId);
    agent.status = status;
    return agent;
  }
  private mustGet(agentId: string): Agent {
    const a = this.agents.get(agentId);
    if (!a) throw new Error(`Unknown agent "${agentId}".`);
    return a;
  }

  /**
   * Run one evaluation tick for an agent. The handler proposes at most one trade;
   * the runtime executes it through the guarded spine. Returns null when the
   * agent is not active or the handler proposes nothing.
   */
  async runOnce(agentId: string): Promise<GuardedResult | null> {
    const agent = this.mustGet(agentId);
    if (agent.status !== "active") return null;

    const handler = this.deps.registry.get(agent.strategy.agentType);
    if (!handler) return null;

    const proposal = await handler.evaluate(agent.strategy, {
      prices: this.deps.prices,
      now: Date.now(),
      state: agent.state,
    });
    if (!proposal) return null;

    const signer = await this.deps.keystore.getSigner(agent.walletRef);
    return this.deps.guarded.execute({
      userId: agent.userId,
      surface: "agent",
      leg: proposal.leg,
      side: proposal.side,
      inputMint: proposal.inputMint,
      outputMint: proposal.outputMint,
      amountUsd: proposal.amountUsd,
      inputAmountAtomic: proposal.inputAmountAtomic,
      maxPerTxUsd: agent.strategy.caps.maxPerTxUsd,
      dailyCapUsd: agent.strategy.caps.dailyCapUsd,
      slippageBps: agent.strategy.caps.slippageBps,
      rugGate: agent.strategy.caps.rugGate,
      repositionExistingFunds: proposal.repositionExistingFunds,
      evaluatedAtMs: Date.now(),
      idempotencyKey: `agent:${agent.id}:${proposal.idempotencySuffix}`,
      signer,
    });
  }
}
