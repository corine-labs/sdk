# Contributing to Corine Agent Kit

Thanks for helping build the safe-by-construction agent runtime for Solana. This guide covers the two open packages: `@corine/core` and `@corine/cli`.

## Ground rules (non-negotiable)

1. **No secrets, ever.** No API keys, RPC keys, encryption keys, or private endpoints in code, tests, fixtures, or docs. A leaked key in a public repo is compromised forever. CI runs a secret grep; a hit fails the build. Bring config through the interface seams + env.
2. **The spine is the only execution path.** Do not add a public function that executes a trade outside `guardedExecute`. New fill venues implement the `ExecutorLeg` interface — they run *after* the gate stack, never around it. A PR that exposes a raw/un-gated swap will be closed.
3. **Safe by default.** Caps stay mandatory. The kill-switch stays unconditional. Don't add a bypass flag.
4. **Honest behavior.** No stubs that pretend to work, no "non-custodial"/"safe" overclaims. If something is partial, label it.

## Getting started

```bash
# build the core, then the CLI (which depends on it via file:)
cd packages/core && npm install && npm run build && npm test
cd ../cli && npm install && npm run build
```

- `packages/core` — the SDK. `npm test` runs the end-to-end spine test (mock adapters, no keys).
- `packages/cli` — the CLI. Smoke-test with a throwaway keypair against a public RPC.

## Making a change

1. Fork + branch from `main`.
2. Keep the change typed — every public API has TypeScript types; `npm run typecheck` must pass in both packages.
3. Add or update tests. If you touch the gate stack, add a case to `packages/core/test/spine.test.ts` proving the gate still blocks.
4. Update the docs under `docs/sdk/` if you change public behavior, and the `SKILL.md` / `llms.txt` if you change the public surface.
5. Add the SPDX header to new source files: `// SPDX-License-Identifier: Apache-2.0`.
6. Open a PR describing what changed and why. Note any behavior change to a gate explicitly.

## Adding a fill venue (leg)

Implement `ExecutorLeg` (`{ name, fill(ctx) }`), register it via `createCorine({ legs: [...] })`. Your `fill` MUST call `ctx.onBroadcast(sig)` the instant it has a signature (the no-double-send guarantee). It receives an already-gated context — do not re-implement or skip gates.

## Adding an agent type

Implement `AgentTypeHandler` (`{ type, evaluate(strategy, ctx) }`). A handler may only *propose* a `TradeProposal`; the runtime executes it through the spine with the agent's caps. Register it on an `AgentTypeRegistry`.

## Reporting security issues

Do not open a public issue for a vulnerability. Email the maintainers (see the repo). We especially want to hear about anything that could execute a trade around the gate stack.

By contributing you agree your contributions are licensed under Apache-2.0.
