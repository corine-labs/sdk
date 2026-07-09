/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { InMemoryStore } from "./memory";

/**
 * FileStore — a durable, ZERO-DEPENDENCY `Store` that persists the safety
 * ledgers to a JSON file after every mutation and reloads on startup. Good
 * enough that idempotency + daily-spend survive a restart (unlike `MemoryStore`).
 * For high throughput / multi-process deployments, implement `Store` over
 * Postgres/SQLite/Redis instead — the interface is identical.
 */
export class FileStore extends InMemoryStore {
  constructor(private readonly path: string) {
    super();
    if (existsSync(path)) {
      try {
        this.state = { ...this.state, ...JSON.parse(readFileSync(path, "utf8")) };
      } catch {
        // Corrupt/partial file — start clean rather than crash. (Consider backing up in prod.)
      }
    } else {
      mkdirSync(dirname(path), { recursive: true });
    }
  }

  protected persist(): void {
    writeFileSync(this.path, JSON.stringify(this.state), "utf8");
  }
}
