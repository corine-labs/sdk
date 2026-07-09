/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import { Keypair, Transaction, VersionedTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import type { Signer, Keystore } from "../../interfaces/signer";

/**
 * LocalSigner — a CUSTODIAL signer backed by a `Keypair` you load yourself
 * (from a file, env var, or base58 string). The safe way to run the CLI + a
 * single-wallet agent. Keys live wherever YOU put them; the SDK never generates
 * or stores a key on your behalf here.
 */
export class LocalSigner implements Signer {
  constructor(private readonly kp: Keypair) {}

  static fromBase58(secretKeyBase58: string): LocalSigner {
    return new LocalSigner(Keypair.fromSecretKey(bs58.decode(secretKeyBase58)));
  }

  static fromSecretKey(secretKey: Uint8Array): LocalSigner {
    return new LocalSigner(Keypair.fromSecretKey(secretKey));
  }

  /** Load a Solana CLI keypair JSON (array of bytes) or a base58 secret string. */
  static fromJson(json: string): LocalSigner {
    const trimmed = json.trim();
    if (trimmed.startsWith("[")) {
      return LocalSigner.fromSecretKey(Uint8Array.from(JSON.parse(trimmed) as number[]));
    }
    return LocalSigner.fromBase58(trimmed);
  }

  async publicKey(): Promise<string> {
    return this.kp.publicKey.toBase58();
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this.kp]);
    } else {
      (tx as Transaction).partialSign(this.kp);
    }
    return tx;
  }

  async keypair(): Promise<Keypair> {
    return this.kp;
  }
}

/** A single-signer Keystore — every ref resolves to the same local signer (CLI/single-wallet use). */
export class SingleKeystore implements Keystore {
  constructor(private readonly signer: Signer) {}
  async getSigner(): Promise<Signer> {
    return this.signer;
  }
}
