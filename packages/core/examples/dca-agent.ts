/*
 * Deploy a DCA agent in ~10 lines. Every buy it makes goes through the guarded
 * spine (kill-switch, caps, freshness, idempotency) — by construction.
 *
 * In your project:  import { createCorine } from "@corine/core";
 */
import { createCorine, LocalSigner, SOL_MINT } from "../src/index";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! }, // your RPC
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!), // your key, stays local
});

const agent = await corine.agents.deploy({
  userId: "me",
  strategy: {
    name: "BONK DCA",
    agentType: "DCA",
    outputMint: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", // BONK
    inputMint: SOL_MINT,
    amountUsd: 5, // $5 each interval
    intervalSeconds: 3600, // hourly
    caps: { maxPerTxUsd: 10, dailyCapUsd: 50 }, // caps are MANDATORY
  },
});

// Call this on a schedule (cron, a worker, or `corine agents run <id>`).
const result = await corine.agents.runOnce(agent.id);
console.log(agent.id, "→", result?.status ?? "no-action");
