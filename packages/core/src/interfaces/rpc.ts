/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * RpcProvider — the seam the runtime uses to read chain state and broadcast
 * transactions. The open SDK depends on this interface, never on a concrete
 * endpoint. YOU supply the implementation + YOUR RPC URL/key (see
 * `Web3RpcProvider` for the default @solana/web3.js adapter).
 *
 * No Corine endpoint or key is ever embedded — a leaked RPC key in a public repo
 * is a catastrophic failure, so the runtime cannot hardcode one.
 */
export interface RpcProvider {
  /** Lamport balance of a base58 pubkey. Return 0 on a read failure — never throw into a gate. */
  getBalanceLamports(pubkey: string): Promise<number>;

  /**
   * Sign-and-send is delegated to the leg; the RpcProvider exposes the raw
   * broadcast + confirm primitives a leg needs. `sendRawTransaction` returns the
   * signature the instant it is broadcast (before confirmation).
   */
  sendRawTransaction(raw: Uint8Array): Promise<string>;

  /** Poll a signature to a terminal state. Resolves `true` on confirm, `false` on timeout/failure. */
  confirmSignature(signature: string, timeoutMs: number): Promise<boolean>;

  /** Latest blockhash for building a transaction. */
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;

  /** Which cluster this provider points at — used only for display/audit. */
  readonly cluster: "mainnet-beta" | "devnet" | "testnet" | string;
}
