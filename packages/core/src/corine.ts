/*
 * Copyright 2026 Corine.
 * SPDX-License-Identifier: Apache-2.0
 */

import type { RpcProvider } from "./interfaces/rpc";
import type { Signer, Keystore } from "./interfaces/signer";
import type { PriceSource, QuoteSource, RugChecker } from "./interfaces/data";
import type { Store } from "./interfaces/store";
import type { Notifier } from "./interfaces/notifier";
import type { LLMProvider } from "./interfaces/llm";
import type { MemoryStore } from "./interfaces/memory";
import type { ExecutorLeg } from "./interfaces/leg";

import { Web3RpcProvider, type Web3RpcOptions } from "./adapters/rpc/web3";
import { JupiterClient, type JupiterClientOptions } from "./adapters/data/jupiter";
import { NoopRugChecker } from "./adapters/rug/noop";
import { InMemoryStore } from "./adapters/store/memory";
import { ConsoleNotifier } from "./adapters/notifier/console";
import { SingleKeystore } from "./adapters/signer/local";
import { JupiterLeg } from "./safety/legs/jupiter";
import { GuardedExecutor, type GuardedTrade, type GuardedResult } from "./safety/guarded-execute";
import { DEFAULT_SAFETY_CONFIG, type SafetyConfig } from "./safety/config";
import { AgentTypeRegistry } from "./runtime/registry";
import { BUILTIN_HANDLERS } from "./runtime/handlers";
import { AgentRuntime } from "./runtime/agent-runtime";
import type { SwapQuote } from "./interfaces/data";

export interface CorineConfig {
  /** YOUR RPC — a ready RpcProvider or web3 options ({ endpoint }). Required. */
  rpc: RpcProvider | Web3RpcOptions;
  /** A single custodial signer (convenience). Wraps to a SingleKeystore. */
  signer?: Signer;
  /** A multi-wallet keystore (overrides `signer`). */
  keystore?: Keystore;
  /** Options for the default JupiterClient (price + quote source). Bring your own optional key. */
  jupiter?: JupiterClientOptions;
  /** Override the price source (defaults to JupiterClient). */
  prices?: PriceSource;
  /** Override the quote source (defaults to JupiterClient). */
  quotes?: QuoteSource;
  /** Rug assessor for the optional rug gate (defaults to NoopRugChecker). */
  rug?: RugChecker;
  /** State store (defaults to in-memory; use FileStore or your own for durability). */
  store?: Store;
  /** Where the runtime reports (defaults to console). */
  notifier?: Notifier;
  /** Optional reasoning provider. */
  llm?: LLMProvider;
  /** Optional agent memory. */
  memory?: MemoryStore;
  /** Extra fill venues, in addition to the default jupiter leg. */
  legs?: ExecutorLeg[];
  /** Override the agent-type registry (defaults to the built-in handlers). */
  registry?: AgentTypeRegistry;
  /** Tune safety thresholds (all have safe defaults). */
  safety?: Partial<SafetyConfig>;
}

/** A trade for the public `execute`. Signer + idempotency key are optional (defaulted). */
export type ExecuteInput = Omit<GuardedTrade, "signer" | "idempotencyKey" | "userId"> & {
  userId?: string;
  signer?: Signer;
  idempotencyKey?: string;
};

export interface Corine {
  /** The ONLY way to execute a trade — always through the guarded spine. */
  execute(input: ExecuteInput): Promise<GuardedResult>;
  /** Read-only quote preview (no signing, no execution). For `--quote-only`. */
  quote(params: { inputMint: string; outputMint: string; amountUsd: number; slippageBps?: number }): Promise<SwapQuote>;
  /** Live USD price of a mint (0 when unavailable). */
  price(mint: string): Promise<number>;
  /** Agent lifecycle (present when a signer/keystore is configured). */
  agents: AgentRuntime;
  /** Global kill switch. */
  killSwitch: {
    enable(reason?: string): Promise<void>;
    disable(): Promise<void>;
    status(): Promise<{ enabled: boolean; reason: string | null }>;
  };
  /** Escape hatches for advanced use. */
  store: Store;
  registry: AgentTypeRegistry;
  rpc: RpcProvider;
  cluster: RpcProvider["cluster"];
}

function isRpcProvider(x: RpcProvider | Web3RpcOptions): x is RpcProvider {
  return typeof (x as RpcProvider).getBalanceLamports === "function";
}

/**
 * createCorine — the one-call init. Provide YOUR rpc, YOUR signer, and (optionally)
 * YOUR data/LLM keys. No Corine secret is embedded. Everything else has a safe
 * default: in-memory store, console notifier, jupiter price/quote/leg, rug gate
 * off. Deploying an agent and executing a trade both go through `guardedExecute`
 * with mandatory caps.
 */
export function createCorine(config: CorineConfig): Corine {
  const rpc: RpcProvider = isRpcProvider(config.rpc) ? config.rpc : new Web3RpcProvider(config.rpc);
  const safety: SafetyConfig = { ...DEFAULT_SAFETY_CONFIG, ...(config.safety ?? {}) };

  const jupiter = new JupiterClient(config.jupiter ?? {});
  const prices: PriceSource = config.prices ?? jupiter;
  const quotes: QuoteSource = config.quotes ?? jupiter;
  const rug: RugChecker = config.rug ?? new NoopRugChecker();
  const store: Store = config.store ?? new InMemoryStore();
  const notifier: Notifier = config.notifier ?? new ConsoleNotifier();

  const legs = new Map<string, ExecutorLeg>();
  legs.set("jupiter", new JupiterLeg(jupiter, safety.confirmTimeoutMs));
  for (const leg of config.legs ?? []) legs.set(leg.name, leg);

  const registry = config.registry ?? new AgentTypeRegistry();
  if (!config.registry) for (const h of BUILTIN_HANDLERS) registry.register(h);

  const keystore: Keystore | undefined =
    config.keystore ?? (config.signer ? new SingleKeystore(config.signer) : undefined);

  const guarded = new GuardedExecutor({ rpc, store, prices, quotes, rug, notifier, legs, config: safety });

  const agents = keystore
    ? new AgentRuntime({ guarded, registry, keystore, prices })
    : new AgentRuntime({
        guarded,
        registry,
        prices,
        keystore: {
          async getSigner(): Promise<Signer> {
            throw new Error("No signer/keystore configured — pass `signer` or `keystore` to createCorine to run agents or execute trades.");
          },
        },
      });

  async function resolveSigner(input: ExecuteInput): Promise<Signer> {
    if (input.signer) return input.signer;
    if (config.signer) return config.signer;
    if (keystore && input.userId) return keystore.getSigner(input.userId);
    throw new Error("No signer available — pass `signer` on the trade or configure one on createCorine.");
  }

  return {
    async execute(input: ExecuteInput): Promise<GuardedResult> {
      const signer = await resolveSigner(input);
      const userId = input.userId ?? "default";
      const idempotencyKey =
        input.idempotencyKey ??
        `oneshot:${userId}:${input.inputMint}:${input.outputMint}:${input.amountUsd}:${input.side ?? "buy"}:${Math.floor(Date.now() / 30_000)}`;
      return guarded.execute({ ...input, userId, signer, idempotencyKey });
    },
    async quote(params) {
      const amount = await jupiter.atomicInputForUsd(params.inputMint, params.amountUsd);
      return quotes.getQuote({ inputMint: params.inputMint, outputMint: params.outputMint, amount, slippageBps: params.slippageBps ?? safety.defaultSlippageBps });
    },
    async price(mint) {
      return prices.getPriceUsd(mint);
    },
    agents,
    killSwitch: {
      enable: (reason?: string) => store.setKillSwitch(true, reason),
      disable: () => store.setKillSwitch(false),
      async status() {
        return { enabled: await store.isKillSwitchEnabled(), reason: await store.getKillSwitchReason() };
      },
    },
    store,
    registry,
    rpc,
    cluster: rpc.cluster,
  };
}
