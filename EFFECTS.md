# EFFECTS.md — DeFi Risk Engine

## I/O Boundary (Effect Inventory)

Every interaction this system has with the outside world is modelled as an explicit Effect service using `Context.Tag`. The system performs **no** side effects outside of these declared boundaries.

| Effect | Service | Source | What it does to / observes from the world |
|---|---|---|---|
| **Network I/O** | `PriceFeed` | [`src/services/PriceFeed.ts`](src/services/PriceFeed.ts) | HTTP GET to CoinGecko API for live prices and 30-day historical price series |
| **File I/O** | `PortfolioStore` | [`src/services/PortfolioStore.ts`](src/services/PortfolioStore.ts) | Reads portfolio config JSON; reads/writes analysis history JSON |
| **Configuration** | `AppConfig` | [`src/services/AppConfig.ts`](src/services/AppConfig.ts) | Reads environment variables for risk thresholds, paths, concurrency, and retry settings via Effect's `Config` module |
| **Time** | `Clock` | [`src/services/Clock.ts`](src/services/Clock.ts) | Observes the system clock for timestamps (deterministic in tests) |
| **Logging** | `Logger` | [`src/services/Logger.ts`](src/services/Logger.ts) | Structured, timestamped log output to stdout/stderr |
| **Notification** | `AlertNotifier` | [`src/services/AlertNotifier.ts`](src/services/AlertNotifier.ts) | Formatted risk alerts to stdout when thresholds are breached |
| **Scheduling** | `Schedule` (Effect built-in) | [`src/index.ts`](src/index.ts), [`src/workflows/analyse.ts`](src/workflows/analyse.ts) | Configurable polling interval for monitoring mode; exponential backoff for retries |
| **Concurrency** | `Effect.all` | [`src/workflows/analyse.ts`](src/workflows/analyse.ts) | Parallel fetching of historical price series (configurable concurrency limit) |
| **Error / Retry** | `Effect.retry` + `Schedule.exponential` | [`src/workflows/analyse.ts`](src/workflows/analyse.ts) | Configurable exponential backoff on API failures with graceful degradation to cached data |

## Effect Definitions (Code References)

Services are defined as `Context.Tag` classes. Each has a live implementation (`*Live` layer) and a test implementation (`*Test` / `*Silent` layer):

| Service | Tag definition | Live layer | Test layer |
|---|---|---|---|
| `PriceFeed` | `Context.Tag("@app/PriceFeed")` | `PriceFeedLive` — CoinGecko HTTP | `PriceFeedTest` — deterministic synthetic prices |
| `PortfolioStore` | `Context.Tag("@app/PortfolioStore")` | `PortfolioStoreLive` — Node.js `fs` | `PortfolioStoreTest` — in-memory mock |
| `AppConfig` | `Context.Tag("@app/AppConfig")` | `AppConfigLive` — `Config.*` from env vars | `AppConfigTest` — hardcoded defaults |
| `Clock` | `Context.Tag("@app/Clock")` | `ClockLive` — `new Date()` | `ClockTest` — fixed date (`2026-01-15T12:00:00Z`) |
| `Logger` | `Context.Tag("@app/Logger")` | `LoggerLive` — `console.*` | `LoggerSilent` — no-op |
| `AlertNotifier` | `Context.Tag("@app/AlertNotifier")` | `AlertNotifierLive` — coloured console | `AlertNotifierSilent` — no-op |

**Layer composition** happens in [`src/index.ts`](src/index.ts):

```typescript
const AppLive = Layer.mergeAll(
  PriceFeedLive,
  PortfolioStoreLive,
  LoggerLive,
  AlertNotifierLive,
  AppConfigLive,
  ClockLive
)
```

Swapping any `*Live` layer for its `*Test` counterpart changes the entire application's behaviour without modifying a single line of business logic. The test suite demonstrates this: it runs the full analysis pipeline with `PriceFeedTest`, `ClockTest`, etc., producing deterministic results with zero I/O.

## Pure Core (Business Logic)

The deterministic core lives in `src/domain/` and has **zero** Effect dependencies — it imports nothing from `effect`, contains no services, and performs no I/O.

### `src/domain/models.ts` — Domain types

Pure data structures: `Portfolio`, `TokenHolding`, `TokenPrice`, `HistoricalPrices`, `PortfolioValuation`, `RiskMetrics`, `RiskAlert`, `AnalysisResult`.

### `src/domain/risk.ts` — Risk calculations

All functions are **pure**: given the same inputs, they always produce the same outputs.

| Function | What it computes |
|---|---|
| `valuatePortfolio()` | Market value and weight of each holding |
| `calculateDailyReturns()` | Simple returns from a price series |
| `calculatePortfolioReturns()` | Weighted portfolio returns from per-token returns |
| `calculateRiskMetrics()` | VaR (parametric, 95%/99%), annualised volatility, Sharpe ratio, HHI concentration index, maximum drawdown |
| `generateAlerts()` | Threshold-based risk alerts from metrics |

### Data flow

```
  Environment variables
          │
          ▼
    AppConfig (env)
          │
  Portfolio config (file)
          │
          ▼
    Current prices  ←── PriceFeed (network, retries)
          │
          ▼
    Valuation (pure)
          │
          ├── Historical prices  ←── PriceFeed (network, concurrent ×N)
          │          │                    │
          │          │              [on failure]
          │          │                    ▼
          │          │            Cached history (file)
          │          ▼
          │   Daily returns (pure)
          │          │
          │          ▼
          └── Risk metrics (pure)
                     │
                     ▼
              Alerts (pure, configurable thresholds)
                     │
             ┌───────┼───────┐
             ▼       ▼       ▼
     Persist   Notify   Timestamp
     (file)  (console)  (clock)
```

Arrows marked **(pure)** involve no services — they are deterministic transformations. Arrows marked with a service name are effectful boundaries.

**Graceful degradation:** If historical price fetching fails (e.g. rate limiting), the pipeline falls back to the last cached analysis result rather than aborting. If no cache exists, it computes concentration (which needs only current weights, not history) and reports other metrics as unavailable.

## Runtime

- **Language:** TypeScript (strict mode)
- **Effect library:** [Effect](https://effect.website/) v3.x (`effect` npm package)
- **Runtime style:** A single call to `Effect.runPromise` at the entry point (`src/index.ts`). This is the only place in the codebase where effects are actually executed. Everything above that call is a *description* of what to do, not the doing of it.
- **Execution modes:**
  - **Single-shot:** Runs the analysis pipeline once and exits.
  - **Monitoring:** Uses `Effect.repeat(Schedule.spaced(...))` with a configurable interval for continuous polling.
- **Configuration:** All operational parameters (thresholds, paths, concurrency, retries) are loaded via Effect's `Config` module from environment variables with sensible defaults.
- **Testability:** The test suite (`src/test.ts`) runs the full workflow with `TestLayer` — zero network calls, zero filesystem access, deterministic timestamps, fully reproducible.

## Why This Qualifies

1. **Effects are modelled explicitly:** Every side effect is a method on a `Context.Tag` service — 6 custom services plus Effect's built-in `Schedule` and `Config`. There are no hidden `fetch()` calls, no `fs.readFileSync()` in business logic, no stray `console.log()` in pure code, no `new Date()` outside the Clock service.
2. **Effectful workflows are composed into pipelines:** The analysis pipeline in `src/workflows/analyse.ts` chains 6 services with pure transformations using `Effect.gen`, with retry policies, concurrency control, and graceful degradation.
3. **Execution happens at the edge:** `Effect.runPromise` in `src/index.ts` is the single runtime boundary. Swap the layer, swap the world.
4. **The design makes reasoning and testing better:**
   - Pure domain logic is tested with zero infrastructure (19 pure tests).
   - Effectful workflows are tested by providing mock layers (4 integration tests including failure scenarios).
   - Error handling is typed and explicit: `PriceFeedError` and `StoreError` propagate through the Effect type system.
   - Time is deterministic in tests via `ClockTest`.
   - Configuration is testable via `AppConfigTest`.
