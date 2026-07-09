/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 *
 * The seven pluggable seams. The open SDK depends on these interfaces; YOU
 * supply the implementation + YOUR keys. No Corine secret or endpoint is ever
 * embedded in the runtime.
 */

export type { RpcProvider } from "./rpc";
export type { Signer, Keystore } from "./signer";
export type { PriceSource, QuoteSource, SwapQuote, RugChecker } from "./data";
export type {
  Store,
  GuardDecision,
  GuardState,
  DailySpendCheck,
  AuditRecord,
} from "./store";
export type { Notifier, NotifyEvent } from "./notifier";
export type { LLMProvider, LLMMessage, ModelTier } from "./llm";
export type { MemoryStore, MemoryItem, RecallResult } from "./memory";
export type { ExecutorLeg, LegContext } from "./leg";
