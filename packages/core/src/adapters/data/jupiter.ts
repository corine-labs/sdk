/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { PriceSource, QuoteSource, SwapQuote } from "../../interfaces/data";

export interface JupiterClientOptions {
  /** REST hub for price v3 + token metadata. Public default; override for a paid plan. */
  restBaseUrl?: string;
  /** Swap quote/build base. Public default. */
  swapBaseUrl?: string;
  /** Optional Jupiter portal key (x-api-key). Bring YOUR OWN — never embedded. */
  apiKey?: string;
  /** Abort a hung HTTP call. */
  timeoutMs?: number;
}

/**
 * JupiterClient — the default `PriceSource` + `QuoteSource`, plus the swap-tx
 * builder the jupiter leg fills against. Talks to PUBLIC Jupiter endpoints; a
 * portal key is optional and, if used, comes from YOUR config. Returns 0 from
 * `getPriceUsd` when a token can't be priced so the freshness gate refuses to
 * trade blind rather than trade on a stale value.
 */
export class JupiterClient implements PriceSource, QuoteSource {
  private readonly restBase: string;
  private readonly swapBase: string;
  private readonly apiKey?: string;
  private readonly timeoutMs: number;
  private readonly decimalsCache = new Map<string, number>();

  constructor(opts: JupiterClientOptions = {}) {
    this.restBase = (opts.restBaseUrl ?? "https://api.jup.ag").replace(/\/$/, "");
    this.swapBase = (opts.swapBaseUrl ?? "https://lite-api.jup.ag/swap/v1").replace(/\/$/, "");
    this.apiKey = opts.apiKey;
    this.timeoutMs = opts.timeoutMs ?? 15_000;
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { accept: "application/json" };
    if (this.apiKey) h["x-api-key"] = this.apiKey;
    return h;
  }

  private async fetchJson(url: string, init?: RequestInit): Promise<any> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(url, { ...init, headers: { ...this.headers(), ...(init?.headers as object) }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`Jupiter ${res.status} ${res.statusText} for ${url}`);
      return await res.json();
    } finally {
      clearTimeout(t);
    }
  }

  async getPriceUsd(mint: string): Promise<number> {
    try {
      const body = await this.fetchJson(`${this.restBase}/price/v3?ids=${mint}`);
      const row = body?.data?.[mint] ?? body?.[mint];
      const raw = row?.usdPrice ?? row?.price;
      const n = typeof raw === "string" ? Number(raw) : raw;
      return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : 0;
    } catch {
      return 0;
    }
  }

  async getDecimals(mint: string): Promise<number> {
    const cached = this.decimalsCache.get(mint);
    if (cached != null) return cached;
    try {
      const rows = await this.fetchJson(`${this.restBase}/tokens/v2/search?query=${mint}`);
      const match = Array.isArray(rows) ? rows.find((r: any) => r?.id === mint || r?.address === mint) : null;
      const dec = Number(match?.decimals);
      const value = Number.isInteger(dec) ? dec : 9;
      this.decimalsCache.set(mint, value);
      return value;
    } catch {
      return 9;
    }
  }

  async atomicInputForUsd(inputMint: string, usdNotional: number): Promise<number> {
    const [decimals, price] = await Promise.all([this.getDecimals(inputMint), this.getPriceUsd(inputMint)]);
    if (!(price > 0)) throw new Error(`Cannot price ${inputMint} to size a $${usdNotional} trade.`);
    return Math.floor((usdNotional / price) * 10 ** decimals);
  }

  async getQuote(params: { inputMint: string; outputMint: string; amount: number; slippageBps: number }): Promise<SwapQuote> {
    const qs = new URLSearchParams({
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      amount: String(Math.floor(params.amount)),
      slippageBps: String(params.slippageBps),
    });
    const quote = await this.fetchJson(`${this.swapBase}/quote?${qs.toString()}`);
    if (!quote || quote.error) throw new Error(`No route: ${quote?.error ?? "unknown"}`);
    return {
      inputMint: params.inputMint,
      outputMint: params.outputMint,
      inAmount: String(quote.inAmount ?? params.amount),
      outAmount: String(quote.outAmount ?? "0"),
      raw: quote,
    };
  }

  /** Build the base64 swap transaction Jupiter signs+broadcasts. Used by the jupiter leg only. */
  async buildSwapTransaction(quote: SwapQuote, userPublicKey: string): Promise<string> {
    const body = await this.fetchJson(`${this.swapBase}/swap`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        quoteResponse: quote.raw,
        userPublicKey,
        wrapAndUnwrapSol: true,
        dynamicComputeUnitLimit: true,
      }),
    });
    if (!body?.swapTransaction) throw new Error("Jupiter did not return a swap transaction.");
    return body.swapTransaction as string;
  }
}
