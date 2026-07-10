/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 *
 * The Corine CLI — terminal trading through the SAME guarded spine as the SDK.
 * Human-readable by default; `--json` on every command for agents/scripts. Keys
 * stay local. Money-moving actions confirm by default (`--yes` to skip); caps +
 * kill-switch always apply because it is the same spine.
 */

import { createInterface } from "node:readline";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { SOL_MINT, USDC_MINT, type Strategy } from "@h4rsharma/corine-core";
import { loadContext, type CliContext } from "./config";

interface Args {
  _: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const _: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      _.push(a);
    }
  }
  return { _, flags };
}

interface Envelope {
  ok: boolean;
  command: string;
  data?: unknown;
  error?: { code: string; message: string };
}

let JSON_MODE = false;

function emit(env: Envelope, human: () => void): void {
  if (JSON_MODE) {
    process.stdout.write(JSON.stringify(env) + "\n");
  } else if (env.ok) {
    human();
  } else {
    process.stderr.write(`✗ ${env.error?.code}: ${env.error?.message}\n`);
  }
  if (!env.ok) process.exitCode = 1;
}

async function confirm(prompt: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  return new Promise((resolve) => {
    rl.question(`${prompt} (y/N) `, (ans) => {
      rl.close();
      resolve(/^y(es)?$/i.test(ans.trim()));
    });
  });
}

function num(v: string | boolean | undefined, name: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) throw new Error(`--${name} must be a positive number`);
  return n;
}

const AGENTS_FILE = process.env.CORINE_AGENTS_FILE ?? join(homedir(), ".corine", "agents.json");

function readAgents(): Array<{ id: string; strategy: Strategy; createdAt: number }> {
  if (!existsSync(AGENTS_FILE)) return [];
  try {
    return JSON.parse(readFileSync(AGENTS_FILE, "utf8"));
  } catch {
    return [];
  }
}
function writeAgents(list: Array<{ id: string; strategy: Strategy; createdAt: number }>): void {
  mkdirSync(dirname(AGENTS_FILE), { recursive: true });
  writeFileSync(AGENTS_FILE, JSON.stringify(list, null, 2), "utf8");
}

const HELP = `corine — terminal trading through the Corine safe-by-construction spine

USAGE
  corine <command> [options]

COMMANDS
  quote      Preview a route (read-only)      --in <mint> --out <mint> --usd <n>
  buy        Guarded buy                       --out <mint> --usd <n> [--in <mint>]
  sell       Guarded sell (to USDC)            --in <mint> --usd <n>
  price      Live USD price                    <mint>
  kill       Kill switch                       on | off | status
  deploy     Deploy an agent                   --type DCA --out <mint> --usd <n> [--interval <sec>]
  agents     List / run agents                 list | run <id>
  help       Show this help

GLOBAL OPTIONS
  --json         Structured output on every command (for agents/scripts)
  --yes          Skip the confirmation prompt on money-moving actions
  --quote-only   Preview the trade without executing (buy/sell)
  --slippage     Slippage in basis points (default: dynamic, clamped 10–300)

ENV
  CORINE_RPC_URL          Your Solana RPC endpoint (required)
  CORINE_KEYPAIR          Solana keyfile path or base58 secret (required to trade)
  CORINE_MAX_PER_TX_USD   Per-trade cap (default 100)
  CORINE_DAILY_CAP_USD    Daily cap (default 500)
  CORINE_JUPITER_KEY      Optional Jupiter portal key
  CORINE_RUG_GATE         Set to 1 to enable the (optional) rug gate

Your keys never leave your machine. Caps + kill-switch apply to every trade —
it is the same spine the SDK uses.`;

async function requireSigner(ctx: CliContext): Promise<void> {
  if (!ctx.hasSigner) throw new Error("CORINE_KEYPAIR is required for this command (a Solana keyfile path or base58 secret).");
}

async function main(): Promise<void> {
  const { _, flags } = parseArgs(process.argv.slice(2));
  JSON_MODE = flags.json === true;
  const command = _[0] ?? "help";

  if (command === "help" || flags.help) {
    if (JSON_MODE) emit({ ok: true, command: "help", data: { commands: ["quote", "buy", "sell", "price", "kill", "deploy", "agents"] } }, () => {});
    else process.stdout.write(HELP + "\n");
    return;
  }

  let ctx: CliContext;
  try {
    ctx = await loadContext();
  } catch (err) {
    return emit({ ok: false, command, error: { code: "config", message: err instanceof Error ? err.message : String(err) } }, () => {});
  }

  try {
    switch (command) {
      case "price": {
        const mint = _[1];
        if (!mint) throw new Error("usage: corine price <mint>");
        const price = await ctx.corine.price(mint);
        return emit({ ok: price > 0, command, data: { mint, priceUsd: price }, error: price > 0 ? undefined : { code: "no_price", message: "No live price for that mint." } },
          () => process.stdout.write(`$${price}\n`));
      }

      case "quote": {
        const inputMint = String(flags.in ?? SOL_MINT);
        const outputMint = String(flags.out ?? "");
        if (!outputMint) throw new Error("usage: corine quote --in <mint> --out <mint> --usd <n>");
        const amountUsd = num(flags.usd, "usd");
        const slippageBps = flags.slippage ? num(flags.slippage, "slippage") : undefined;
        const q = await ctx.corine.quote({ inputMint, outputMint, amountUsd, slippageBps });
        return emit({ ok: true, command, data: { inputMint, outputMint, amountUsd, inAmount: q.inAmount, outAmount: q.outAmount } },
          () => process.stdout.write(`Quote: $${amountUsd} ${inputMint.slice(0, 6)}… → ${outputMint.slice(0, 6)}…\n  in:  ${q.inAmount} (atomic)\n  out: ${q.outAmount} (atomic)\n`));
      }

      case "buy":
      case "sell": {
        await requireSigner(ctx);
        const side = command as "buy" | "sell";
        const inputMint = side === "buy" ? String(flags.in ?? SOL_MINT) : String(flags.in ?? "");
        const outputMint = side === "buy" ? String(flags.out ?? "") : String(flags.out ?? USDC_MINT);
        if (side === "buy" && !outputMint) throw new Error("usage: corine buy --out <mint> --usd <n>");
        if (side === "sell" && !inputMint) throw new Error("usage: corine sell --in <mint> --usd <n>");
        const amountUsd = num(flags.usd, "usd");
        const slippageBps = flags.slippage ? num(flags.slippage, "slippage") : undefined;

        // --quote-only: preview, never execute.
        if (flags["quote-only"]) {
          const q = await ctx.corine.quote({ inputMint, outputMint, amountUsd, slippageBps });
          return emit({ ok: true, command, data: { preview: true, inputMint, outputMint, amountUsd, inAmount: q.inAmount, outAmount: q.outAmount } },
            () => process.stdout.write(`[quote-only] ${side} $${amountUsd}: in ${q.inAmount} → out ${q.outAmount} (atomic). Nothing executed.\n`));
        }

        // Confirmation on money-moving actions unless --yes.
        if (!flags.yes) {
          if (JSON_MODE) throw new Error("confirmation required — pass --yes to execute in --json mode");
          const okd = await confirm(`${side.toUpperCase()} $${amountUsd} of ${(side === "buy" ? outputMint : inputMint).slice(0, 8)}… from ${ctx.walletPubkey?.slice(0, 8)}…?`);
          if (!okd) return emit({ ok: false, command, error: { code: "cancelled", message: "Cancelled." } }, () => {});
        }

        const res = await ctx.corine.execute({
          userId: ctx.walletPubkey ?? "cli",
          surface: "cli",
          side,
          inputMint,
          outputMint,
          amountUsd,
          slippageBps,
          maxPerTxUsd: ctx.caps.maxPerTxUsd,
          dailyCapUsd: ctx.caps.dailyCapUsd,
          rugGate: ctx.caps.rugGate,
          repositionExistingFunds: side === "sell",
          evaluatedAtMs: Date.now(),
        });

        const ok = res.status === "executed";
        return emit(
          {
            ok,
            command,
            data: { status: res.status, txHash: res.txHash ?? null, slippageBps: res.slippageBps, rugScore: res.rugScore ?? null },
            error: ok ? undefined : { code: res.blockedBy ?? res.status, message: res.reason ?? "Trade did not execute." },
          },
          () => process.stdout.write(`✓ ${side} executed — tx ${res.txHash}\n  https://solscan.io/tx/${res.txHash}\n`),
        );
      }

      case "kill": {
        const sub = _[1] ?? "status";
        if (sub === "on") {
          await ctx.corine.killSwitch.enable(String(flags.reason ?? "cli"));
          return emit({ ok: true, command, data: { enabled: true } }, () => process.stdout.write("Kill switch ON — all trades halted.\n"));
        }
        if (sub === "off") {
          await ctx.corine.killSwitch.disable();
          return emit({ ok: true, command, data: { enabled: false } }, () => process.stdout.write("Kill switch OFF — trading resumed.\n"));
        }
        const st = await ctx.corine.killSwitch.status();
        return emit({ ok: true, command, data: st }, () => process.stdout.write(`Kill switch: ${st.enabled ? "ON" : "OFF"}${st.reason ? ` (${st.reason})` : ""}\n`));
      }

      case "deploy": {
        const type = String(flags.type ?? "DCA");
        const outputMint = String(flags.out ?? "");
        if (!outputMint) throw new Error("usage: corine deploy --type DCA --out <mint> --usd <n> [--interval <sec>]");
        const strategy: Strategy = {
          name: String(flags.name ?? `${type} ${outputMint.slice(0, 6)}`),
          agentType: type as Strategy["agentType"],
          outputMint,
          inputMint: String(flags.in ?? SOL_MINT),
          amountUsd: num(flags.usd, "usd"),
          intervalSeconds: flags.interval ? num(flags.interval, "interval") : undefined,
          priceThresholdUsd: flags.threshold ? num(flags.threshold, "threshold") : undefined,
          caps: { maxPerTxUsd: ctx.caps.maxPerTxUsd, dailyCapUsd: ctx.caps.dailyCapUsd, rugGate: ctx.caps.rugGate },
        };
        // Validate through the same schema the runtime enforces (caps mandatory).
        const agent = await ctx.corine.agents.deploy({ strategy, userId: ctx.walletPubkey ?? "cli" });
        const list = readAgents();
        list.push({ id: agent.id, strategy, createdAt: agent.createdAt });
        writeAgents(list);
        return emit({ ok: true, command, data: { id: agent.id, type, outputMint, amountUsd: strategy.amountUsd } },
          () => process.stdout.write(`✓ Deployed ${type} agent ${agent.id}\n  Run a tick: corine agents run ${agent.id}\n`));
      }

      case "agents": {
        const sub = _[1] ?? "list";
        const list = readAgents();
        if (sub === "list") {
          return emit({ ok: true, command, data: { agents: list.map((a) => ({ id: a.id, type: a.strategy.agentType, outputMint: a.strategy.outputMint, amountUsd: a.strategy.amountUsd })) } },
            () => {
              if (list.length === 0) process.stdout.write("No agents. Deploy one: corine deploy --type DCA --out <mint> --usd 5\n");
              else for (const a of list) process.stdout.write(`  ${a.id}  ${a.strategy.agentType}  $${a.strategy.amountUsd}  ${a.strategy.outputMint.slice(0, 8)}…\n`);
            });
        }
        if (sub === "run") {
          await requireSigner(ctx);
          const id = _[2];
          const saved = list.find((a) => a.id === id);
          if (!saved) throw new Error(`unknown agent ${id}`);
          const agent = await ctx.corine.agents.deploy({ strategy: saved.strategy, userId: ctx.walletPubkey ?? "cli" });
          const res = await ctx.corine.agents.runOnce(agent.id);
          return emit({ ok: true, command, data: { id, ran: res != null, result: res ?? "no-action" } },
            () => process.stdout.write(res ? `✓ ${id} ticked — ${res.status}${res.txHash ? ` (${res.txHash})` : ""}\n` : `${id}: no action this tick.\n`));
        }
        throw new Error("usage: corine agents list | run <id>");
      }

      default:
        throw new Error(`unknown command "${command}" — try: corine help`);
    }
  } catch (err) {
    return emit({ ok: false, command, error: { code: "error", message: err instanceof Error ? err.message : String(err) } }, () => {});
  }
}

main();
