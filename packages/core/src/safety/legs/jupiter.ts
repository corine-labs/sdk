/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import { VersionedTransaction } from "@solana/web3.js";
import type { ExecutorLeg, LegContext } from "../../interfaces/leg";
import type { FillResult } from "../../types";
import type { JupiterClient } from "../../adapters/data/jupiter";

/**
 * JupiterLeg — the default fill venue for graduated / DEX-routable tokens. It
 * runs ONLY inside `guardedExecute`, after every gate has passed. It quotes +
 * builds a Jupiter swap, signs with the context signer, broadcasts through the
 * context RPC, records the signature the instant it goes out (no-double-send),
 * then confirms.
 */
export class JupiterLeg implements ExecutorLeg {
  readonly name = "jupiter";
  constructor(private readonly client: JupiterClient, private readonly confirmTimeoutMs = 60_000) {}

  async fill(ctx: LegContext): Promise<FillResult> {
    try {
      const amount = ctx.inputAmountAtomic
        ? Number(ctx.inputAmountAtomic)
        : await this.client.atomicInputForUsd(ctx.inputMint, ctx.amountUsd);

      const quote = await this.client.getQuote({
        inputMint: ctx.inputMint,
        outputMint: ctx.outputMint,
        amount,
        slippageBps: ctx.slippageBps,
      });

      const userPublicKey = await ctx.signer.publicKey();
      const swapB64 = await this.client.buildSwapTransaction(quote, userPublicKey);
      const tx = VersionedTransaction.deserialize(Buffer.from(swapB64, "base64"));
      const signed = await ctx.signer.signTransaction(tx);

      const sig = await ctx.rpc.sendRawTransaction(signed.serialize());
      // Durable-sig hook FIRST — a crash after this reconciles the sig, never re-sends.
      await ctx.onBroadcast(sig);

      const confirmed = await ctx.rpc.confirmSignature(sig, this.confirmTimeoutMs);
      if (!confirmed) {
        return { success: false, txHash: sig, errorCode: "CONFIRMATION_UNKNOWN", error: "Broadcast but not confirmed in time." };
      }

      return {
        success: true,
        txHash: sig,
        inputAmount: Number(quote.inAmount),
        outputAmount: Number(quote.outAmount),
      };
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err), errorCode: "FILL_ERROR" };
    }
  }
}
