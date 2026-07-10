/*
 * Run a single guarded swap. There is no unguarded path — this trade passes the
 * SAME gate stack every agent does.
 *
 * In your project:  import { createCorine } from "@h4rsharma/corine-core";
 */
import { createCorine, LocalSigner, SOL_MINT, USDC_MINT, FileStore } from "../src/index";

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  store: new FileStore("./.corine/state.json"), // durable idempotency + daily-cap
});

const result = await corine.execute({
  inputMint: SOL_MINT,
  outputMint: USDC_MINT,
  amountUsd: 10,
  side: "buy",
  maxPerTxUsd: 100, // required
  dailyCapUsd: 500, // required
  evaluatedAtMs: Date.now(),
});

if (result.status === "executed") {
  console.log("✓ executed:", `https://solscan.io/tx/${result.txHash}`);
} else {
  console.log("blocked/failed:", result.blockedBy ?? result.status, "—", result.reason);
}
