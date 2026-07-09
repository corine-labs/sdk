/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { LLMMessage, LLMProvider, ModelTier } from "../../interfaces/llm";

export interface OpenRouterOptions {
  /** YOUR OpenRouter key. Optional — when absent, reasoning agents degrade to deterministic. */
  apiKey?: string;
  baseUrl?: string;
  models?: Partial<Record<ModelTier, string>>;
  timeoutMs?: number;
}

const DEFAULT_MODELS: Record<ModelTier, string> = {
  fast: "anthropic/claude-haiku-4.5",
  deep: "anthropic/claude-opus-4.8",
  chat: "anthropic/claude-opus-4.8",
};

/**
 * OpenRouterLLM — the default (optional) `LLMProvider`. Bring YOUR OWN key; no
 * key is embedded. `isConfigured()` returns false when no key is set, and
 * reasoning agents then fall back to their deterministic path — they never
 * fabricate a decision.
 */
export class OpenRouterLLM implements LLMProvider {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly models: Record<ModelTier, string>;
  private readonly timeoutMs: number;

  constructor(opts: OpenRouterOptions = {}) {
    this.apiKey = opts.apiKey;
    this.baseUrl = (opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.models = { ...DEFAULT_MODELS, ...(opts.models ?? {}) };
    this.timeoutMs = opts.timeoutMs ?? 60_000;
  }

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  async complete(tier: ModelTier, messages: LLMMessage[], opts?: { maxTokens?: number; temperature?: number }): Promise<string> {
    if (!this.apiKey) throw new Error("OpenRouterLLM is not configured (no apiKey).");
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({
          model: this.models[tier],
          messages,
          max_tokens: opts?.maxTokens ?? 1024,
          temperature: opts?.temperature ?? 0.2,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`OpenRouter ${res.status} ${res.statusText}`);
      const body: any = await res.json();
      return body?.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(t);
    }
  }
}
