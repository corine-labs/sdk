# Plug in a data source

The runtime depends on **interfaces**, not on any provider. Prices, quotes, and
rug assessments are three separate seams — swap Jupiter for Birdeye, Pyth, your
own cache, or an in-house service without touching the spine. This guide covers
all three, and the one rule that keeps a swap safe.

## The one rule: return `0` when you can't price

The freshness gate refuses to trade on a token it can't get a **live** price
for. It treats `0` as "no price — refuse to trade blind." So a correct
`PriceSource` returns `0` (never a stale cached value) when it genuinely cannot
price a mint. Returning a stale number is the one way to defeat the freshness
gate — don't.

```ts
interface PriceSource {
  /** Live USD price of a mint. Return 0 when unavailable — the gate treats 0 as "refuse". */
  getPriceUsd(mint: string): Promise<number>;
}
```

## Example: a Birdeye price source

This mirrors `packages/core/examples/custom-data-source.ts`. Your API key comes
from your own env — no data credential is ever embedded in the SDK.

```ts
import { createCorine, LocalSigner, type PriceSource } from "@h4rsharma/corine-core";

class BirdeyePriceSource implements PriceSource {
  constructor(private readonly apiKey: string) {}

  async getPriceUsd(mint: string): Promise<number> {
    try {
      const res = await fetch(`https://public-api.birdeye.so/defi/price?address=${mint}`, {
        headers: { "X-API-KEY": this.apiKey, "x-chain": "solana" },
      });
      if (!res.ok) return 0;
      const body: any = await res.json();
      const p = Number(body?.data?.value);
      return Number.isFinite(p) && p > 0 ? p : 0; // 0 ⇒ "refuse to trade blind"
    } catch {
      return 0; // network error, timeout, bad payload → refuse, don't guess
    }
  }
}

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  prices: new BirdeyePriceSource(process.env.BIRDEYE_API_KEY!), // your key, your source
});

console.log(
  "SOL price via Birdeye:",
  await corine.price("So11111111111111111111111111111111111111112"),
);
```

Every failure path here returns `0`: a non-`2xx` response, a thrown fetch, a
missing field, a non-positive number. That is the safe default — the spine
blocks with `stale_price` rather than trading on a guess.

## The quote seam

`prices` answers "what is it worth?"; `quotes` answers "what route fills this,
and for how much?" The default `JupiterClient` implements **both** `PriceSource`
and `QuoteSource`, so overriding only `prices` (as above) still leaves Jupiter
doing the routing. Override `quotes` when you want a different router.

```ts
interface QuoteSource {
  /** Atomic input amount for a USD notional of `inputMint`. */
  atomicInputForUsd(inputMint: string, usdNotional: number): Promise<number>;
  /** A routable quote. Throw if no route exists — routability is proven here. */
  getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;      // atomic input
    slippageBps: number;
  }): Promise<SwapQuote>;
}

interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;   // atomic input the quote priced
  outAmount: string;  // atomic output expected
  raw: unknown;       // opaque venue payload the fill leg passes back to build the tx
}
```

`getQuote` should **throw** when no route exists — routability is proven at quote
time, so a token that can't be filled never reaches the fill leg. Pass your
implementation as `quotes`:

```ts
const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  quotes: new MyRouter(),  // your QuoteSource
  prices: new BirdeyePriceSource(process.env.BIRDEYE_API_KEY!),
});
```

## The rug seam

`RugChecker` powers the **optional** rug gate. It always *runs* (the score is
computed and recorded so a UI can surface it), but it only *blocks* when a trade
opts in via `caps.rugGate: true`. Every other gate is unconditional.

```ts
interface RugChecker {
  checkToken(mint: string, opts?: { liquidityUsdOverride?: number }): Promise<RugAssessment>;
}

interface RugAssessment {
  score: number;   // 0–100, higher is safer
  flags: string[]; // human-readable reasons that lowered the score
}
```

The default is `NoopRugChecker` (returns a safe score — the gate never blocks
until you provide a real assessor). Wire in your own on-chain heuristics or a
provider:

```ts
const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  rug: new MyRugChecker(), // used whenever a trade sets caps.rugGate: true
});
```

With the default safety thresholds, a score below `40` hard-blocks and a score
below `70` warns (blockable unless the caller acknowledges the risk).

## Defaults at a glance

| Seam          | Interface     | Default          | You bring                          |
| ------------- | ------------- | ---------------- | ---------------------------------- |
| Prices        | `PriceSource` | `JupiterClient`  | Birdeye, Pyth, your cache          |
| Quotes/routes | `QuoteSource` | `JupiterClient`  | your router                        |
| Rug/risk      | `RugChecker`  | `NoopRugChecker` | your on-chain heuristics / provider |

Swap any one independently. The spine is identical regardless of which data
sources you plug in — see the [safety model](../safety-model.md).
