# EFFECTS.md — DeFi Risk Engine

## I/O Boundary (Effect Inventory)

Every interaction this system has with the outside world is modelled as an explicit Effect service using `Context.Tag`. The system performs **no** side effects outside of these declared boundaries.

| Effect | Service | Source | What it does to / observes from the world |
|---|---|---|---|
| **Network I/O** | `PriceFeed` | [`src/services/PriceFeed.ts`](src/services/PriceFeed.ts) | HTTP GET to CoinGecko (primary) and CoinCap (fallback) APIs. Responses validated with Effect Schema. Automatic failover via `Effect.orElse`. |
| **File I/O** | `PortfolioStore` | [`src/services/PortfolioStore.ts`](src/services/PortfolioStore.ts) | Reads portfolio config (validated with Schema); reads/writes analysis history JSON |
| **Configuration** | `AppConfig` | [`src/services/AppConfig.ts`](src/services/AppConfig.ts) | Reads environment variables via Effect's `Config` module for thresholds, paths, concurrency, retry settings |
| **Time** | `Clock` | [`src/services/Clock.ts`](src/services/Clock.ts) | Observes system clock for timestamps (deterministic in tests via fixed date) |
| **Functional State** | `RateLimiter` | [`src/services/RateLimiter.ts`](src/services/RateLimiter.ts) | Token-bucket rate limiter using `Effect.Ref` for managed mutable state. Transparently delays API calls when budget is exhausted. |
| **Logging** | `Logger` | [`src/services/Logger.ts`](src/services/Logger.ts) | Structured, timestamped log output to stdout/stderr |
| **Notification** | `AlertNotifier` | [`src/services/AlertNotifier.ts`](src/services/AlertNotifier.ts) | Formatted risk alerts to stdout when thresholds are breached |
| **Scheduling** | `Schedule` (built-in) | [`src/index.ts`](src/index.ts), [`src/workflows/analyse.ts`](src/workflows/analyse.ts) | Configurable polling via `Effect.Stream` + `Schedule`; exponential backoff for retries |
| **Concurrency** | `Effect.all` | [`src/workflows/analyse.ts`](src/workflows/analyse.ts) | Parallel fetching of historical price series (configurable concurrency limit) |
| **Streaming** | `Effect.Stream` | [`src/index.ts`](src/index.ts) | Reactive monitoring pipeline: tick → analyse → filter failures → track previous → render with deltas |
| **Validation** | `Effect.Schema` | [`src/domain/models.ts`](src/domain/models.ts), [`src/services/PriceFeed.ts`](src/services/PriceFeed.ts) | Runtime validation of all external data (portfolio JSON, API responses) at I/O boundaries using branded types |

## Effect Definitions (Code References)

### Custom Services (7)

Each service is defined as a `Context.Tag` class with a live implementation and a test implementation:

| Service | Tag | Live layer | Test layer | Key Effect pattern |
|---|---|---|---|---|
| `PriceFeed` | `@app/PriceFeed` | CoinGecko + CoinCap HTTP | Deterministic synthetic data | `Effect.orElse` (failover) |
| `PortfolioStore` | `@app/PortfolioStore` | Node.js `fs` + Schema validation | In-memory mock | `Schema.decodeUnknownSync` |
| `AppConfig` | `@app/AppConfig` | `Config.*` from env vars | Hardcoded defaults | `Config.withDefault` |
| `Clock` | `@app/Clock` | `new Date()` | Fixed date (2026-01-15) | `Effect.sync` |
| `RateLimiter` | `@app/RateLimiter` | Token bucket via `Ref` | No-op (instant) | `Ref.make`, `Ref.modify` |
| `Logger` | `@app/Logger` | `console.*` | Silent no-op | `Effect.sync` |
| `AlertNotifier` | `@app/AlertNotifier` | Coloured console | Silent no-op | `Effect.sync` |

### Layer Composition

All layers are composed in [`src/index.ts`](src/index.ts):

```typescript
const AppLive = Layer.mergeAll(
  PriceFeedLive,
  PortfolioStoreLive,
  LoggerLive,
  AlertNotifierLive,
  AppConfigLive,
  ClockLive,
  RateLimiterLive
)
```

Swapping any `*Live` layer for its `*Test` counterpart changes the entire application's behaviour without modifying business logic. The test suite demonstrates this across 65 tests.

### Advanced Effect Patterns Used

| Pattern | Where | What it demonstrates |
|---|---|---|
| **`Ref` (functional mutable state)** | `RateLimiter` | Token count managed atomically via `Ref.modify` — no mutable variables |
| **`Effect.orElse` (failover composition)** | `PriceFeed` | CoinGecko failure transparently falls back to CoinCap |
| **`Schema.brand` (branded types)** | `models.ts` | `USD`, `Percentage`, `Weight`, `CoinGeckoId` prevent type confusion at compile time |
| **`Schema.decodeUnknown` (runtime validation)** | `PriceFeed`, `PortfolioStore` | External data validated at I/O boundary before entering pure core |
| **`Stream` (reactive pipeline)** | `index.ts` | Monitor mode as `Stream.fromSchedule → mapEffect → filter → zipWithPrevious → tap` |
| **`Schedule.exponential` (retry policy)** | `analyse.ts` | Configurable exponential backoff on API failures |
| **`Effect.all` (structured concurrency)** | `analyse.ts` | Parallel historical price fetches with configurable concurrency limit |
| **`Config` (typed configuration)** | `AppConfig` | All settings loaded from env vars with typed defaults |

## Pure Core (Business Logic)

The deterministic core lives in `src/domain/` and has **zero** dependencies on any Effect service — all risk calculations are pure functions.

### `src/domain/models.ts` — Domain types + branded primitives

Branded types: `CoinGeckoId`, `TokenSymbol`, `USD`, `Percentage`, `Weight`, `ISOTimestamp`

Schema-validated structures: `TokenHoldingSchema`, `PortfolioSchema` with constraints (e.g. amount must be positive)

Runtime interfaces: `Portfolio`, `TokenPrice`, `HistoricalPrices`, `PortfolioValuation`, `RiskMetrics`, `RiskAlert`, `AnalysisResult`

### `src/domain/risk.ts` — Risk calculations

All functions are **pure**: given the same inputs, they always produce the same outputs.

| Function | What it computes |
|---|---|
| `valuatePortfolio()` | Market value and weight of each holding |
| `calculateDailyReturns()` | Simple returns from a price series |
| `calculatePortfolioReturns()` | Weighted portfolio returns from per-token returns |
| `calculateRiskMetrics()` | VaR (parametric, 95%/99%), annualised volatility, Sharpe ratio, HHI concentration, max drawdown |
| `generateAlerts()` | Threshold-based risk alerts from metrics (configurable thresholds) |

### Data flow

```
  Environment variables
          │
          ▼
    AppConfig (env)───────────────────────────┐
          │                                    │
  Portfolio config (file)                      │
     [Schema validated]                        │
          │                                    │
          ▼                                    │
    Current prices  ←── PriceFeed              │
     [rate limited]     [CoinGecko → CoinCap]  │
     [Schema validated]                        │
          │                                    │
          ▼                                    │
    Valuation (pure)                           │
          │                                    │
          ├── Historical prices  ←── PriceFeed │
          │    [rate limited, concurrent ×N]    │
          │    [Schema validated]               │
          │          │                         │
          │    [on failure]                     │
          │          ▼                         │
          │    Cached history (file)            │
          │          │                         │
          │          ▼                         │
          │   Daily returns (pure)             │
          │          │                         │
          │          ▼                         │
          └── Risk metrics (pure)              │
                     │                         │
                     ▼                         │
              Alerts (pure) ◄──── thresholds ──┘
                     │
             ┌───────┼───────┐
             ▼       ▼       ▼
     Persist   Notify   Timestamp
     (file)  (console)  (clock)
```

## Runtime

- **Language:** TypeScript (strict mode)
- **Effect library:** [Effect](https://effect.website/) v3.x (`effect` npm package)
- **Runtime style:** A single call to `Effect.runPromise` at the entry point. Everything above that call is a *description* of what to do, not the doing of it.
- **Execution modes:**
  - **Single-shot:** Runs the pipeline once. Shows comparison deltas against last saved result.
  - **Monitoring:** `Effect.Stream` pipeline with configurable interval. Tracks previous results via `Stream.zipWithPrevious` for live deltas.
  - **Demo:** Test layers with live display — guaranteed output, zero network.
- **Testability:** 65 tests across 8 categories. Pure domain tests need zero infrastructure. Effectful tests swap layers. Failure tests prove graceful degradation. Schema tests prove validation catches malformed input. Failover tests prove `Effect.orElse` composition.

## Why This Qualifies

1. **Effects are modelled explicitly:** 7 custom services + 4 Effect built-in patterns. No hidden `fetch()`, `fs.*`, `console.*`, `Date.now()`, or mutable state outside declared service boundaries.
2. **Effectful workflows are composed into pipelines:** The analysis pipeline chains rate limiting → network I/O with failover → schema validation → pure computation → persistence → notification. Monitor mode is a reactive Stream pipeline.
3. **Execution happens at the edge:** `Effect.runPromise` in `src/index.ts` is the single runtime boundary.
4. **The design makes reasoning, testing, and failure handling better:**
   - `Ref`-based rate limiter prevents API abuse without global mutable state.
   - `Effect.orElse` failover makes the system resilient to individual API outages.
   - `Schema.brand` prevents type confusion at compile time; `Schema.decode` catches malformed data at runtime.
   - Graceful degradation falls back to cached results when all sources fail.
   - 65 tests prove every layer works in isolation and in composition.
