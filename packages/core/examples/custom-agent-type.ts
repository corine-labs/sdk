/*
 * Build a custom agent type. Register a handler that PROPOSES trades; the runtime
 * executes them through the guarded spine. You get the safety guarantees for free
 * — a handler cannot trade directly, it can only propose.
 *
 * In your project:  import { createCorine, AgentTypeRegistry } from "@h4rsharma/corine-core";
 */
import {
  createCorine,
  AgentTypeRegistry,
  BUILTIN_HANDLERS,
  LocalSigner,
  SOL_MINT,
  type AgentTypeHandler,
} from "../src/index";

// A handler that buys only when the token is up >10% vs. a stored reference price.
const momentumHandler: AgentTypeHandler = {
  type: "CUSTOM",
  async evaluate(strategy, ctx) {
    const price = await ctx.prices.getPriceUsd(strategy.outputMint);
    const ref = Number(ctx.state.refPrice ?? price);
    ctx.state.refPrice = price;
    if (!(price > 0) || price < ref * 1.1) return null; // no >10% move
    return {
      side: "buy",
      inputMint: strategy.inputMint,
      outputMint: strategy.outputMint,
      amountUsd: strategy.amountUsd,
      idempotencySuffix: `momentum:${Math.floor(ctx.now / 60000)}`,
      reason: `up >10% (${ref} → ${price})`,
    };
  },
};

const registry = new AgentTypeRegistry();
for (const h of BUILTIN_HANDLERS) registry.register(h);
registry.register(momentumHandler); // add yours

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  registry,
});

const agent = await corine.agents.deploy({
  userId: "me",
  strategy: {
    name: "Momentum",
    agentType: "CUSTOM",
    outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263",
    inputMint: SOL_MINT,
    amountUsd: 5,
    caps: { maxPerTxUsd: 10, dailyCapUsd: 50 },
  },
});
console.log("deployed custom agent", agent.id);
