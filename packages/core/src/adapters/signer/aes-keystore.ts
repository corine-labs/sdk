/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Keypair } from "@solana/web3.js";
import type { Keystore, Signer } from "../../interfaces/signer";
import { LocalSigner } from "./local";

/**
 * AesKeystore — AES-256-GCM custody, the same scheme Corine's hosted product
 * uses. It encrypts/decrypts Solana secret keys with a 32-byte key that YOU
 * supply (64 hex chars). The encryption key is NEVER embedded in the SDK — a
 * leaked custody key in a public repo would compromise every wallet, so it is
 * only ever read from YOUR config/env.
 *
 * You provide a `load(ref)` that returns the encrypted blob for a wallet (from
 * your DB); this class turns it into a live `Signer`. Provisioning is honest and
 * custodial: whoever holds `encryptionKeyHex` can sign for these wallets.
 */
export class AesKeystore implements Keystore {
  private readonly key: Buffer;

  constructor(
    private readonly opts: {
      /** 64-hex-char (32-byte) AES-256 key. Supply from env — never hardcode. */
      encryptionKeyHex: string;
      /** Resolve the encrypted blob for a wallet ref (e.g. from your database). */
      load: (ref: string) => Promise<string | null>;
    },
  ) {
    if (!/^[0-9a-fA-F]{64}$/.test(opts.encryptionKeyHex)) {
      throw new Error("AesKeystore requires a 64-hex-char (32-byte) encryption key.");
    }
    this.key = Buffer.from(opts.encryptionKeyHex, "hex");
  }

  /** Encrypt a Solana secret key → the `iv:tag:ciphertext` blob you persist. */
  encrypt(secretKey: Uint8Array): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(secretKey)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
  }

  /** Generate a fresh custodial wallet; returns its pubkey + the blob to store. */
  generate(): { publicKey: string; encrypted: string } {
    const kp = Keypair.generate();
    return { publicKey: kp.publicKey.toBase58(), encrypted: this.encrypt(kp.secretKey) };
  }

  private decrypt(blob: string): Keypair {
    const [ivB64, tagB64, dataB64] = blob.split(":");
    if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed encrypted key blob.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const dec = Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]);
    return Keypair.fromSecretKey(Uint8Array.from(dec));
  }

  async getSigner(ref: string): Promise<Signer> {
    const blob = await this.opts.load(ref);
    if (!blob) throw new Error(`No wallet provisioned for "${ref}".`);
    return new LocalSigner(this.decrypt(blob));
  }
}
