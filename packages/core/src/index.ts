/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 *
 * @corine/core — the safe-by-construction agent runtime for Solana.
 *
 * Every trade goes through one guarded execution spine (kill-switch → idempotency
 * → mint-sanity → caps → daily-cap → SOL-for-fees → freshness → rug → leg
 * dispatch). There is no public path that executes a trade any other way. Bring
 * your own RPC, keys, data and LLM — no Corine secret is embedded.
 */

// ── The one-call init + public runtime ──────────────────────────────────────
export { createCorine } from "./corine";
export type { Corine, CorineConfig, ExecuteInput } from "./corine";

// ── The spine (types; the executor is reached only via createCorine) ─────────
export { GuardedExecutor } from "./safety/guarded-execute";
export type { GuardedTrade, GuardedResult, SpineDeps } from "./safety/guarded-execute";
export { DEFAULT_SAFETY_CONFIG } from "./safety/config";
export type { SafetyConfig } from "./safety/config";
export { JupiterLeg } from "./safety/legs/jupiter";

// ── Schema + domain types ────────────────────────────────────────────────────
export {
  AGENT_TYPES,
  capsSchema,
  strategySchema,
  exitConditionSchema,
} from "./schema";
export type {
  AgentType,
  Caps,
  ResolvedCaps,
  Strategy,
  ResolvedStrategy,
  ExitCondition,
} from "./schema";
export { SOL_MINT, USDC_MINT } from "./types";
export type {
  BlockReason,
  ExecutionStatus,
  FillResult,
  RugAssessment,
  TradeSurface,
} from "./types";

// ── The seven interface seams ────────────────────────────────────────────────
export type {
  RpcProvider,
  Signer,
  Keystore,
  PriceSource,
  QuoteSource,
  SwapQuote,
  RugChecker,
  Store,
  GuardDecision,
  GuardState,
  DailySpendCheck,
  AuditRecord,
  Notifier,
  NotifyEvent,
  LLMProvider,
  LLMMessage,
  ModelTier,
  MemoryStore,
  MemoryItem,
  RecallResult,
  ExecutorLeg,
  LegContext,
} from "./interfaces";

// ── Default adapters (swap any of these for your own) ────────────────────────
export { Web3RpcProvider } from "./adapters/rpc/web3";
export type { Web3RpcOptions } from "./adapters/rpc/web3";
export { JupiterClient } from "./adapters/data/jupiter";
export type { JupiterClientOptions } from "./adapters/data/jupiter";
export { LocalSigner, SingleKeystore } from "./adapters/signer/local";
export { AesKeystore } from "./adapters/signer/aes-keystore";
export { InMemoryStore } from "./adapters/store/memory";
export { FileStore } from "./adapters/store/file";
export { ConsoleNotifier, SilentNotifier } from "./adapters/notifier/console";
export { NoopRugChecker } from "./adapters/rug/noop";
export { OpenRouterLLM } from "./adapters/llm/openrouter";
export type { OpenRouterOptions } from "./adapters/llm/openrouter";
export { InMemoryMemory } from "./adapters/memory/in-memory";

// ── Agent runtime + registry + built-in handlers ─────────────────────────────
export { AgentRuntime } from "./runtime/agent-runtime";
export type { Agent, AgentStatus, DeployParams, AgentRuntimeDeps } from "./runtime/agent-runtime";
export { AgentTypeRegistry } from "./runtime/registry";
export type { AgentTypeHandler, AgentContext, TradeProposal, AgentState } from "./runtime/registry";
export {
  BUILTIN_HANDLERS,
  dcaHandler,
  dipBuyerHandler,
  limitOrderHandler,
  ladderedExitHandler,
} from "./runtime/handlers";
