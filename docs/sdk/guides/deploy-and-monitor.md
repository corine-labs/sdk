# Deploy and monitor agents

An agent pairs a **strategy** (what to trade, how big, with what caps) with a
**type handler** (when to trade). You deploy it, then run ticks on your own
cadence. Every tick that acts goes through the guarded spine. This guide covers
deploying, scheduling, lifecycle, and reading what happened.

## Deploy

```ts
import { createCorine, LocalSigner, SOL_MINT } from "@corine/core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
});

const agent = await corine.agents.deploy({
  userId: "me",
  strategy: {
    name: "BONK DCA",
    agentType: "DCA",
    outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    inputMint: SOL_MINT,
    amountUsd: 5,
    intervalSeconds: 3600,
    caps: { maxPerTxUsd: 10, dailyCapUsd: 50 }, // MANDATORY — zod rejects a strategy without caps
  },
});
```

`deploy` validates the strategy through zod and returns an `Agent`:

```ts
interface Agent {
  id: string;
  userId: string;
  walletRef: string;   // which key the keystore resolves to; defaults to userId
  strategy: ResolvedStrategy;
  status: "active" | "paused" | "stopped";
  state: Record<string, unknown>;
  createdAt: number;
}
```

`deploy` throws if the strategy is invalid (missing caps, bad mint length, an
`agentType` with no registered handler, …). Fail loud, on deploy — not at trade
time.

### Deploy parameters

```ts
await corine.agents.deploy({
  strategy,               // required
  userId: "me",           // required
  walletRef: "wallet-1",  // optional — defaults to userId; the keystore resolves it to a signer
  state: { entryPriceUsd: 0.0000021 }, // optional seed state (e.g. for a LADDERED_EXIT)
});
```

### The strategy schema

Built-in agent types: `DCA`, `DIP_BUYER`, `LIMIT_ORDER`, `LADDERED_EXIT`, and
`CUSTOM` (bring your own handler — see
[Build a custom agent type](./build-a-custom-agent-type.md)). `WALLET_COPY` is a
reserved type in the union but ships without a default handler — register your
own if you want it.

```ts
{
  name: string;
  agentType: "DCA" | "DIP_BUYER" | "LIMIT_ORDER" | "LADDERED_EXIT" | "WALLET_COPY" | "CUSTOM";
  outputMint: string;                 // the token being traded (32–44 chars)
  inputMint?: string;                 // defaults to SOL
  amountUsd: number;                  // USD size of each action
  intervalSeconds?: number;           // cadence hint for scheduled types (e.g. DCA)
  priceThresholdUsd?: number;         // for DIP_BUYER / LIMIT_ORDER
  ladder?: { multiplier: number; sellPercent: number }[]; // for LADDERED_EXIT
  caps: {                             // REQUIRED
    maxPerTxUsd: number;              // hard per-trade cap
    dailyCapUsd: number;              // hard per-user daily cap
    slippageBps?: number;            // optional; otherwise a dynamic value clamped to [10, 300]
    rugGate?: boolean;               // default false — the rug gate only blocks when true
  };
}
```

Caps are not optional and there is no "uncapped" mode. The per-trade and daily
caps are the second and third backstops on a custodial key; the spine refuses to
execute without them.

## Run a tick

The runtime **does not schedule anything.** There is no background loop. You call
`runOnce` on whatever cadence you want, and it evaluates the handler exactly
once:

```ts
const result = await corine.agents.runOnce(agent.id); // GuardedResult | null
```

- `null` — the agent isn't `active`, or the handler proposed nothing this tick.
- a `GuardedResult` — the handler proposed a trade and it went through the spine.

```ts
interface GuardedResult {
  status: "executed" | "blocked" | "failed" | "noop";
  blockedBy?: string;   // a BlockReason when blocked (e.g. "over_caps", "stale_price", "kill_switch")
  reason?: string;      // human-readable explanation
  auditId?: string;     // correlates to the audit row in the Store
  txHash?: string;
  slippageBps?: number;
  rugScore?: number;
}
```

## Scheduling is your concern

Because the SDK never runs a background scheduler, wire `runOnce` into your own
loop, cron, or worker. A minimal interval loop:

```ts
// Tick every 60s. Use a real scheduler (cron, a queue, a worker) in production.
setInterval(async () => {
  try {
    const res = await corine.agents.runOnce(agent.id);
    if (res) console.log(agent.id, "→", res.status, res.blockedBy ?? "");
  } catch (err) {
    console.error("tick failed", err);
  }
}, 60_000);
```

Ticking faster than the strategy needs is safe: the idempotency gate dedupes
repeated proposals with the same key, so an over-eager loop cannot double-buy.
The handler decides whether a given tick actually acts (returning `null`
otherwise). This is why the guarantees hold no matter how you schedule.

## Lifecycle

```ts
corine.agents.pause(agent.id);   // status → "paused" — runOnce returns null while paused
corine.agents.resume(agent.id);  // status → "active"
corine.agents.kill(agent.id);    // status → "stopped" — runOnce returns null; terminal

corine.agents.get(agent.id);     // Agent | undefined
corine.agents.list();            // Agent[]
```

A paused or stopped agent yields `null` from `runOnce` — no evaluation, no
trade. `kill` is terminal.

> The in-process `AgentRuntime` holds agents in memory for the life of the
> process. If your host restarts, re-`deploy` from your own persisted strategies.
> (The safety-critical state — idempotency, daily ledger, kill switch — lives in
> the durable `Store`, not in the runtime; see [The durable store](./durable-store.md).)

## Monitor

Two sources of truth:

**1. The `GuardedResult` from each tick.** Its `status` and `blockedBy` tell you
exactly what happened and why:

```ts
const res = await corine.agents.runOnce(agent.id);
if (res?.status === "executed") {
  console.log("filled:", `https://solscan.io/tx/${res.txHash}`);
} else if (res?.status === "blocked") {
  console.warn("blocked by", res.blockedBy, "—", res.reason); // e.g. "over_daily_cap"
}
```

**2. The audit trail in the `Store`.** Every attempt — executed, blocked, or
failed — is written via `store.recordAudit(...)`, keyed by an `auditId` the
result carries. Read your `Store` implementation's audit table to answer "what
ran and why" after the fact. With `FileStore` that is the JSON state file; with
a Postgres `Store` it's your audit table (see
[The durable store](./durable-store.md)).

Common `blockedBy` reasons you'll see: `kill_switch`, `over_caps`,
`over_daily_cap`, `insufficient_sol`, `stale_trigger`, `stale_price`, `rug`,
`inflight`. Each is a deterministic gate, not a heuristic — the full list and
what each protects against is in the [safety model](../safety-model.md).

## Kill switch

A global halt across every surface and agent. When on, the spine blocks every
trade at gate 1 with `blockedBy: "kill_switch"`:

```ts
await corine.killSwitch.enable("incident: halting all agents");
await corine.killSwitch.status(); // { enabled: true, reason: "incident: halting all agents" }
await corine.killSwitch.disable();
```

It reads/writes the `Store`, so with a durable store the halt survives a restart
until you explicitly disable it.
