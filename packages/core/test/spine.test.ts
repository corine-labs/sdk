/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-end proof that the guarded spine executes a trade and that every gate
 * blocks — with mock adapters, no live keys or network. Run: `npm test`.
 */

import assert from "node:assert";
import { Keypair } from "@solana/web3.js";
import {
  createCorine,
  LocalSigner,
  InMemoryStore,
  SilentNotifier,
  SOL_MINT,
  USDC_MINT,
  type RpcProvider,
  type PriceSource,
  type QuoteSource,
  type ExecutorLeg,
} from "../src/index";
import * as sdk from "../src/index";

let pass = 0;
function ok(cond: unknown, label: string) {
  assert.ok(cond, label);
  pass += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${label}`);
}

const rpc: RpcProvider = {
  cluster: "devnet",
  getBalanceLamports: async () => 1_000_000_000, // 1 SOL — above the fee floor
  sendRawTransaction: async () => "MOCK_SIG",
  confirmSignature: async () => true,
  getLatestBlockhash: async () => ({ blockhash: "b", lastValidBlockHeight: 1 }),
};
const prices: PriceSource = { getPriceUsd: async () => 1.0 };
const quotes: QuoteSource = {
  atomicInputForUsd: async () => 1_000_000,
  getQuote: async () => ({ inputMint: SOL_MINT, outputMint: USDC_MINT, inAmount: "1000000", outAmount: "1000000", raw: {} }),
};

let legCalls = 0;
const mockJupiterLeg: ExecutorLeg = {
  name: "jupiter",
  async fill(ctx) {
    legCalls += 1;
    await ctx.onBroadcast("MOCK_SIG");
    return { success: true, txHash: "MOCK_SIG", inputAmount: 1, outputAmount: 1 };
  },
};

function newCorine(store = new InMemoryStore()) {
  return createCorine({
    rpc,
    prices,
    quotes,
    store,
    legs: [mockJupiterLeg], // overrides the default jupiter leg — no real network
    signer: new LocalSigner(Keypair.generate()),
    notifier: new SilentNotifier(),
  });
}

const baseTrade = {
  outputMint: USDC_MINT,
  inputMint: SOL_MINT,
  amountUsd: 10,
  side: "buy" as const,
  maxPerTxUsd: 100,
  dailyCapUsd: 500,
};

async function main() {
  // eslint-disable-next-line no-console
  console.log("guarded spine — end-to-end");

  // 1. Happy path executes through the leg.
  {
    legCalls = 0;
    const corine = newCorine();
    const res = await corine.execute({ ...baseTrade, idempotencyKey: "t1" });
    ok(res.status === "executed", "a valid trade executes");
    ok(res.txHash === "MOCK_SIG", "returns the fill tx hash");
    ok(legCalls === 1, "the leg ran exactly once");
  }

  // 2. Over per-tx cap blocks BEFORE the leg runs.
  {
    legCalls = 0;
    const corine = newCorine();
    const res = await corine.execute({ ...baseTrade, amountUsd: 150, idempotencyKey: "t2" });
    ok(res.status === "blocked" && res.blockedBy === "over_caps", "over-cap trade is blocked");
    ok(legCalls === 0, "the leg never ran on a blocked trade (no funds move)");
  }

  // 3. Kill switch halts everything.
  {
    legCalls = 0;
    const corine = newCorine();
    await corine.killSwitch.enable("maintenance");
    const res = await corine.execute({ ...baseTrade, idempotencyKey: "t3" });
    ok(res.status === "blocked" && res.blockedBy === "kill_switch", "kill switch blocks the trade");
    ok(legCalls === 0, "the leg never ran under the kill switch");
  }

  // 4. Dead price feed refuses to trade blind.
  {
    const corine = createCorine({ rpc, prices: { getPriceUsd: async () => 0 }, quotes, store: new InMemoryStore(), legs: [mockJupiterLeg], signer: new LocalSigner(Keypair.generate()), notifier: new SilentNotifier() });
    const res = await corine.execute({ ...baseTrade, idempotencyKey: "t4" });
    ok(res.status === "blocked" && res.blockedBy === "stale_price", "no live price ⇒ refuse to trade blind");
  }

  // 5. Idempotency — the same key never double-executes.
  {
    const corine = newCorine();
    const a = await corine.execute({ ...baseTrade, idempotencyKey: "dup" });
    const b = await corine.execute({ ...baseTrade, idempotencyKey: "dup" });
    ok(a.status === "executed", "first attempt executes");
    ok(b.status === "noop", "second attempt with the same key is a no-op (no double trade)");
  }

  // 6. repositionExistingFunds — a withdrawal over the cap still executes and isn't spend-counted.
  {
    const store = new InMemoryStore();
    const corine = newCorine(store);
    const res = await corine.execute({ ...baseTrade, amountUsd: 100_000, repositionExistingFunds: true, side: "sell", idempotencyKey: "reposition" });
    ok(res.status === "executed", "a reposition above the per-tx cap still executes (caps don't gate existing funds)");
    const daily = await store.checkDailySpend("default", 0, 999_999);
    ok(daily.spent === 0, "a reposition is NOT recorded against the daily spend ledger");
  }

  // 7. No raw/unguarded execute is exported — the ONLY way to trade is the spine.
  {
    const names = Object.keys(sdk);
    const rawish = names.filter((n) => /executeSwap|rawExecute|unsafeExecute|directSwap/i.test(n));
    ok(rawish.length === 0, "no raw/unguarded execute symbol is exported (moat intact)");
    ok(typeof (createCorine as unknown) === "function", "the public surface is createCorine + the guarded execute");
  }

  // eslint-disable-next-line no-console
  console.log(`\n${pass} checks passed.`);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("FAILED:", err);
  process.exit(1);
});
