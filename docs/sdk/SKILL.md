---
name: corine-agent-kit
description: Execute safe, guarded Solana trades and run trading agents through the Corine safe-by-construction spine. Use when a task needs to quote, buy, sell, or run a Solana trading agent where kill-switch, per-trade caps, daily caps, freshness and idempotency must be enforced by construction. Not for un-gated raw swaps (this SDK intentionally does not expose one).
license: Apache-2.0
---

# Corine Agent Kit

The `@corine/core` SDK executes Solana trades through ONE guarded spine. Every trade passes, in order: kill-switch → idempotency → mint-sanity → per-trade cap → daily cap → SOL-for-fees → freshness → optional rug → fill. There is no unguarded execute. Use this SDK when you need those guarantees; do not look for a raw-swap escape hatch — there isn't one.

## Setup (once)

```ts
import { createCorine, LocalSigner } from "@corine/core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },              // your Solana RPC
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!), // your key — stays local, custodial
});
```

Requirements you must gather from the user before trading: an RPC endpoint, a signing key (base58 or keyfile), a per-trade cap, and a daily cap. **Caps are mandatory.** Using a local key is **custodial** — say so.

## Actions

### Preview a route (read-only, no signing)
```ts
const q = await corine.quote({ inputMint, outputMint, amountUsd, slippageBps });
// q.inAmount / q.outAmount are atomic. Always preview before executing money.
```

### Execute a guarded trade (the only trade path)
```ts
const res = await corine.execute({
  inputMint, outputMint, amountUsd,
  side: "buy",                 // or "sell"
  maxPerTxUsd, dailyCapUsd,    // REQUIRED
  evaluatedAtMs: Date.now(),
});
// res.status: "executed" | "blocked" | "failed" | "noop"
// if blocked: res.blockedBy ∈ { kill_switch, over_caps, over_daily_cap, below_min,
//   insufficient_sol, stale_trigger, stale_price, rug, not_whitelisted, inflight, internal }
// on success: res.txHash
```

Rules for an agent calling this:
- ALWAYS pass a stable `idempotencyKey` when you might retry, so a retry is a no-op instead of a double trade.
- Treat `status: "blocked"` as a normal, expected outcome — surface `reason` to the user, do not loop.
- Never fabricate a success; report `res.status` and `res.txHash` exactly.

### Live price
```ts
const price = await corine.price(mint); // USD, or 0 when unavailable
```

### Kill switch (emergency halt)
```ts
await corine.killSwitch.enable("reason");  // blocks ALL trades
await corine.killSwitch.disable();
const { enabled, reason } = await corine.killSwitch.status();
```

### Run a trading agent
```ts
const agent = await corine.agents.deploy({
  userId: "user1",
  strategy: {
    name: "DCA", agentType: "DCA",
    outputMint, inputMint, amountUsd,
    intervalSeconds: 3600,
    caps: { maxPerTxUsd, dailyCapUsd },   // mandatory
  },
});
const tick = await corine.agents.runOnce(agent.id); // GuardedResult | null (null = no action)
// Call runOnce on your own schedule; the SDK does not run a background scheduler.
```

Agent types: `DCA`, `DIP_BUYER`, `LIMIT_ORDER`, `LADDERED_EXIT`, `CUSTOM`. A handler only proposes a trade; the runtime executes it through the guarded spine.

## Guardrails for the calling agent
- Do NOT claim the SDK is "non-custodial" or that funds are "safe" — it is custodial when a local key is used; caps + kill-switch are backstops.
- Use a durable store in production (`FileStore` or Postgres/SQLite) or idempotency + daily caps reset on restart.
- Bring the user's own keys for RPC / data / LLM. Never hardcode or transmit a key.

## MCP
The same actions can be exposed to an LLM over the Model Context Protocol — see `mcp.md`.
