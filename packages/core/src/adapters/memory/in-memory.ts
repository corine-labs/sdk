/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { MemoryItem, MemoryStore, RecallResult } from "../../interfaces/memory";

/**
 * InMemoryMemory — the default (optional) `MemoryStore`. Keyword recall only,
 * scoped per agent/user, no external service. It reports `semanticAvailable:
 * false` so callers know recall is keyword — it never pretends to be semantic.
 * Implement `MemoryStore` over pgvector/Pinecone/Supermemory for vector recall.
 */
export class InMemoryMemory implements MemoryStore {
  private readonly byScope = new Map<string, MemoryItem[]>();

  async remember(scope: string, item: MemoryItem): Promise<void> {
    const list = this.byScope.get(scope) ?? [];
    list.push({ ...item, createdAt: item.createdAt ?? Date.now() });
    this.byScope.set(scope, list);
  }

  async recall(scope: string, query: string, limit = 8): Promise<RecallResult> {
    const list = this.byScope.get(scope) ?? [];
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    const scored = list
      .map((item) => ({ item, score: terms.reduce((s, t) => s + (item.content.toLowerCase().includes(t) ? 1 : 0), 0) + (item.importance ?? 0) / 10 }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((r) => r.item);
    return { items: scored, semanticAvailable: false };
  }
}
