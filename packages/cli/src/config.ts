/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createCorine, LocalSigner, FileStore, SilentNotifier, type Corine } from "@h4rsharma/corine-core";

export interface CliContext {
  corine: Corine;
  hasSigner: boolean;
  caps: { maxPerTxUsd: number; dailyCapUsd: number; rugGate: boolean };
  walletPubkey: string | null;
}

/**
 * Build a Corine from the environment. YOUR keys stay local — the CLI never
 * ships or transmits a key. Required: CORINE_RPC_URL. For money-moving commands:
 * CORINE_KEYPAIR (a Solana CLI keyfile path OR a base58 secret).
 */
export async function loadContext(): Promise<CliContext> {
  const rpcUrl = process.env.CORINE_RPC_URL;
  if (!rpcUrl) throw new Error("CORINE_RPC_URL is required (your Solana RPC endpoint).");

  let signer: LocalSigner | undefined;
  let walletPubkey: string | null = null;
  const keyRef = process.env.CORINE_KEYPAIR;
  if (keyRef) {
    const raw = keyRef.trim().startsWith("[") || keyRef.includes("/") || keyRef.includes("\\")
      ? readFileSync(keyRef, "utf8")
      : keyRef;
    signer = LocalSigner.fromJson(raw);
    walletPubkey = await signer.publicKey();
  }

  const stateFile = process.env.CORINE_STATE_FILE ?? join(homedir(), ".corine", "state.json");
  const caps = {
    maxPerTxUsd: Number(process.env.CORINE_MAX_PER_TX_USD ?? 100),
    dailyCapUsd: Number(process.env.CORINE_DAILY_CAP_USD ?? 500),
    rugGate: ["1", "true", "on", "yes"].includes((process.env.CORINE_RUG_GATE ?? "").toLowerCase()),
  };

  const corine = createCorine({
    rpc: { endpoint: rpcUrl },
    signer,
    store: new FileStore(stateFile),
    jupiter: { apiKey: process.env.CORINE_JUPITER_KEY },
    notifier: new SilentNotifier(), // the CLI renders its own output
  });

  return { corine, hasSigner: Boolean(signer), caps, walletPubkey };
}
