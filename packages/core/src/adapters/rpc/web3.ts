/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Connection, PublicKey } from "@solana/web3.js";
import type { RpcProvider } from "../../interfaces/rpc";

export interface Web3RpcOptions {
  /** YOUR RPC endpoint. Required — no endpoint is embedded. May carry a provider key. */
  endpoint: string;
  commitment?: "processed" | "confirmed" | "finalized";
  cluster?: RpcProvider["cluster"];
}

/**
 * Web3RpcProvider — the default `RpcProvider` over @solana/web3.js. Construct it
 * with YOUR endpoint (`createCorine({ rpc: { endpoint } })` does this for you).
 * Works against mainnet-beta or devnet.
 */
export class Web3RpcProvider implements RpcProvider {
  readonly cluster: RpcProvider["cluster"];
  private readonly conn: Connection;
  private readonly commitment: "processed" | "confirmed" | "finalized";

  constructor(opts: Web3RpcOptions) {
    if (!opts.endpoint) throw new Error("Web3RpcProvider requires an endpoint — supply your own RPC URL.");
    this.commitment = opts.commitment ?? "confirmed";
    this.conn = new Connection(opts.endpoint, this.commitment);
    this.cluster = opts.cluster ?? (/devnet/.test(opts.endpoint) ? "devnet" : "mainnet-beta");
  }

  /** Expose the underlying Connection for adapters/legs that need richer reads. */
  get connection(): Connection {
    return this.conn;
  }

  async getBalanceLamports(pubkey: string): Promise<number> {
    try {
      return await this.conn.getBalance(new PublicKey(pubkey), this.commitment);
    } catch {
      return 0;
    }
  }

  async sendRawTransaction(raw: Uint8Array): Promise<string> {
    return this.conn.sendRawTransaction(raw, { skipPreflight: false, maxRetries: 3 });
  }

  async confirmSignature(signature: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value } = await this.conn.getSignatureStatuses([signature]);
      const st = value[0];
      if (st) {
        if (st.err) return false;
        if (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized") return true;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    return false;
  }

  async getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    return this.conn.getLatestBlockhash(this.commitment);
  }
}
