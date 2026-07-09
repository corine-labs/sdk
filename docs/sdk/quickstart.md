# Quickstart

Install `@corine/core`, wire it to **your own** RPC and key, and run your first guarded trade in under five minutes.

`@corine/core` is the safe-by-construction agent runtime for Solana. There is exactly one way to move funds — `corine.execute()` — and it always passes the same deterministic gate stack (kill-switch, caps, freshness, idempotency, optional rug). You bring your RPC, keys, and data providers; no Corine secret or endpoint is embedded in the SDK.

- Requirements: **Node >= 18**
- License: **Apache-2.0**
- Package: **`@corine/core`** (a companion CLI ships as `@corine/cli`)

---

## 1. Install

```bash
npm install @corine/core
```

## 2. Configure with your keys

`createCorine(config)` is the one-call init. The only required field is `rpc`. To sign trades you also pass a `signer` (or a `keystore`). Everything else has a safe default: in-memory store, console notifier, Jupiter price/quote/leg, rug gate off.

```ts
import { createCorine, LocalSigner } from "@corine/core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },                   // your RPC (or pass an RpcProvider)
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),   // your key, stays local
});
```

> **Custody honesty.** `LocalSigner` (and `AesKeystore`) are **custodial** — the process can sign on the user's behalf. This is disclosed, not hidden. For a non-custodial integration, implement the `Signer.signTransaction` seam against a wallet that prompts the user and never expose a raw keypair. See the [Safety Model](./safety-model.md).

## 3. Your first guarded trade

`execute()` is the only path that trades, and it always runs the full gate stack. **`maxPerTxUsd` and `dailyCapUsd` are mandatory** — there is no uncapped path.

```ts
const result = await corine.execute({
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // buy USDC
  amountUsd: 5,          // inputMint defaults to SOL
  side: "buy",
  maxPerTxUsd: 25,       // required — hard per-trade cap
  dailyCapUsd: 100,      // required — hard daily cap
});
```

## 4. Read the `GuardedResult`

Every call resolves to a `GuardedResult`. Branch on `status`; when it is `"blocked"`, `blockedBy` tells you exactly which gate stopped it.

```ts
switch (result.status) {
  case "executed":
    console.log("Filled:", result.txHash, "slippageBps:", result.slippageBps);
    break;
  case "blocked":
    console.log("Blocked by gate:", result.blockedBy, "—", result.reason);
    break;
  case "noop":
    console.log("Nothing to do (idempotent / in-flight):", result.reason);
    break;
  case "failed":
    console.log("Fill failed:", result.reason);
    break;
}
```

`GuardedResult` fields: `status`, `blockedBy?`, `reason?`, `txHash?`, `fill?`, `slippageBps?`, `rugScore?`, `auditId?`.

## 5. See a gate fire (over-cap)

Ask for more than the per-trade cap and the spine refuses **before any funds move**. No transaction is built or signed.

```ts
const blocked = await corine.execute({
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  amountUsd: 500,        // over the cap
  maxPerTxUsd: 25,
  dailyCapUsd: 100,
});

console.log(blocked.status);    // "blocked"
console.log(blocked.blockedBy); // "over_caps"
console.log(blocked.reason);    // "Amount $500 exceeds the per-trade cap of $25."
```

Every `blockedBy` value maps to a real gate: `"kill_switch"`, `"not_whitelisted"`, `"over_caps"`, `"over_daily_cap"`, `"below_min"`, `"insufficient_sol"`, `"stale_trigger"`, `"stale_price"`, `"rug"`, `"inflight"`, `"internal"`.

## 6. Preview without trading

`quote()` is read-only — it prices a route with no signing and no execution. `price()` returns a live USD price (0 when unavailable).

```ts
const quote = await corine.quote({
  inputMint: "So11111111111111111111111111111111111111112", // SOL
  outputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", // USDC
  amountUsd: 5,
});

const solPrice = await corine.price("So11111111111111111111111111111111111111112");
```

## 7. The kill-switch

The kill-switch is unconditional — the first gate on every path. When enabled, nothing executes.

```ts
await corine.killSwitch.enable("halting for incident review");
await corine.killSwitch.status(); // { enabled: true, reason: "halting for incident review" }
await corine.killSwitch.disable();
```

---

## Next steps

- [Core Concepts](./core-concepts.md) — the runtime, the safety spine walked gate-by-gate, the seven adapter seams, agent types, and the Store as durable safety state.
- [Safety Model](./safety-model.md) — custody, mandatory caps, and what each gate does and does not guarantee.
- [API Reference](./api-reference.md) — every public export with accurate types.
