/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

export type ModelTier = "fast" | "deep" | "chat";

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/**
 * LLMProvider — the OPTIONAL reasoning seam. Agent types that reason (vs. purely
 * deterministic ones) call this. Default: `OpenRouterLLM` (bring your OWN
 * OpenRouter/Anthropic key). When no provider is configured, reasoning agents
 * degrade HONESTLY — they fall back to their deterministic path and never
 * fabricate a decision. No LLM key is embedded in the SDK.
 */
export interface LLMProvider {
  isConfigured(): boolean;
  complete(tier: ModelTier, messages: LLMMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string>;
}
