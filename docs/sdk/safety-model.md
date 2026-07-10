# Safety model

This SDK is called **safe-by-construction** for one specific, verifiable reason: **there is no public path that executes a trade without passing the gate stack.** This page states exactly what that does and does not protect you from — honestly, with no "non-custodial" or "your funds are safe" overclaims.

## What "safe-by-construction" means here

Every trade — a one-shot `corine.execute(...)`, a CLI `buy`, or an agent action — goes through the single `guardedExecute` spine. The gate order is fixed:

```
kill-switch → idempotency → mint-sanity → per-tx cap → daily cap
  → SOL-for-fees → freshness (stale decision + dead price feed)
  → rug gate (optional) → leg dispatch (fill venue)
```

The fill venue (the "leg") is the only pluggable part, and it runs **only after** every applicable gate has passed. A forker who adds a venue implements the `ExecutorLeg` interface — and their venue is still behind the full stack. The package deliberately **does not export** a raw `executeSwap` / `sendTransaction` trade path. Making the unsafe thing easy is a non-goal.

You can verify this yourself: `grep -r "executeSwap\|rawExecute\|unsafeExecute" node_modules/@h4rsharma/corine-core/dist` returns nothing tradeable, and the end-to-end test (`packages/core/test/spine.test.ts`) asserts no such symbol is exported.

## Custody: this is custodial when you sign in-process

**Be honest with your users.** When you configure a `LocalSigner` or `AesKeystore`, the runtime holds — or can decrypt — a private key and **signs on the user's behalf without a per-transaction wallet prompt.** That is a **custodial / delegated** model. It is the right model for autonomous agents and terminal trading, but it is custody, and you must disclose it as such.

| You configure… | Custody reality |
| --- | --- |
| `LocalSigner` (a keypair you load) | **Custodial** — the process can sign any transaction the spine builds. |
| `AesKeystore` (encrypted keys + your AES key) | **Custodial** — whoever holds the AES key can sign for those wallets. |
| Your own `Signer` that prompts a wallet | **User-signed** — the runtime calls `signTransaction`; the user approves each one. |

The SDK never calls itself "non-custodial." The caps and the kill-switch are **backstops on a custodial key**, not a replacement for custody. Do not tell users their funds are "safe" — tell them the exact limits below are enforced.

## What the gates actually guarantee

- **Kill-switch** — a global halt. When on, *every* trade (including agent ticks and CLI buys) is blocked with `kill_switch`. It is unconditional: there is no flag that bypasses it. Withdrawals go through it too (an unstake is itself a swap through the protected path).
- **Per-trade cap (`maxPerTxUsd`)** — a proposal above it is blocked with `over_caps`. **Mandatory** — the strategy schema will not validate without it.
- **Daily cap (`dailyCapUsd`)** — the second backstop; a trade that would exceed the user's daily total is blocked with `over_daily_cap`. Durable only if your `Store` is durable (see below).
- **SOL-for-fees** — refuses to trade when the wallet can't cover fees (`insufficient_sol`), so you never broadcast a doomed transaction.
- **Freshness** — refuses to trade on a stale decision (`stale_trigger`) or when there is no live price (`stale_price`). "No live price ⇒ don't trade blind."
- **Idempotency / no-double-send** — a deterministic `idempotencyKey` can never execute twice; a signature is recorded the instant it is broadcast, so a crash mid-confirm reconciles instead of re-sending.
- **Rug gate (optional, OFF by default)** — when off, the rug score is still **computed and recorded** (visibility), it just never blocks. When on, flagged tokens are blocked. It is the *only* optional gate; every other gate is unconditional. With the default `NoopRugChecker` the score is always 100 — the SDK does not pretend to judge token safety until you plug in a real `RugChecker`.

## What the gates do NOT protect against

Stated plainly:

- **Market risk.** Caps limit size, not loss. A capped trade can still go to zero.
- **A compromised key.** If your `LocalSigner` key or `AesKeystore` encryption key leaks, the attacker can sign within the caps — and could disable the kill-switch if they control your `Store`. Protect keys and the store like production secrets.
- **A malicious or buggy leg / RPC / data source.** You choose the adapters. A dishonest `PriceSource` (returning a fake price instead of 0) defeats the freshness gate. Use sources you trust.
- **Slippage beyond the clamp.** Slippage is bounded to `[10, 300]` bps by default, but fills still move price.
- **Durability you didn't configure.** With the default `InMemoryStore`, idempotency and the daily cap **reset on restart**. For real deployments use `FileStore` or a `Store` backed by Postgres/SQLite/Redis. This is a real limitation, not a footnote.

## Your responsibilities

1. **Disclose custody** to your users in your own UI — do not inherit an overclaim.
2. **Use a durable `Store`** in production (`FileStore` at minimum).
3. **Keep keys and the store secret** — the kill-switch and caps live in the store.
4. **Plug a real `RugChecker`** if you want the rug gate to mean anything, and turn it on.
5. **Bring your own keys** for RPC / data / LLM — none are embedded, and none should be committed.

The guarantee this SDK makes is narrow and real: **you cannot execute a trade that skips the gate stack.** Everything else is your configuration and your disclosure.
