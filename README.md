# Corine Agent Kit

Open-source, **safe-by-construction** agent runtime for Solana. Extracted from the Corine product so any builder can `npm install`, bring their own keys, and run guarded trades — or fork and extend it.

The differentiator is not more adapters. It is that **every trade goes through one guarded execution spine** (kill-switch → idempotency → mint-sanity → caps → daily cap → SOL-for-fees → freshness → optional rug → fill). There is no public path that trades any other way. A forker adds a venue by implementing an interface, and it is still behind every gate.

## Packages

| Package | What it is |
| --- | --- |
| [`@h4rsharma/corine-core`](core) | The runtime: the guarded spine, the jupiter fill leg, the agent runtime + type registry, the typed strategy schema, and the seven pluggable adapter seams with working defaults. |
| [`@h4rsharma/corine-cli`](cli) | Terminal trading through the same spine: `quote`, `buy`, `sell`, `price`, `kill`, `deploy`, `agents` — human-readable by default, `--json` on every command. Your keys stay local. |

Both are Apache-2.0 and require Node >= 18.

## Quick start

```bash
cd packages/core && npm install && npm run build && npm test
```

```ts
import { createCorine, LocalSigner, SOL_MINT, USDC_MINT } from "@h4rsharma/corine-core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
});

const res = await corine.execute({
  inputMint: SOL_MINT, outputMint: USDC_MINT, amountUsd: 10, side: "buy",
  maxPerTxUsd: 100, dailyCapUsd: 500, evaluatedAtMs: Date.now(),
});
console.log(res.status, res.txHash ?? res.reason);
```

## Docs

Full documentation lives in [`docs/sdk`](docs/sdk): quickstart, core concepts, the safety model (honest custody disclosure), the typed API reference, guides, `llms.txt` / `SKILL.md`, and the MCP reference.

## The rules this project keeps

- **No secrets, ever** — a CI gate (`scripts/check-no-secrets.sh`) hard-fails on any leaked key.
- **The spine is the only execution path** — no raw un-gated swap is exported.
- **Safe by default** — caps mandatory, kill-switch unconditional.
- **Honest** — custodial is called custodial; no "non-custodial"/"safe" overclaims.

See [CONTRIBUTING.md](CONTRIBUTING.md) and [what's open vs hosted](docs/sdk/whats-open.md).
