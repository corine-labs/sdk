/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { Keypair, VersionedTransaction, Transaction } from "@solana/web3.js";

/**
 * Signer — the custody seam. The runtime never sees raw private key material
 * beyond what YOUR signer chooses to expose. The default `LocalSigner` wraps a
 * `Keypair` you load from disk/env; `AesKeystore` decrypts an
 * AES-256-GCM-encrypted key with a key YOU supply (mirrors Corine's hosted
 * custody, but the encryption key is never embedded).
 *
 * Honesty note: a signer that hands the runtime a live `Keypair` is CUSTODIAL —
 * the process can sign on the user's behalf. This is disclosed, not hidden.
 * A non-custodial integration implements `signTransaction` by prompting a wallet
 * and never exposes `keypair`.
 */
export interface Signer {
  /** The base58 public key that will sign. */
  publicKey(): Promise<string>;

  /**
   * Sign a transaction. Custodial signers sign in-process; wallet-backed signers
   * prompt the user. Either way the runtime only ever calls this method.
   */
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;

  /**
   * Optional escape hatch for legs that build+sign+broadcast internally (e.g. a
   * venue SDK that needs a raw Keypair). Only custodial signers implement it;
   * wallet signers leave it undefined and such legs are simply unavailable.
   */
  keypair?(): Promise<Keypair>;
}

/**
 * Keystore — provisions/loads signers by a stable reference (e.g. a userId or
 * agentId). Lets the runtime work with many custodial wallets without holding
 * key material itself.
 */
export interface Keystore {
  /** Resolve a Signer for a stable reference. Throws if the wallet isn't provisioned. */
  getSigner(ref: string): Promise<Signer>;
}
