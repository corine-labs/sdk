# @h4rsharma/corine-cli

**Terminal trading through the Corine safe-by-construction spine.**

`corine` quotes, buys, sells, deploys agents, and hits the kill switch from your
terminal — human-readable by default, `--json` on every command for scripts and
agents. It is the **same guarded spine** as [`@h4rsharma/corine-core`](../core): your keys
stay local, and the per-trade cap, daily cap, and kill switch apply to every
trade by construction.

## Install

```bash
npm install -g @h4rsharma/corine-cli
```

Requires Node 18+.

## Configure

The CLI reads everything from the environment. Your keys never leave your
machine — the CLI never ships or transmits a key.

```bash
export CORINE_RPC_URL="https://your-rpc-endpoint"          # required
export CORINE_KEYPAIR="$HOME/.config/solana/id.json"       # keyfile path OR base58 secret — stays local
```

| Env var                 | Purpose                                                     | Default |
| ----------------------- | ----------------------------------------------------------- | ------- |
| `CORINE_RPC_URL`        | Your Solana RPC endpoint. **Required.**                     | —       |
| `CORINE_KEYPAIR`        | Solana keyfile path **or** base58 secret. Required to trade. Stays local. | — |
| `CORINE_MAX_PER_TX_USD` | Per-trade cap (USD).                                         | `100`   |
| `CORINE_DAILY_CAP_USD`  | Daily cap (USD).                                             | `500`   |
| `CORINE_JUPITER_KEY`    | Optional Jupiter portal key.                                | —       |
| `CORINE_RUG_GATE`       | Set to `1` to enable the (optional) rug gate.               | off     |
| `CORINE_STATE_FILE`     | Where the durable state (idempotency + daily ledger) lives. | `~/.corine/state.json` |

`price` and `quote` are read-only and work without a keypair. `buy`, `sell`, and
`agents run` require `CORINE_KEYPAIR`.

## Commands

```
corine quote     Preview a route (read-only)    --in <mint> --out <mint> --usd <n>
corine buy       Guarded buy                     --out <mint> --usd <n> [--in <mint>]
corine sell      Guarded sell (to USDC)          --in <mint> --usd <n>
corine price     Live USD price                  <mint>
corine kill      Kill switch                     on | off | status
corine deploy    Deploy an agent                 --type DCA --out <mint> --usd <n> [--interval <sec>]
corine agents    List / run agents               list | run <id>
corine help      Show help
```

### Global flags

| Flag             | Effect                                                                  |
| ---------------- | ----------------------------------------------------------------------- |
| `--json`         | Structured envelope on **every** command (for scripts/agents).          |
| `--yes`          | Skip the confirmation prompt on money-moving actions.                   |
| `--quote-only`   | Preview a `buy`/`sell` without executing.                               |
| `--slippage <bps>` | Slippage in basis points (default: dynamic, clamped 10–300).          |
| `--in <mint>` / `--out <mint>` / `--usd <n>` | Input mint, output mint, and USD size.      |

**Every command in `--json` mode emits the same envelope:**

```json
{ "ok": true, "command": "quote", "data": { } }
{ "ok": false, "command": "buy", "error": { "code": "over_caps", "message": "…" } }
```

### Confirmation & `--json`

Money-moving actions (`buy`, `sell`) **confirm by default** — pass `--yes` to
skip. Because a prompt can't be answered by a script, **`--json` mode requires
`--yes`**: a money-moving `--json` command without `--yes` fails with a
confirmation error rather than hanging.

## Examples

Well-known mints used below:
`SOL = So11111111111111111111111111111111111111112`,
`USDC = EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`.

**Preview a route (read-only, no key needed):**

```bash
corine quote --in So11111111111111111111111111111111111111112 \
             --out EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v \
             --usd 10 --json
```

```json
{"ok":true,"command":"quote","data":{"inputMint":"So111...","outputMint":"EPjFW...","amountUsd":10,"inAmount":"...","outAmount":"..."}}
```

**A buy blocked by the per-trade cap** (default `CORINE_MAX_PER_TX_USD=100`):

```bash
corine buy --out <mint> --usd 999 --json --yes
```

```json
{"ok":false,"command":"buy","data":{"status":"blocked","txHash":null,"slippageBps":50,"rugScore":null},"error":{"code":"over_caps","message":"Amount $999 exceeds the per-trade cap of $100."}}
```

The cap is enforced by the spine, not the CLI — the same block you'd get from the
SDK. Raise it with `CORINE_MAX_PER_TX_USD` if that is genuinely your policy.

**A human-readable buy** (confirms first):

```bash
corine buy --out <mint> --usd 25
# BUY $25 of <mint…> from <wallet…>? (y/N) y
# ✓ buy executed — tx 5xR…
#   https://solscan.io/tx/5xR…
```

**Preview without executing:**

```bash
corine buy --out <mint> --usd 25 --quote-only
# [quote-only] buy $25: in … → out … (atomic). Nothing executed.
```

**Live price:**

```bash
corine price So11111111111111111111111111111111111111112
# $148.20
```

**Kill switch — halt everything:**

```bash
corine kill on
# Kill switch ON — all trades halted.

corine kill status
# Kill switch: ON (cli)

corine kill off
# Kill switch OFF — trading resumed.
```

While the kill switch is on, every `buy`/`sell` (and every agent tick) is blocked
with `kill_switch`.

**Deploy and run an agent:**

```bash
corine deploy --type DCA --out <mint> --usd 5 --interval 3600
# ✓ Deployed DCA agent agent_1_...
#   Run a tick: corine agents run agent_1_...

corine agents list
corine agents run agent_1_...
# ✓ agent_1_... ticked — executed (5xR…)
```

Deployed strategies are saved to `~/.corine/agents.json`; `agents run <id>`
re-instantiates the strategy and runs one tick. **Scheduling is your concern** —
the CLI runs a tick when you invoke it (wire `corine agents run <id>` into cron
or a worker for a real cadence). See
[Deploy and monitor](../../docs/sdk/guides/deploy-and-monitor.md).

## Same spine, keys local

The CLI builds a `Corine` from your env with a durable `FileStore`, then routes
every trade through the identical guarded spine the SDK uses:

```
kill-switch → idempotency → mint-sanity → per-tx cap → daily cap →
SOL-for-fees → freshness → rug (optional) → leg dispatch
```

Your keypair is loaded locally and used to sign locally — it is never
transmitted. This is **custodial to your own machine**: whoever can run the CLI
with your `CORINE_KEYPAIR` can sign for that wallet. The caps + kill switch are
your backstops. Full gate semantics: [safety model](../../docs/sdk/safety-model.md).

## License

Apache-2.0. See [`LICENSE`](./LICENSE).
