# What's open vs. what's hosted

`@h4rsharma/corine-core` and `@h4rsharma/corine-cli` are the **complete, real runtime** — not a teaser. You can `npm install`, bring your own keys, and run a guarded trade with nothing else. This page draws the line so nobody assumes the hosted product's billing or infrastructure is "in the box."

## In the open packages (Apache-2.0)

- **The guarded execution spine** — the full gate stack (kill-switch, idempotency, mint-sanity, caps, daily cap, SOL-for-fees, freshness, optional rug) and leg dispatch. This is the moat, and it's open.
- **The Jupiter fill leg** — real quote → build → sign → broadcast → confirm against public Jupiter endpoints.
- **The agent runtime + type registry** — `DCA`, `DIP_BUYER`, `LIMIT_ORDER`, `LADDERED_EXIT`, `CUSTOM`, and the pluggable registry.
- **The typed strategy/config schema** (zod) with mandatory caps.
- **The seven interface seams** and their default adapters — RPC (`Web3RpcProvider`), data (`JupiterClient`), signer/keystore (`LocalSigner`, `AesKeystore`), store (`InMemoryStore`, `FileStore`), notifier (`ConsoleNotifier`), LLM (`OpenRouterLLM`), memory (`InMemoryMemory`).
- **The CLI** — quote/buy/sell/price/kill/deploy/agents, human + `--json`.
- **The docs, examples, `llms.txt`, `SKILL.md`, and the MCP reference server.**

## NOT in the open packages (stays in the hosted Corine product)

- **Billing / credits / metering and the Dodo Payments integration.** The runtime does not require billing — a trade is never credit-gated. Metering is a hosted bolt-on, not part of the safety spine.
- **x402 monetization** (pay-per-call endpoints, publisher registry, earnings).
- **Hosted infrastructure** — the managed Postgres/Redis, the job queues/workers, the multi-tenant API, admin/kill-switch endpoints, the web dashboard and Telegram bot.
- **Any API key, RPC key, encryption key, or private endpoint.** None are embedded. The zero-secrets rule is enforced by a grep gate in CI; a key in a public repo is compromised forever, so there are none.

## The interface seams are where the two meet

The open SDK depends on **interfaces**; the hosted product supplies production implementations of those same interfaces (a Postgres-backed `Store`, a Helius `RpcProvider`, a Supermemory `MemoryStore`, a Telegram `Notifier`, and so on) plus its own keys. You do exactly the same thing with your keys. Nothing about the hosted product is required to run the open runtime — and nothing secret leaks into it.
