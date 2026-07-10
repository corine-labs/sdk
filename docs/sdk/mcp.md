# MCP — expose the SDK to an LLM

MCP (the Model Context Protocol) is how an LLM host (Claude, an agent framework, an IDE) calls a tool. Exposing `@h4rsharma/corine-core` over MCP lets an agent quote, buy, sell, check a price and hit the kill switch — **through the guarded spine**, because these tools are thin wrappers over `corine.execute` / `corine.quote`. There is no MCP tool that trades un-gated; the same caps and kill-switch apply.

> Whether an LLM can call your SDK is decided by whether you ship an MCP surface. This page is the reference — a complete, working server you can copy.

## Design

Five tools, each mapping to a `Corine` method:

| MCP tool | Maps to | Money-moving? |
| --- | --- | --- |
| `corine_price` | `corine.price(mint)` | no |
| `corine_quote` | `corine.quote(...)` | no (preview) |
| `corine_buy` | `corine.execute({ side: "buy", ... })` | yes |
| `corine_sell` | `corine.execute({ side: "sell", repositionExistingFunds: true, ... })` | yes |
| `corine_kill` | `corine.killSwitch.enable/disable/status` | control |

The caps come from the server's env (never from the model) — the model cannot raise its own limit. Money-moving tools return the `GuardedResult` verbatim, including a `blocked` outcome, so the host reports it honestly.

## Reference server

Requires `@modelcontextprotocol/sdk` and `@h4rsharma/corine-core`. Your keys come from the server's environment — never from the model, never committed.

```ts
// mcp-server.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { createCorine, LocalSigner, FileStore, SilentNotifier, SOL_MINT, USDC_MINT } from "@h4rsharma/corine-core";

const corine = createCorine({
  rpc: { endpoint: process.env.CORINE_RPC_URL! },
  signer: process.env.CORINE_KEYPAIR ? LocalSigner.fromJson(process.env.CORINE_KEYPAIR) : undefined,
  store: new FileStore(process.env.CORINE_STATE_FILE ?? "./.corine/state.json"),
  notifier: new SilentNotifier(),
});

// Caps come from the SERVER env — the model cannot raise its own limit.
const caps = {
  maxPerTxUsd: Number(process.env.CORINE_MAX_PER_TX_USD ?? 100),
  dailyCapUsd: Number(process.env.CORINE_DAILY_CAP_USD ?? 500),
};

const server = new McpServer({ name: "corine", version: "0.1.0" });

server.tool("corine_price", { mint: z.string() }, async ({ mint }) => {
  const priceUsd = await corine.price(mint);
  return { content: [{ type: "text", text: JSON.stringify({ mint, priceUsd }) }] };
});

server.tool(
  "corine_quote",
  { inputMint: z.string().default(SOL_MINT), outputMint: z.string(), amountUsd: z.number().positive() },
  async ({ inputMint, outputMint, amountUsd }) => {
    const q = await corine.quote({ inputMint, outputMint, amountUsd });
    return { content: [{ type: "text", text: JSON.stringify({ inAmount: q.inAmount, outAmount: q.outAmount }) }] };
  },
);

server.tool(
  "corine_buy",
  { outputMint: z.string(), amountUsd: z.number().positive(), inputMint: z.string().default(SOL_MINT) },
  async ({ outputMint, amountUsd, inputMint }) => {
    const res = await corine.execute({
      side: "buy", inputMint, outputMint, amountUsd,
      maxPerTxUsd: caps.maxPerTxUsd, dailyCapUsd: caps.dailyCapUsd, evaluatedAtMs: Date.now(),
    });
    // Return the guarded result verbatim — including a `blocked` outcome.
    return { content: [{ type: "text", text: JSON.stringify(res) }] };
  },
);

server.tool(
  "corine_sell",
  { inputMint: z.string(), amountUsd: z.number().positive(), outputMint: z.string().default(USDC_MINT) },
  async ({ inputMint, amountUsd, outputMint }) => {
    const res = await corine.execute({
      side: "sell", inputMint, outputMint, amountUsd, repositionExistingFunds: true,
      maxPerTxUsd: caps.maxPerTxUsd, dailyCapUsd: caps.dailyCapUsd, evaluatedAtMs: Date.now(),
    });
    return { content: [{ type: "text", text: JSON.stringify(res) }] };
  },
);

server.tool("corine_kill", { action: z.enum(["on", "off", "status"]) }, async ({ action }) => {
  if (action === "on") await corine.killSwitch.enable("mcp");
  else if (action === "off") await corine.killSwitch.disable();
  return { content: [{ type: "text", text: JSON.stringify(await corine.killSwitch.status()) }] };
});

await server.connect(new StdioServerTransport());
```

## Register it

With Claude Code / Claude Desktop, add to your MCP config:

```json
{
  "mcpServers": {
    "corine": {
      "command": "node",
      "args": ["mcp-server.js"],
      "env": {
        "CORINE_RPC_URL": "https://your-rpc",
        "CORINE_KEYPAIR": "/path/to/keypair.json",
        "CORINE_MAX_PER_TX_USD": "50",
        "CORINE_DAILY_CAP_USD": "200"
      }
    }
  }
}
```

The model now has `corine_price`, `corine_quote`, `corine_buy`, `corine_sell`, `corine_kill`. It cannot bypass the caps or the kill switch — the tools are the spine.
