# The durable store

The `Store` is the one seam that holds **safety-critical state**, not a cache.
It is where the spine keeps:

- the **kill-switch** flag,
- the **idempotency guard** (at-most-once execution — no double-send),
- the **daily-spend ledger** (the second cap backstop on a custodial key),
- the **audit trail** (a durable "what ran and why").

If this state is wrong or lost, the guarantees weaken: a crash mid-confirm could
double-send, and a reset daily ledger could over-spend. That is why durability
and atomicity matter here — more than anywhere else in the SDK.

## The interface

```ts
interface Store {
  // ── Kill switch — the global halt flag ─────────────────────────────────────
  isKillSwitchEnabled(): Promise<boolean>;
  setKillSwitch(enabled: boolean, reason?: string): Promise<void>;
  getKillSwitchReason(): Promise<string | null>;

  // ── Idempotency guard — at-most-once execution (no double trade) ────────────
  beginGuard(idempotencyKey: string): Promise<GuardState>;      // atomic upsert; returns current decision
  recordSentSig(idempotencyKey: string, sig: string): Promise<void>; // persist BEFORE confirmation
  completeGuard(idempotencyKey: string, executionId?: string): Promise<void>;
  failGuard(idempotencyKey: string, message: string, executionId?: string): Promise<void>;

  // ── Daily spend ledger — the second cap backstop ────────────────────────────
  checkDailySpend(userId: string, amountUsd: number, dailyCapUsd: number): Promise<DailySpendCheck>;
  recordDailySpend(userId: string, amountUsd: number): Promise<void>;

  // ── Audit trail — every attempt (executed / blocked / failed) ───────────────
  recordAudit(record: AuditRecord): Promise<string>; // returns an id correlating the guard + result
}

type GuardDecision = "proceed" | "confirm" | "done" | "failed";

interface GuardState {
  decision: GuardDecision;
  sentSig?: string;      // a signature broadcast under this key but not yet reconciled
  executionId?: string;
  errorMessage?: string;
}

interface DailySpendCheck {
  allowed: boolean;
  spent: number;
  remaining: number;
}

interface AuditRecord {
  userId: string;
  surface: string;                 // "cli" | "sdk" | "agent" | "web" | …
  inputMint: string;
  outputMint: string;
  amountUsd: number;
  slippageBps: number;
  status: "EXECUTED" | "BLOCKED" | "FAILED";
  blockedBy?: string;              // the BlockReason when status === "BLOCKED"
  txHash?: string;
  rugScore?: number;
  errorMessage?: string;
}
```

### How the idempotency guard is used

The spine calls `beginGuard` at the very start of a trade and branches on the
returned `decision`:

- `"proceed"` — first time this key is seen; run the trade.
- `"confirm"` + a `sentSig` — a transaction is already **in flight**; the spine
  returns a no-op rather than re-sending.
- `"done"` — already executed; the spine returns a no-op.
- `"failed"` — a prior attempt failed; the spine reports the stored error.

The moment a fill leg broadcasts a signature — **before** confirmation — the
spine calls `recordSentSig`. This is the no-double-send hook: if the process
dies between broadcast and confirmation, the persisted signature means the next
`beginGuard` for that key sees `"confirm"` and refuses to send again. On success
the spine calls `completeGuard`; on failure, `failGuard`.

> **This is why in-memory state is not safe for production.** Lose the guard on
> restart and a re-triggered action can broadcast a second transaction for the
> same intent.

## Defaults

### `InMemoryStore` — dev only

```ts
import { createCorine, InMemoryStore, LocalSigner } from "@h4rsharma/corine-core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  store: new InMemoryStore(), // this is also the default if you pass nothing
});
```

Honest limitation: **it resets on restart.** The idempotency guard and daily
ledger do not survive a process bounce. Fine for a REPL or a test; not fine for
anything holding a funded key.

### `FileStore` — durable, zero-dependency

```ts
import { createCorine, FileStore, LocalSigner } from "@h4rsharma/corine-core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  store: new FileStore("./.corine/state.json"), // JSON-backed, persisted after every mutation
});
```

`FileStore` extends `InMemoryStore` and writes the whole state to a JSON file
after every mutation, reloading it on startup. The idempotency guard and daily
cap survive a restart. It is single-process by design — good for a single
worker, the CLI, or a small agent host. For multi-process or high throughput,
implement `Store` over a real database.

## Implementing `Store` over Postgres

For production scale, implement the same interface over your database. The two
non-negotiables:

1. **`beginGuard` must be atomic.** Two concurrent ticks for the same key must
   not both receive `"proceed"`. Do the upsert-and-read in a single statement or
   a transaction with the right isolation.
2. **`checkDailySpend` + `recordDailySpend` must not race.** Two trades that each
   individually fit under the cap must not *together* exceed it. Serialize the
   check-and-record per `userId` (row lock, `SELECT … FOR UPDATE`, or an atomic
   conditional update).

This is a **shape sketch**, not a full implementation — fill in your SQL:

```ts
import type { Store, GuardState, DailySpendCheck, AuditRecord } from "@h4rsharma/corine-core";
import type { Pool } from "pg";

class PostgresStore implements Store {
  constructor(private readonly db: Pool) {}

  // ── Kill switch ────────────────────────────────────────────────────────────
  async isKillSwitchEnabled(): Promise<boolean> {
    // SELECT enabled FROM kill_switch WHERE id = 'global'
    throw new Error("implement me");
  }
  async setKillSwitch(enabled: boolean, reason?: string): Promise<void> {
    // UPSERT kill_switch (id, enabled, reason) VALUES ('global', $1, $2)
    throw new Error("implement me");
  }
  async getKillSwitchReason(): Promise<string | null> {
    throw new Error("implement me");
  }

  // ── Idempotency guard — MUST be atomic ──────────────────────────────────────
  async beginGuard(idempotencyKey: string): Promise<GuardState> {
    // Atomic upsert-and-return. Something like:
    //   INSERT INTO guard (key, decision) VALUES ($1, 'proceed')
    //   ON CONFLICT (key) DO UPDATE SET key = EXCLUDED.key
    //   RETURNING decision, sent_sig, execution_id, error_message;
    // First writer gets 'proceed'; everyone after gets the stored decision.
    throw new Error("implement me");
  }
  async recordSentSig(idempotencyKey: string, sig: string): Promise<void> {
    // UPDATE guard SET decision = 'confirm', sent_sig = $2 WHERE key = $1
    // Persist BEFORE the tx confirms — this is the no-double-send hook.
    throw new Error("implement me");
  }
  async completeGuard(idempotencyKey: string, executionId?: string): Promise<void> {
    // UPDATE guard SET decision = 'done', execution_id = $2 WHERE key = $1
    throw new Error("implement me");
  }
  async failGuard(idempotencyKey: string, message: string, executionId?: string): Promise<void> {
    // UPDATE guard SET decision = 'failed', error_message = $2, execution_id = $3 WHERE key = $1
    throw new Error("implement me");
  }

  // ── Daily spend ledger — check + record MUST NOT race ───────────────────────
  async checkDailySpend(userId: string, amountUsd: number, dailyCapUsd: number): Promise<DailySpendCheck> {
    // Sum today's spend for userId, compare against dailyCapUsd, atomically.
    // Serialize per-user so two trades can't both slip under the cap.
    throw new Error("implement me");
  }
  async recordDailySpend(userId: string, amountUsd: number): Promise<void> {
    // INSERT INTO daily_spend (user_id, amount_usd, day) VALUES ($1, $2, current_date)
    throw new Error("implement me");
  }

  // ── Audit trail ─────────────────────────────────────────────────────────────
  async recordAudit(record: AuditRecord): Promise<string> {
    // INSERT INTO audit (...) RETURNING id
    throw new Error("implement me");
  }
}
```

Wire it in exactly like any other store:

```ts
const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  store: new PostgresStore(pool),
});
```

## Why durability matters — in one sentence each

- **Idempotency:** a persisted guard prevents a re-triggered action from
  broadcasting a second transaction for the same intent, even across a restart or
  a crash between broadcast and confirmation.
- **Daily cap:** the spent-today ledger must not reset on restart, or a bounced
  process quietly refills the daily envelope and the cap stops being a cap.

Both of these are backstops on a **custodial** key. Treat the `Store` with the
same care you treat the key itself.
