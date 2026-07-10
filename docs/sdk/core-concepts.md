# Core Concepts

`@h4rsharma/corine-core` is built around a single idea: **every trade goes through one guarded execution spine.** There is no public function that executes a trade any other way. Understand the spine and the seven seams and you understand the whole SDK.

---

## The runtime

`createCorine(config)` returns a `Corine` — a small, explicit surface:

```ts
import { createCorine, LocalSigner } from "@h4rsharma/corine-core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
});
```

| Member | What it is |
| --- | --- |
| `execute(input)` | The **only** way to trade. Runs the full gate stack, returns a `GuardedResult`. |
| `quote(params)` | Read-only route preview. No signing, no execution. |
| `price(mint)` | Live USD price of a mint (0 when unavailable). |
| `agents` | An `AgentRuntime` — deploy and tick strategy agents. |
| `killSwitch` | `enable(reason?)`, `disable()`, `status()`. |
| `store`, `registry`, `rpc`, `cluster` | Escape hatches for advanced use. |

The runtime holds no embedded secret. You supply the RPC endpoint, the signing key, and (optionally) data/LLM keys. If a public repo ships the SDK, there is nothing sensitive to leak.

---

## The safety spine

Every trade — whether it comes from `execute()`, from an agent tick, or from a fill venue a forker added — is routed through `guardedExecute`, which applies the same deterministic gates in the same order. These are gates, not heuristics: each one either passes or returns a `blocked` result with a specific `blockedBy` reason, and it does so **before any funds move**.

**Gate order (exact):**

```
kill-switch
  → idempotency / no-double-execute
    → mint-sanity
      → per-tx cap
        → daily cap
          → SOL-for-fees
            → freshness (stale decision + dead price feed)
              → rug gate (optional)
                → leg dispatch (fill venue)
```

| # | Gate | `blockedBy` | What it does |
| --- | --- | --- | --- |
| 1 | **Kill-switch** | `kill_switch` | Unconditional global halt. If enabled, nothing executes — first check on every path. |
| 2 | **Idempotency / no-double-execute** | `inflight` (or `noop`) | An idempotency key can never double-execute. A key already `done` returns a `noop`; a key with a broadcast-but-unconfirmed signature returns `inflight` and is **never** re-sent. |
| 3 | **Mint sanity** | `not_whitelisted` | Rejects malformed or identical input/output mints. |
| 4 | **Per-tx cap** | `over_caps` | Blocks any `amountUsd` above `maxPerTxUsd` (and non-positive amounts). |
| 5 | **Daily cap** | `over_daily_cap` | Blocks when the trade would push the user's tracked daily spend past `dailyCapUsd`. |
| 6 | **SOL-for-fees** | `insufficient_sol` | Ensures the wallet holds enough SOL to pay network fees before attempting. |
| 7a | **Freshness — stale decision** | `stale_trigger` | If `evaluatedAtMs` is older than the staleness window, the decision is too old to act on. |
| 7b | **Freshness — dead price feed** | `stale_price` | Refuses to trade blind: if the `PriceSource` returns 0/unavailable for the output mint, block. |
| 8 | **Rug gate (optional)** | `rug` | **Off by default.** The rug score is always computed and recorded; it only *blocks* when the trade opts in with `rugGate: true`. |
| 9 | **Leg dispatch** | — | Only after every gate passes does the runtime hand a `LegContext` to the fill venue. |

The single non-gate outcome is `internal` — an unexpected error before any funds moved.

### The leg is *how* a trade fills — always behind the gates

A **leg** (`ExecutorLeg`) is a pluggable fill venue: Jupiter, a bonding curve, a perps venue, anything. It is the last step, reached only after the full stack has cleared. The leg receives a `LegContext` that `guardedExecute` builds *only once* kill-switch, idempotency, caps, freshness, and (optionally) rug have all passed.

This is the safety guarantee and the moat at once: **a forker adds a fill venue by implementing the `ExecutorLeg` interface, and it is still behind every gate.** There is no public entry point that reaches a leg directly, so you cannot bolt on an unguarded path.

```ts
import type { ExecutorLeg, LegContext } from "@h4rsharma/corine-core";
import type { FillResult } from "@h4rsharma/corine-core";

class MyVenueLeg implements ExecutorLeg {
  readonly name = "my_venue";
  async fill(ctx: LegContext): Promise<FillResult> {
    // ctx is only built AFTER every gate passed.
    // Build → sign (ctx.signer) → broadcast (ctx.rpc), then:
    // MUST call ctx.onBroadcast(sig) the instant you have a signature,
    // so the spine records it and never re-sends.
    return { success: true, txHash: "..." };
  }
}
```

Register it via `createCorine({ legs: [new MyVenueLeg()] })` and route to it with `execute({ leg: "my_venue", ... })`. The default build always ships the `"jupiter"` leg.

### `repositionExistingFunds`

Setting `repositionExistingFunds: true` marks a trade as moving funds you already own (a rebalance or withdrawal) rather than new spend. It **skips the per-tx/daily cap check and the daily-spend record** — but **every other gate still applies** (kill-switch, idempotency, mint sanity, SOL-for-fees, freshness, rug).

---

## The seven interface seams

The SDK depends on **interfaces**, never on concrete endpoints or embedded keys. You supply the implementation plus your keys. Each seam ships with a default adapter you can swap.

| # | Seam | Responsibility | Default adapter(s) |
| --- | --- | --- | --- |
| 1 | **`RpcProvider`** | Read chain state, broadcast + confirm transactions. | `Web3RpcProvider` (@solana/web3.js) |
| 2 | **`Signer`** (+ `Keystore`) | Custody: expose a pubkey and sign. Keystore resolves signers by reference. | `LocalSigner`, `SingleKeystore`, `AesKeystore` |
| 3 | **`PriceSource` + `QuoteSource` + `RugChecker`** | Market data: live prices, routable quotes, rug assessment. | `JupiterClient` (price + quote + swap), `NoopRugChecker` |
| 4 | **`Store`** | Durable safety state: kill-switch, idempotency guard, daily spend, audit. | `InMemoryStore`, `FileStore` |
| 5 | **`Notifier`** | Where the runtime reports what it did. | `ConsoleNotifier`, `SilentNotifier` |
| 6 | **`LLMProvider`** (optional) | Reasoning seam for agents that reason. | `OpenRouterLLM` |
| 7 | **`MemoryStore`** (optional) | Agent memory (episodic + semantic recall). | `InMemoryMemory` |

Plus the pluggable **`ExecutorLeg`** (fill venue), covered above — it depends on the seams (`signer`, `rpc`, `quotes`, `prices`) but is always downstream of the gates.

Two honesty properties are baked in:

- **No embedded secrets.** Every seam that needs a key (RPC, Jupiter portal key, OpenRouter key, AES encryption key) takes it from *your* config. Nothing is hardcoded.
- **Honest degradation.** When an optional seam is absent, the runtime does not fabricate. Without an `LLMProvider`, reasoning agents fall back to their deterministic path. Without a semantic `MemoryStore` backend, recall degrades to keyword-only and reports `semanticAvailable: false`. A dead `PriceSource` blocks the trade rather than trading on a stale value.

---

## The Store as durable safety state

The `Store` is not a cache — it is a set of **safety-critical ledgers**. The spine's guarantees are only as strong as the Store's durability and atomicity:

- **Kill-switch** — the global halt flag (`isKillSwitchEnabled`, `setKillSwitch`, `getKillSwitchReason`).
- **Idempotency guard** — at-most-once execution. `beginGuard` returns whether a key may `proceed`, is `confirm`ing an in-flight signature, is already `done`, or previously `failed`. `recordSentSig` persists a broadcast signature *before* confirmation so a crash mid-confirm cannot double-send.
- **Daily spend ledger** — `checkDailySpend` / `recordDailySpend` back the daily cap, the second backstop on a custodial key.
- **Audit trail** — `recordAudit` persists every attempt (executed / blocked / failed) with the reason, returning an `auditId` you get back on the `GuardedResult`.

The default `InMemoryStore` is fine for development; `FileStore` gives zero-dependency durability. For production scale, implement the `Store` interface over Postgres/SQLite/Redis — but keep the atomicity guarantees, or the no-double-execute and daily-cap guards weaken.

---

## Agents and the type registry

An **agent** runs a typed `Strategy` on a schedule or trigger. The shipped agent types are:

`DCA` · `DIP_BUYER` · `LIMIT_ORDER` · `LADDERED_EXIT` · `WALLET_COPY` · `CUSTOM`

The built-in handlers registered by default are `dcaHandler`, `dipBuyerHandler`, `limitOrderHandler`, and `ladderedExitHandler`. (`WALLET_COPY` and `CUSTOM` are recognized types with no built-in handler — register your own.)

The critical property: **a handler only PROPOSES a trade.** On each tick it returns a `TradeProposal` (or `null`) — it has no power to execute. The `AgentRuntime` turns that proposal into a guarded trade, filling in the strategy's caps, the signer, and a deterministic idempotency key, and runs it through `guardedExecute`. This is safe-by-construction at the agent layer: proposing is the only power a handler has, and the strategy schema makes caps mandatory, so **there is no way to run an uncapped agent.**

```ts
const agent = await corine.agents.deploy({
  userId: "alice",
  strategy: {
    name: "daily-sol-dca",
    agentType: "DCA",
    outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    amountUsd: 10,
    intervalSeconds: 86_400,
    caps: { maxPerTxUsd: 15, dailyCapUsd: 30 }, // mandatory
  },
});

const result = await corine.agents.runOnce(agent.id); // GuardedResult | null
```

The registry is pluggable via `AgentTypeRegistry` — add a new type with `register(handler)` and pass it to `createCorine({ registry })`, or extend the default set. A custom handler's proposals still flow through the exact same spine.

---

## Next steps

- [API Reference](./api-reference.md) — every public export, typed.
- [Safety Model](./safety-model.md) — custody, caps, and the honest limits of each guarantee.
- [Quickstart](./quickstart.md) — install to first guarded trade.
