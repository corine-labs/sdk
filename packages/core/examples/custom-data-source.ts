/*
 * Plug in your own data source. The runtime depends on the `PriceSource`
 * interface, not on any provider — swap Jupiter for Birdeye, Pyth, your own
 * cache, anything. The freshness gate REFUSES to trade when you return 0, so a
 * correct source returns 0 (not a stale value) when it genuinely can't price.
 *
 * In your project:  import { createCorine, type PriceSource } from "@h4rsharma/corine-core";
 */
import { createCorine, LocalSigner, type PriceSource } from "../src/index";

class BirdeyePriceSource implements PriceSource {
  constructor(private readonly apiKey: string) {}
  async getPriceUsd(mint: string): Promise<number> {
    try {
      const res = await fetch(`https://public-api.birdeye.so/defi/price?address=${mint}`, {
        headers: { "X-API-KEY": this.apiKey, "x-chain": "solana" },
      });
      if (!res.ok) return 0;
      const body: any = await res.json();
      const p = Number(body?.data?.value);
      return Number.isFinite(p) && p > 0 ? p : 0; // 0 ⇒ "refuse to trade blind"
    } catch {
      return 0;
    }
  }
}

const corine = createCorine({
  rpc: { endpoint: process.env.RPC_URL! },
  signer: LocalSigner.fromBase58(process.env.SECRET_KEY!),
  prices: new BirdeyePriceSource(process.env.BIRDEYE_API_KEY!), // your key, your source
});

console.log("SOL price via Birdeye:", await corine.price("So11111111111111111111111111111111111111112"));
