# Build a custom agent type

An agent type decides *when* to trade. In `@h4rsharma/corine-core`, that decision is the
only power a strategy handler has — it **proposes** a trade, and the runtime
executes the proposal through the [guarded spine](../safety-model.md). A handler
can never touch a fill venue, a signer, or the caps directly. This is the
safe-by-construction guarantee at the agent layer: proposing is all a handler
can do.

The SDK ships four built-in types (`DCA`, `DIP_BUYER`, `LIMIT_ORDER`,
`LADDERED_EXIT`). This guide adds a fifth of your own under the `CUSTOM` type.

## The contract

A handler implements `AgentTypeHandler`:

```ts
interface AgentTypeHandler {
  readonly type: AgentType; // "DCA" | "DIP_BUYER" | "LIMIT_ORDER" | "LADDERED_EXIT" | "WALLET_COPY" | "CUSTOM"
  evaluate(strategy: ResolvedStrategy, ctx: AgentContext): Promise<TradeProposal | null>;
}
```

`evaluate` is called once per tick. Return `null` to do nothing this tick.

The context you get is deliberately small — you cannot reach the executor from
here:

```ts
interface AgentContext {
  prices: PriceSource;          // getPriceUsd(mint) — live USD price (0 when unavailable)
  now: number;                  // Date.now() at tick time
  state: Record<string, unknown>; // per-agent scratch, persisted across ticks by the runtime
}
```

What you return:

```ts
interface TradeProposal {
  side: "buy" | "sell";
  inputMint: string;
  outputMint: string;
  amountUsd: number;
  inputAmountAtomic?: string;      // exact atomic input for token-denominated sells
  leg?: string;                    // fill venue, defaults to "jupiter"
  repositionExistingFunds?: boolean; // true for a sell/exit (skips the spend caps, not the other gates)
  idempotencySuffix: string;       // deterministic; the runtime appends it to the agent's idempotency key
  reason: string;                  // surfaced in logs + the audit trail
}
```

The runtime turns this into a `GuardedTrade` — filling in the agent's caps, the
signer resolved from your keystore, and the idempotency key
(`agent:<agentId>:<idempotencySuffix>`) — then runs `guardedExecute`. The caps
come from `strategy.caps`, not from your handler. There is no way to propose an
uncapped trade.

> **Why `idempotencySuffix` matters.** Two ticks that produce the *same* suffix
> can never double-execute — the idempotency gate dedupes them. Bucket it by
> whatever cadence you want to be at-most-once (e.g. one buy per minute:
> `momentum:${Math.floor(ctx.now / 60000)}`).

## A full, runnable example

A `CUSTOM` momentum handler: buy only when the token is up more than 10% versus a
reference price it stores across ticks. This mirrors
`packages/core/examples/custom-agent-type.ts`.

```ts
import {
  createCorine,
  AgentTypeRegistry,
  BUILTIN_HANDLERS,
  LocalSigner,
  SOL_MINT,
  type AgentTypeHandler,
} from "@h4rsharma/corine-core";

// A handler that buys only when the token is up >10% vs. a stored reference price.
const momentumHandler: AgentTypeHandler = {
  type: "CUSTOM",
  async evaluate(strategy, ctx) {
    const price = await ctx.prices.getPriceUsd(strategy.outputMint);
    const ref = Number(ctx.state.refPrice ?? price);
    ctx.state.refPrice = price; // remembered for the next tick
    if (!(price > 0) || price < ref * 1.1) return null; // no live price, or no >10% move

    return {
      side: "buy",
      inputMint: strategy.inputMint,
      outputMint: strategy.outputMint,
      amountUsd: strategy.amountUsd,
      idempotencySuffix: `momentum:${Math.floor(ctx.now / 60000)}`, // at most one buy/min
      reason: `up >10% (${ref} → ${price})`,
    };
  },
};
```

Register it alongside the built-ins so the default types still work, then pass
the registry to `createCorine`:

```ts
const registry = new AgentTypeRegistry();
for (const h of BUILTIN_HANDLERS) registry.register(h); // keep DCA/DIP_BUYER/LIMIT_ORDER/LADDERED_EXIT
registry.register(momentumHandler);                     // add yours

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!), // custodial — see note below
  registry,
});
```

> If you pass your own `registry`, `createCorine` does **not** auto-register the
> built-ins — you own the registry, so register everything you want on it. The
> loop above does exactly that.

Deploy an agent of your new type. Caps are mandatory; the strategy is
zod-validated on deploy:

```ts
const agent = await corine.agents.deploy({
  userId: "me",
  strategy: {
    name: "Momentum",
    agentType: "CUSTOM",
    outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    inputMint: SOL_MINT,
    amountUsd: 5,
    caps: { maxPerTxUsd: 10, dailyCapUsd: 50 }, // required — there is no uncapped agent
  },
});

console.log("deployed custom agent", agent.id);
```

Run a tick whenever your scheduler fires (the SDK does not run a background
loop — see [Deploy and monitor](./deploy-and-monitor.md)):

```ts
const result = await corine.agents.runOnce(agent.id);
console.log(agent.id, "→", result?.status ?? "no-action"); // "executed" | "blocked" | "failed" | "noop" | no-action
```

## What you get for free

Because your handler only proposes, every proposal it emits still passes the
full gate stack before any funds move:

```
kill-switch → idempotency → mint-sanity → per-tx cap → daily cap →
SOL-for-fees → freshness (stale decision + dead price feed) → rug (optional) → leg dispatch
```

Concretely, that means a buggy handler cannot:

- exceed `caps.maxPerTxUsd` or `caps.dailyCapUsd` — those gates are unconditional;
- trade a token with no live price — the freshness gate blocks a `0` price;
- double-send across a restart — the idempotency gate dedupes on the key;
- trade while the kill switch is on.

You write *intent*. The runtime enforces *safety*. See the
[safety model](../safety-model.md) for exactly what each gate does and does not
protect against.

## Registry API

```ts
const registry = new AgentTypeRegistry();
registry.register(handler); // returns the registry (chainable)
registry.get("CUSTOM");     // AgentTypeHandler | undefined
registry.has("CUSTOM");     // boolean
registry.types();           // string[] of registered type names
```

## A note on custody

`LocalSigner` is a **custodial** signer: the runtime holds and uses the key you
load to sign trades on your behalf. That is the honest description — this is not
"non-custodial." Whoever can run this process can sign for this wallet. Keep the
key server-side and scoped, and lean on the mandatory caps + kill switch as your
backstops.
