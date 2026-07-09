/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

export interface MemoryItem {
  kind: "fact" | "preference" | "decision" | "note";
  content: string;
  importance?: number;
  createdAt?: number;
}

export interface RecallResult {
  items: MemoryItem[];
  /** True when a semantic/vector backend contributed; false when it degraded to keyword-only. */
  semanticAvailable: boolean;
}

/**
 * MemoryStore — the OPTIONAL agent-memory seam (episodic + semantic recall).
 * Default: `InMemoryMemory` (keyword recall, no external service). Implement
 * over pgvector/Pinecone/Supermemory for semantic recall. When the semantic
 * backend is absent, recall degrades HONESTLY to keyword — it never invents a
 * vector hit.
 */
export interface MemoryStore {
  remember(scope: string, item: MemoryItem): Promise<void>;
  recall(scope: string, query: string, limit?: number): Promise<RecallResult>;
}
