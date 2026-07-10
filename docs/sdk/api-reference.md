# API Reference

Every public export of `@h4rsharma/corine-core`, with accurate types. Import everything from the package root:

```ts
import { createCorine, LocalSigner /* … */ } from "@h4rsharma/corine-core";
```

- Node >= 18 · Apache-2.0
- Well-known mints exported for convenience: `SOL_MINT`, `USDC_MINT`.

---

## `createCorine` and `Corine`

### `createCorine(config: CorineConfig): Corine`

The one-call init. Resolves defaults (in-memory store, console notifier, Jupiter price/quote/leg, no-op rug checker, built-in agent handlers) and wires the guarded spine. No secret is embedded — you supply the RPC endpoint and signing key.

### `CorineConfig`

```ts
interface CorineConfig {
  rpc: RpcProvider | Web3RpcOptions;   // REQUIRED — your RPC (or a ready provider)
  signer?: Signer;                     // single custodial signer (wrapped as a SingleKeystore)
  keystore?: Keystore;                 // multi-wallet keystore (overrides `signer`)
  jupiter?: JupiterClientOptions;      // options for the default JupiterClient
  prices?: PriceSource;                // override price source (default: JupiterClient)
  quotes?: QuoteSource;                // override quote source (default: JupiterClient)
  rug?: RugChecker;                    // rug assessor (default: NoopRugChecker)
  store?: Store;                       // state store (default: InMemoryStore)
  notifier?: Notifier;                 // reporting (default: ConsoleNotifier)
  llm?: LLMProvider;                   // optional reasoning provider
  memory?: MemoryStore;                // optional agent memory
  legs?: ExecutorLeg[];                // extra fill venues (in addition to the jupiter leg)
  registry?: AgentTypeRegistry;        // override the agent-type registry
  safety?: Partial<SafetyConfig>;      // tune safety thresholds
}
```

### `Corine`

```ts
interface Corine {
  execute(input: ExecuteInput): Promise<GuardedResult>;
  quote(params: {
    inputMint: string;
    outputMint: string;
    amountUsd: number;
    slippageBps?: number;
  }): Promise<SwapQuote>;
  price(mint: string): Promise<number>;   // 0 when unavailable
  agents: AgentRuntime;
  killSwitch: {
    enable(reason?: string): Promise<void>;
    disable(): Promise<void>;
    status(): Promise<{ enabled: boolean; reason: string | null }>;
  };
  // Escape hatches
  store: Store;
  registry: AgentTypeRegistry;
  rpc: RpcProvider;
  cluster: RpcProvider["cluster"];
}
```

- `execute` — the ONLY way to trade. Resolves the signer (from `input.signer`, the config signer, or the keystore via `input.userId`) and auto-generates an idempotency key when omitted (a 30-second bucket over user/mints/amount/side).
- `quote` — read-only; no signing, no execution.
- `price` — live USD price via the configured `PriceSource`.

---

## `ExecuteInput`

The trade argument for `Corine.execute`. It is the `GuardedTrade` shape with `signer`, `idempotencyKey`, and `userId` made optional (the runtime fills them in).

```ts
interface ExecuteInput {
  outputMint: string;               // token to receive (on a buy)
  inputMint: string;                // token to spend — defaults to SOL if omitted*
  amountUsd: number;                // USD notional the caps are checked against
  side?: "buy" | "sell";
  maxPerTxUsd: number;              // REQUIRED — hard per-trade cap
  dailyCapUsd: number;              // REQUIRED — hard daily cap
  slippageBps?: number;             // clamped to the safety [floor, ceil] range
  rugGate?: boolean;                // opt in to the rug BLOCK (score is always recorded)
  allowRisky?: boolean;             // acknowledge a warn-band rug score; never bypasses a hard block
  repositionExistingFunds?: boolean;// moving owned funds: skips spend caps + daily record, all other gates apply
  evaluatedAtMs?: number;           // decision timestamp for the freshness gate
  leg?: string;                     // fill venue name (default: "jupiter")
  inputAmountAtomic?: string;       // exact atomic input for token-denominated trades
  userId?: string;                  // default "default"; also used to resolve a keystore signer
  signer?: Signer;                  // per-trade signer override
  idempotencyKey?: string;          // auto-generated (30s bucket) if omitted
  surface?: TradeSurface;           // informational origin tag
}
```

\* `inputMint` is required by the `GuardedTrade` type; in practice pass `SOL_MINT` to spend SOL. The mint-sanity gate rejects malformed or identical mints.

## `GuardedResult`

```ts
interface GuardedResult {
  status: ExecutionStatus;          // "executed" | "blocked" | "failed" | "noop"
  blockedBy?: BlockReason;          // set when a gate blocked (or on internal error)
  reason?: string;                  // human-readable explanation
  auditId?: string;                 // correlates to the Store audit row
  txHash?: string;
  fill?: FillResult;
  slippageBps?: number;             // the resolved (clamped) slippage
  rugScore?: number;                // 0–100, always recorded when a rug check ran
}
```

### `BlockReason`

```ts
type BlockReason =
  | "kill_switch"
  | "not_whitelisted"
  | "over_caps"
  | "over_daily_cap"
  | "below_min"
  | "insufficient_sol"
  | "stale_trigger"
  | "stale_price"
  | "rug"
  | "inflight"
  | "internal";
```

### Related domain types

```ts
type ExecutionStatus = "executed" | "blocked" | "failed" | "noop";
type TradeSurface = "cli" | "sdk" | "agent" | "web" | "telegram" | string;

interface FillResult {
  success: boolean;
  txHash?: string;
  inputAmount?: number;     // UI units, best-effort
  outputAmount?: number;    // UI units, best-effort
  inputAmountUsd?: number;
  outputAmountUsd?: number;
  errorCode?: string;
  error?: string;
}

interface RugAssessment {
  score: number;            // 0–100, higher is safer
  flags: string[];
}

const SOL_MINT  = "So11111111111111111111111111111111111111112";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
```

---

## The spine (types)

`GuardedExecutor` is the class that owns `guardedExecute`. You do not construct it directly — `createCorine` wires it — but its types are exported.

```ts
class GuardedExecutor {
  constructor(deps: SpineDeps);
  execute(trade: GuardedTrade): Promise<GuardedResult>;   // the ONE way to execute
}

interface SpineDeps {
  rpc: RpcProvider;
  store: Store;
  prices: PriceSource;
  quotes: QuoteSource;
  rug: RugChecker;
  notifier: Notifier;
  legs: Map<string, ExecutorLeg>;
  config: SafetyConfig;
}
```

`GuardedTrade` is `ExecuteInput` with `userId`, `idempotencyKey`, and `signer` required (see `ExecuteInput` above for field docs).

### `SafetyConfig` and `DEFAULT_SAFETY_CONFIG`

```ts
interface SafetyConfig {
  minSolForFeesLamports: number;   // min lamports for fees before any trade
  maxStalenessMs: number;          // a decision older than this is too stale
  slippageFloorBps: number;        // slippage clamp — floor
  slippageCeilBps: number;         // slippage clamp — ceil
  defaultSlippageBps: number;      // used when none supplied
  rugHardBlock: number;            // score below this hard-blocks (rug gate on)
  rugWarn: number;                 // score below this warns (blocks unless allowRisky)
  confirmTimeoutMs: number;        // signature poll timeout — never blind re-send
}

const DEFAULT_SAFETY_CONFIG: SafetyConfig = {
  minSolForFeesLamports: 10_000_000, // 0.01 SOL
  maxStalenessMs: 120_000,           // 2 min
  slippageFloorBps: 10,
  slippageCeilBps: 300,
  defaultSlippageBps: 50,
  rugHardBlock: 40,
  rugWarn: 70,
  confirmTimeoutMs: 60_000,
};
```

---

## The seven interface seams

Implement any of these and pass your implementation to `createCorine`. The SDK depends only on the interface — no endpoint or key is embedded.

### 1. `RpcProvider`

```ts
interface RpcProvider {
  getBalanceLamports(pubkey: string): Promise<number>;   // return 0 on read failure, never throw into a gate
  sendRawTransaction(raw: Uint8Array): Promise<string>;  // returns the signature the instant it broadcasts
  confirmSignature(signature: string, timeoutMs: number): Promise<boolean>;
  getLatestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  readonly cluster: "mainnet-beta" | "devnet" | "testnet" | string;
}
```

### 2. `Signer` (+ `Keystore`)

```ts
interface Signer {
  publicKey(): Promise<string>;
  signTransaction<T extends Transaction | VersionedTransaction>(tx: T): Promise<T>;
  keypair?(): Promise<Keypair>;   // optional — only custodial signers implement it
}

interface Keystore {
  getSigner(ref: string): Promise<Signer>;   // resolve a signer by stable ref (userId/agentId)
}
```

> A signer that hands the runtime a live `Keypair` is **custodial** — the process can sign on the user's behalf. A non-custodial integration implements `signTransaction` by prompting a wallet and leaves `keypair` undefined.

### 3. `PriceSource` + `QuoteSource` + `RugChecker`

```ts
interface PriceSource {
  getPriceUsd(mint: string): Promise<number>;   // return 0 when unavailable — the gate treats 0 as "refuse"
}

interface SwapQuote {
  inputMint: string;
  outputMint: string;
  inAmount: string;    // atomic input amount priced
  outAmount: string;   // atomic output amount expected
  raw: unknown;        // opaque venue payload the leg uses to build the swap tx
}

interface QuoteSource {
  atomicInputForUsd(inputMint: string, usdNotional: number): Promise<number>;
  getQuote(params: {
    inputMint: string;
    outputMint: string;
    amount: number;
    slippageBps: number;
  }): Promise<SwapQuote>;   // throws if no route exists
}

interface RugChecker {
  checkToken(mint: string, opts?: { liquidityUsdOverride?: number }): Promise<RugAssessment>;
}
```

### 4. `Store`

```ts
type GuardDecision = "proceed" | "confirm" | "done" | "failed";

interface GuardState {
  decision: GuardDecision;
  sentSig?: string;         // a signature broadcast under this key but not yet reconciled
  executionId?: string;
  errorMessage?: string;
}

interface DailySpendCheck {
  allowed: boolean;
  spent: number;
  remaining: number;
}

interface AuditRecord {
  userId: string;
  surface: string;
  inputMint: string;
  outputMint: string;
  amountUsd: number;
  slippageBps: number;
  status: "EXECUTED" | "BLOCKED" | "FAILED";
  blockedBy?: BlockReason;
  txHash?: string;
  rugScore?: number;
  errorMessage?: string;
}

interface Store {
  // Kill switch
  isKillSwitchEnabled(): Promise<boolean>;
  setKillSwitch(enabled: boolean, reason?: string): Promise<void>;
  getKillSwitchReason(): Promise<string | null>;
  // Idempotency guard (at-most-once)
  beginGuard(idempotencyKey: string): Promise<GuardState>;
  recordSentSig(idempotencyKey: string, sig: string): Promise<void>;   // persist BEFORE confirmation
  completeGuard(idempotencyKey: string, executionId?: string): Promise<void>;
  failGuard(idempotencyKey: string, message: string, executionId?: string): Promise<void>;
  // Daily spend ledger
  checkDailySpend(userId: string, amountUsd: number, dailyCapUsd: number): Promise<DailySpendCheck>;
  recordDailySpend(userId: string, amountUsd: number): Promise<void>;
  // Audit trail
  recordAudit(record: AuditRecord): Promise<string>;
}
```

> These are safety-critical ledgers, not caches. A correct implementation must be atomic and survive a restart.

### 5. `Notifier`

```ts
interface NotifyEvent {
  level: "info" | "success" | "warn" | "error";
  title: string;
  body?: string;
  txHash?: string;
  dedupeKey?: string;   // stable key to de-duplicate repeated deliveries
}

interface Notifier {
  send(event: NotifyEvent): Promise<void>;
}
```

### 6. `LLMProvider` (optional)

```ts
type ModelTier = "fast" | "deep" | "chat";

interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface LLMProvider {
  isConfigured(): boolean;
  complete(
    tier: ModelTier,
    messages: LLMMessage[],
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<string>;
}
```

> When no provider is configured, reasoning agents fall back to their deterministic path — they never fabricate a decision.

### 7. `MemoryStore` (optional)

```ts
interface MemoryItem {
  kind: "fact" | "preference" | "decision" | "note";
  content: string;
  importance?: number;
  createdAt?: number;
}

interface RecallResult {
  items: MemoryItem[];
  semanticAvailable: boolean;   // false when it degraded to keyword-only
}

interface MemoryStore {
  remember(scope: string, item: MemoryItem): Promise<void>;
  recall(scope: string, query: string, limit?: number): Promise<RecallResult>;
}
```

### The fill venue: `ExecutorLeg`

```ts
interface LegContext {
  inputMint: string;
  outputMint: string;
  side: "buy" | "sell";
  amountUsd: number;
  inputAmountAtomic?: string;
  slippageBps: number;
  signer: Signer;
  rpc: RpcProvider;
  quotes: QuoteSource;
  prices: PriceSource;
  onBroadcast: (signature: string) => Promise<void>;   // MUST call on the first signature
}

interface ExecutorLeg {
  readonly name: string;                       // routing name (matches ExecuteInput.leg)
  fill(ctx: LegContext): Promise<FillResult>;  // runs only after every gate passes
}
```

`JupiterLeg` is the exported default leg:

```ts
class JupiterLeg implements ExecutorLeg {
  constructor(jupiter: JupiterClient, confirmTimeoutMs?: number);
  readonly name: "jupiter";
}
```

---

## Default adapters

Each seam ships a default you can construct yourself or swap.

### `Web3RpcProvider`

```ts
interface Web3RpcOptions {
  endpoint: string;   // REQUIRED — your RPC URL (may carry a provider key)
  commitment?: "processed" | "confirmed" | "finalized";   // default "confirmed"
  cluster?: "mainnet-beta" | "devnet" | "testnet" | string;
}

class Web3RpcProvider implements RpcProvider {
  constructor(opts: Web3RpcOptions);
  get connection(): Connection;   // underlying @solana/web3.js Connection
}
```

### `JupiterClient` (price + quote + swap)

```ts
interface JupiterClientOptions {
  restBaseUrl?: string;   // default https://api.jup.ag
  swapBaseUrl?: string;   // default https://lite-api.jup.ag/swap/v1
  apiKey?: string;        // optional Jupiter portal key (x-api-key) — bring your own
  timeoutMs?: number;     // default 15_000
}

class JupiterClient implements PriceSource, QuoteSource {
  constructor(opts?: JupiterClientOptions);
}
```

### Signers and keystores

```ts
class LocalSigner implements Signer {
  static fromBase58(secretKeyBase58: string): LocalSigner;
  static fromSecretKey(secretKey: Uint8Array): LocalSigner;
  static fromJson(json: string): LocalSigner;   // accepts a base58 string or a JSON secret-key array
  constructor(kp: Keypair);
}

class SingleKeystore implements Keystore {
  constructor(signer: Signer);   // resolves the same signer for any ref
}

class AesKeystore implements Keystore {
  constructor(opts: {
    encryptionKeyHex: string;                    // 64-hex-char (32-byte) AES-256 key — from env, never hardcoded
    load: (ref: string) => Promise<string | null>;  // resolve the encrypted blob for a wallet ref
  });
  encrypt(secretKey: Uint8Array): string;        // → "iv:tag:ciphertext" blob you persist
  generate(): { publicKey: string; encrypted: string };
}
```

> `LocalSigner` and `AesKeystore` are custodial. See the [Safety Model](./safety-model.md).

### Stores

```ts
class InMemoryStore implements Store {}                 // dev default
class FileStore extends InMemoryStore {
  constructor(path: string);                            // zero-dependency durable store
}
```

### Notifiers

```ts
class ConsoleNotifier implements Notifier {
  constructor(enabled?: boolean);   // default true
}
class SilentNotifier implements Notifier {}
```

### Rug checker

```ts
class NoopRugChecker implements RugChecker {}   // returns a safe score; the gate only blocks when rugGate: true
```

### LLM

```ts
interface OpenRouterOptions {
  apiKey?: string;                            // your key — optional; absent ⇒ reasoning degrades to deterministic
  baseUrl?: string;                           // default https://openrouter.ai/api/v1
  models?: Partial<Record<ModelTier, string>>;
  timeoutMs?: number;                         // default 60_000
}

class OpenRouterLLM implements LLMProvider {
  constructor(opts?: OpenRouterOptions);
  isConfigured(): boolean;
}
```

### Memory

```ts
class InMemoryMemory implements MemoryStore {}   // keyword recall; semanticAvailable is false
```

---

## Schema: `Strategy` and `Caps`

Zod schemas — caps are **mandatory**.

```ts
const AGENT_TYPES = ["DCA", "DIP_BUYER", "LIMIT_ORDER", "LADDERED_EXIT", "WALLET_COPY", "CUSTOM"] as const;
type AgentType = (typeof AGENT_TYPES)[number];
```

### `capsSchema`

```ts
const capsSchema = z.object({
  maxPerTxUsd: z.number().positive(),                          // hard per-trade cap
  dailyCapUsd: z.number().positive(),                          // hard daily cap
  slippageBps: z.number().int().min(10).max(300).optional(),   // else the spine clamps a dynamic value
  rugGate: z.boolean().optional().default(false),              // OFF by default (score still recorded)
});
type Caps = z.input<typeof capsSchema>;
type ResolvedCaps = z.output<typeof capsSchema>;
```

### `exitConditionSchema`

```ts
const exitConditionSchema = z.object({
  type: z.enum(["time_elapsed", "pnl_loss_pct", "pnl_profit_pct", "price_threshold"]),
  threshold: z.number(),
  action: z.enum(["close", "pause"]).default("close"),
  direction: z.enum(["below", "above"]).optional(),
});
type ExitCondition = z.infer<typeof exitConditionSchema>;
```

### `strategySchema`

```ts
const strategySchema = z.object({
  name: z.string().min(1),
  agentType: z.enum(AGENT_TYPES),
  outputMint: z.string().min(32).max(44),
  inputMint: z.string().min(32).max(44).default(SOL_MINT),
  amountUsd: z.number().positive(),
  intervalSeconds: z.number().int().positive().optional(),   // DCA cadence
  cron: z.string().optional(),
  priceThresholdUsd: z.number().positive().optional(),       // DIP_BUYER / LIMIT_ORDER
  watchedWallet: z.string().optional(),                      // WALLET_COPY
  ladder: z.array(z.object({
    multiplier: z.number().positive(),
    sellPercent: z.number().min(0).max(100),
  })).optional(),                                            // LADDERED_EXIT
  exitConditions: z.array(exitConditionSchema).optional(),
  caps: capsSchema,                                          // MANDATORY
});
type Strategy = z.input<typeof strategySchema>;
type ResolvedStrategy = z.output<typeof strategySchema>;
```

---

## `AgentRuntime`, registry, and handlers

### `AgentRuntime`

```ts
type AgentStatus = "active" | "paused" | "stopped";

interface Agent {
  id: string;
  userId: string;
  walletRef: string;
  strategy: ResolvedStrategy;
  status: AgentStatus;
  state: AgentState;
  createdAt: number;
}

interface DeployParams {
  strategy: Strategy;
  userId: string;
  walletRef?: string;   // keystore ref → signer; defaults to userId
  state?: AgentState;   // optional seed state (e.g. entry price for LADDERED_EXIT)
}

interface AgentRuntimeDeps {
  guarded: GuardedExecutor;
  registry: AgentTypeRegistry;
  keystore: Keystore;
  prices: PriceSource;
}

class AgentRuntime {
  constructor(deps: AgentRuntimeDeps);
  deploy(params: DeployParams): Promise<Agent>;              // validates the strategy (throws zod on bad/missing caps)
  runOnce(agentId: string): Promise<GuardedResult | null>;  // one tick; null when inactive or nothing proposed
  get(agentId: string): Agent | undefined;
  list(): Agent[];
  pause(agentId: string): Agent;
  resume(agentId: string): Agent;
  kill(agentId: string): Agent;
}
```

Access it via `corine.agents`. A handler runs only through `runOnce`, which routes the proposal through the guarded spine — a handler can never trade directly.

### `AgentTypeRegistry` and handlers

```ts
type AgentState = Record<string, unknown>;

interface AgentContext {
  prices: PriceSource;
  now: number;
  state: AgentState;
}

interface TradeProposal {
  side: "buy" | "sell";
  inputMint: string;
  outputMint: string;
  amountUsd: number;
  inputAmountAtomic?: string;
  leg?: string;                       // fill venue (default "jupiter")
  repositionExistingFunds?: boolean;
  idempotencySuffix: string;          // deterministic dedup suffix the runtime appends
  reason: string;                     // surfaced in logs/audit
}

interface AgentTypeHandler {
  readonly type: AgentType;
  evaluate(strategy: ResolvedStrategy, ctx: AgentContext): Promise<TradeProposal | null>;
}

class AgentTypeRegistry {
  register(handler: AgentTypeHandler): this;
  get(type: string): AgentTypeHandler | undefined;
  has(type: string): boolean;
  types(): string[];
}
```

Built-in handlers (registered by default via `createCorine`):

```ts
const dcaHandler: AgentTypeHandler;           // type: "DCA"
const dipBuyerHandler: AgentTypeHandler;      // type: "DIP_BUYER"
const limitOrderHandler: AgentTypeHandler;    // type: "LIMIT_ORDER"
const ladderedExitHandler: AgentTypeHandler;  // type: "LADDERED_EXIT"

const BUILTIN_HANDLERS: AgentTypeHandler[];   // [dca, dipBuyer, limitOrder, ladderedExit]
```

`WALLET_COPY` and `CUSTOM` are valid `AgentType`s with no built-in handler — register your own before deploying an agent of that type.

---

## See also

- [Quickstart](./quickstart.md) — install to first guarded trade.
- [Core Concepts](./core-concepts.md) — the spine, the seams, and the Store as durable safety state.
- [Safety Model](./safety-model.md) — custody, mandatory caps, and honest limits.
