# Integrate a frontend

`@h4rsharma/corine-core` is a **server-side** runtime. It holds a signer and talks to an
RPC, so it belongs on your backend — never in a browser bundle. The integration
pattern is simple: run Corine on your server, expose thin endpoints, and call
them from your frontend.

## The custody rule (read this first)

**Never ship a signer or a secret to the browser.** A key in client code is a
key in every user's DevTools. The browser calls *your* backend; your backend
holds the key and runs the guarded spine. This is the honest architecture — the
signer is custodial and lives exactly one place: your server.

```
Browser  ──HTTP──▶  Your backend (holds the key, runs @h4rsharma/corine-core)  ──▶  Solana RPC
   │                        │
   │  quote / execute / kill │  every call still passes the full gate stack
   ▼                        ▼
 no key                 the key never leaves here
```

## A minimal Express backend

Instantiate Corine once, then expose three endpoints: a read-only **quote**
preview, a guarded **execute**, and the **kill switch**.

```ts
import express from "express";
import { createCorine, LocalSigner, FileStore, SOL_MINT } from "@h4rsharma/corine-core";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!), // custodial — stays on the server
  store: new FileStore("./.corine/state.json"),            // durable idempotency + daily cap
});

const app = express();
app.use(express.json());

// ── Preview a route. No signing, no execution — safe to call freely. ──────────
app.post("/api/quote", async (req, res) => {
  const { inputMint = SOL_MINT, outputMint, amountUsd, slippageBps } = req.body;
  try {
    const quote = await corine.quote({ inputMint, outputMint, amountUsd, slippageBps });
    res.json({ ok: true, quote }); // { inAmount, outAmount, ... } — atomic amounts
  } catch (err) {
    res.status(400).json({ ok: false, error: String(err) }); // e.g. no route
  }
});

// ── Execute a guarded trade. Passes the SAME gate stack as everything else. ───
app.post("/api/execute", async (req, res) => {
  const { inputMint = SOL_MINT, outputMint, amountUsd, side = "buy", slippageBps } = req.body;
  const result = await corine.execute({
    userId: req.user.id,   // YOUR auth — attribute the trade + the daily cap to a user
    surface: "web",
    side,
    inputMint,
    outputMint,
    amountUsd,
    slippageBps,
    maxPerTxUsd: 100,      // required — your policy, not the user's
    dailyCapUsd: 500,      // required
    evaluatedAtMs: Date.now(),
  });
  // Return the GuardedResult verbatim — the frontend renders status + reason.
  res.json(result); // { status, blockedBy?, reason?, txHash?, slippageBps?, ... }
});

// ── Global halt. Gate an admin auth check in front of this. ───────────────────
app.post("/api/kill", async (req, res) => {
  if (req.body.on) await corine.killSwitch.enable(req.body.reason ?? "web");
  else await corine.killSwitch.disable();
  res.json(await corine.killSwitch.status()); // { enabled, reason }
});

app.listen(3000);
```

Things to notice:

- **Caps are set server-side.** `maxPerTxUsd` / `dailyCapUsd` are your policy, not
  a value the client sends. Never let the browser choose its own cap.
- **`userId` comes from your auth**, not the request body. The daily-spend ledger
  and the audit trail are keyed by it.
- **The `GuardedResult` is safe to return as-is.** `status`, `blockedBy`, and
  `reason` are exactly what the frontend needs to show "executed", "over your
  daily cap", "no live price", etc.

## Preview before you execute

`corine.quote(...)` is read-only — no signing, no execution. Use it for a
`--quote-only`-style preview so the user sees the route and the expected output
*before* committing. The typical frontend flow:

1. User enters an amount → call `POST /api/quote` → show `outAmount`.
2. User confirms → call `POST /api/execute` → render the returned `status`.

```ts
// Frontend (no keys here — just fetch)
const preview = await fetch("/api/quote", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ outputMint, amountUsd: 10 }),
}).then((r) => r.json());
// show preview.quote.outAmount to the user…

const result = await fetch("/api/execute", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ outputMint, amountUsd: 10 }),
}).then((r) => r.json());

if (result.status === "executed") {
  showLink(`https://solscan.io/tx/${result.txHash}`);
} else {
  showError(result.reason); // e.g. "This would exceed your daily cap of $500 …"
}
```

## Rendering a blocked result

Because every gate returns a specific `blockedBy`, your UI can be precise instead
of generic. A small mapping goes a long way:

```ts
const MESSAGES: Record<string, string> = {
  kill_switch: "Trading is paused right now.",
  over_caps: "That's above the per-trade limit.",
  over_daily_cap: "You've hit your daily limit.",
  insufficient_sol: "Not enough SOL for network fees.",
  stale_price: "No live price for that token — try again shortly.",
  rug: "That token was flagged as risky.",
  inflight: "A trade for this is already in progress.",
};

const label = result.blockedBy ? MESSAGES[result.blockedBy] : result.reason;
```

## What stays on the server, always

- the **signer / secret key** — custodial, one place, never bundled;
- the **caps policy** — set per request from your own logic;
- the **`Store`** (idempotency, daily ledger, audit) — see
  [The durable store](./durable-store.md);
- the **kill switch admin path** — put your admin auth in front of it.

The browser gets thin, keyless endpoints and the `GuardedResult` to render. The
key never leaves your backend. For the full gate list and honest custody
framing, see the [safety model](../safety-model.md).
