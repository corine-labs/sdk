# @corine/core

**The safe-by-construction agent runtime for Solana.**

`@corine/core` gives you one call — `createCorine(config)` — to spin up a trading
runtime where **every trade goes through a single guarded execution spine**.
There is no public path that executes a trade any other way. Bring your own RPC,
keys, data, and LLM — no Corine secret is embedded.

```ts
import { createCorine, LocalSigner } from "@corine/core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
});
```

## The one idea

Every trade — a one-shot swap, a DCA buy, a laddered exit, a custom agent, a CLI
command, a web request — passes the **same deterministic gates in the same
order** before any funds move:

```
kill-switch → idempotency (no double-execute) → mint sanity → per-tx cap →
daily cap → SOL-for-fees → freshness (stale decision + dead price feed) →
rug gate (optional) → leg dispatch (post-gate fill venue)
```

Each gate is a deterministic check, not a heuristic. A new fill venue is added by
implementing `ExecutorLeg` — and it is **still behind every gate**. There is no
`executeUnguarded`. That is the moat and the safety guarantee: the safe thing is
easy and the unsafe thing is not exposed. See
[`docs/sdk/safety-model.md`](../../docs/sdk/safety-model.md) for exactly what
each gate does and does not protect against.

## Install

```bash
npm install @corine/core
```

Requires Node 18+.

## Quickstart — a guarded swap in 10 lines

```ts
import { createCorine, LocalSigner, SOL_MINT, USDC_MINT } from "@corine/core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
});

const result = await corine.execute({
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amountUsd: 10,
  side: "buy",
  maxPerTxUsd: 100,      // required — there is no uncapped path
  dailyCapUsd: 500,      // required
  evaluatedAtMs: Date.now(),
});

console.log(result.status, result.blockedBy ?? "", result.txHash ?? "");
// "executed" | "blocked" (+ a BlockReason) | "failed" | "noop"
```

## The public surface

`createCorine(config)` returns a `Corine`:

| Member                      | What it does                                                          |
| --------------------------- | --------------------------------------------------------------------- |
| `execute(input)`            | The **only** way to execute a trade — always through the spine.       |
| `quote({ inputMint, outputMint, amountUsd, slippageBps? })` | Read-only route preview. No signing, no execution. |
| `price(mint)`               | Live USD price of a mint (`0` when unavailable).                       |
| `agents`                    | The `AgentRuntime` — `deploy`, `runOnce`, `pause`/`resume`/`kill`.     |
| `killSwitch`                | `enable(reason?)`, `disable()`, `status()` — the global halt.          |
| `store`                     | The durable safety state (kill switch, idempotency, daily ledger, audit). |
| `registry`                  | The agent-type registry (register custom types).                       |
| `rpc` / `cluster`           | Escape hatches to the RPC provider + cluster.                          |

## The seven seams — bring your own everything

`createCorine` wires safe defaults for every dependency, and lets you swap any of
them. The spine is identical regardless of what you plug in.

| Seam           | Interface       | Default                       | Swap in                              |
| -------------- | --------------- | ----------------------------- | ------------------------------------ |
| RPC            | `RpcProvider`   | `Web3RpcProvider`             | your RPC endpoint or provider        |
| Keys (custody) | `Signer` / `Keystore` | `LocalSigner` / `SingleKeystore` | `AesKeystore`, your KMS/HSM     |
| Prices         | `PriceSource`   | `JupiterClient`               | Birdeye, Pyth, your cache            |
| Quotes         | `QuoteSource`   | `JupiterClient`               | your router                          |
| Rug / risk     | `RugChecker`    | `NoopRugChecker`              | your on-chain heuristics / a provider |
| State          | `Store`         | `InMemoryStore` (dev) / `FileStore` (durable) | your Postgres/Redis/SQLite impl |
| Fill venue     | `ExecutorLeg`   | `JupiterLeg` (`"jupiter"`)    | your venue (e.g. a bonding curve)    |

Two more optional seams: `Notifier` (`ConsoleNotifier` / `SilentNotifier`) for
where the runtime reports, and `LLMProvider` (`OpenRouterLLM`) + `MemoryStore`
(`InMemoryMemory`) for reasoning. All credentials are yours; none are embedded.

Guides for each seam:

- [Build a custom agent type](../../docs/sdk/guides/build-a-custom-agent-type.md)
- [Plug in a data source](../../docs/sdk/guides/plug-a-data-source.md)
- [The durable store](../../docs/sdk/guides/durable-store.md)
- [Deploy and monitor](../../docs/sdk/guides/deploy-and-monitor.md)
- [Integrate a frontend](../../docs/sdk/guides/integrate-a-frontend.md)
- [Safety model](../../docs/sdk/safety-model.md)

## Deploy an agent

Agents pair a strategy (what to trade) with a type handler (when to trade). Caps
are mandatory — there is no uncapped agent.

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
    caps: { maxPerTxUsd: 10, dailyCapUsd: 50 }, // MANDATORY
  },
});

// The SDK does NOT run a background scheduler — you call runOnce on your cadence.
const result = await corine.agents.runOnce(agent.id);
console.log(agent.id, "→", result?.status ?? "no-action");
```

Built-in agent types: `DCA`, `DIP_BUYER`, `LIMIT_ORDER`, `LADDERED_EXIT`, and
`CUSTOM` (register your own handler). A handler can only **propose** a trade; the
runtime executes it through the spine with the agent's caps.

## Custody — the honest version

When you use `LocalSigner` (or `AesKeystore`), Corine is **custodial**: the
runtime holds and uses your key to sign trades on your behalf. That is the honest
label — this is **not** "non-custodial," and this package never claims your funds
are safe by magic. What it gives you is a hard floor: a mandatory per-trade cap,
a mandatory daily cap, and a global kill switch that apply to every trade by
construction. Keep keys server-side and scoped; treat the durable `Store` (which
holds the idempotency guard and daily ledger) with the same care as the key.

## What's open vs. hosted

This package is the runtime. Billing, Dodo, and the hosted infrastructure are
**not** in `@corine/core` — you run this yourself with your own RPC, keys, and
data.

## License

Apache-2.0. See [`LICENSE`](./LICENSE) and [`NOTICE`](./NOTICE).
