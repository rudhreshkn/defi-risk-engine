# DeFi Risk Engine

A real-time portfolio risk analysis tool for DeFi assets, built with **effectful programming** as the core architectural paradigm using [Effect](https://effect.website/) for TypeScript.

## How to Run

### Prerequisites

- Node.js v20+
- npm

### Setup

```bash
npm install
```

### Run demo (no network required — guaranteed output)

```bash
npm run demo
```

Uses deterministic test data to demonstrate the full pipeline. **Judges: start here.**

### Run analysis (single-shot, live data)

```bash
npm start
```

### Run monitoring mode (Stream-based, configurable interval)

```bash
npm run monitor
```

### Run tests (65 tests, zero network)

```bash
npm test
```

### Custom portfolio

Edit `portfolio.json`:

```json
{
  "name": "My Portfolio",
  "holdings": [
    { "symbol": "BTC",  "coinGeckoId": "bitcoin",  "amount": 0.5  },
    { "symbol": "ETH",  "coinGeckoId": "ethereum", "amount": 5.0  }
  ]
}
```

CoinGecko IDs: [coingecko.com](https://www.coingecko.com/)

### Environment variable configuration

All settings have sensible defaults. Override via environment variables:

| Variable | Default | Description |
|---|---|---|
| `PORTFOLIO_PATH` | `./portfolio.json` | Path to portfolio config |
| `HISTORY_PATH` | `./analysis-history.json` | Path to history file |
| `MONITOR_INTERVAL` | `60` | Seconds between monitoring cycles |
| `PRICE_FEED_CONCURRENCY` | `3` | Concurrent historical price fetches |
| `MAX_RETRIES` | `3` | Retry attempts on API failure |
| `THRESHOLD_VAR_WARNING` | `0.03` | VaR % warning threshold |
| `THRESHOLD_VAR_CRITICAL` | `0.05` | VaR % critical threshold |
| `THRESHOLD_VOL_WARNING` | `0.6` | Annualised volatility warning |
| `THRESHOLD_VOL_CRITICAL` | `0.8` | Annualised volatility critical |
| `THRESHOLD_HHI_WARNING` | `0.35` | Concentration HHI warning |
| `THRESHOLD_HHI_CRITICAL` | `0.5` | Concentration HHI critical |
| `THRESHOLD_DRAWDOWN_CRITICAL` | `0.15` | Max drawdown critical |

Example:

```bash
THRESHOLD_VAR_CRITICAL=0.08 MONITOR_INTERVAL=30 npm run monitor
```

## What It Does

1. **Loads** configuration from environment variables (thresholds, paths, concurrency)
2. **Validates** portfolio config with Effect Schema (rejects malformed input at I/O boundary)
3. **Rate-limits** API calls using a `Ref`-based token bucket (prevents 429 errors)
4. **Fetches** live prices from CoinGecko with automatic CoinCap failover (`Effect.orElse`)
5. **Validates** API responses with Effect Schema (no `as any` casts)
6. **Computes** risk metrics using pure, deterministic calculations:
   - **Value at Risk** (parametric, 95th and 99th percentile)
   - **Annualised volatility** from daily returns
   - **Sharpe ratio** (risk-adjusted return)
   - **Herfindahl-Hirschman Index** (portfolio concentration)
   - **Maximum drawdown** over 30-day window
7. **Generates** risk alerts when configurable thresholds are breached
8. **Compares** against previous analysis (shows coloured trend deltas)
9. **Persists** results to history (enables graceful degradation and comparison)
10. **Falls back** to cached data when all API sources fail

## Architecture

See [`EFFECTS.md`](EFFECTS.md) for the full effect model documentation.

### Key Principle

Every side effect is modelled as an explicit service. The pure domain has zero Effect dependencies.

### Project Structure

```
src/
├── index.ts              # Entry point — runtime, layers, Stream pipeline
├── domain/
│   ├── models.ts         # Pure types + branded primitives + Schema validation
│   └── risk.ts           # Pure risk calculations (no effects)
├── services/
│   ├── PriceFeed.ts      # Network I/O (CoinGecko → CoinCap failover, Schema validated)
│   ├── PortfolioStore.ts # File I/O (Schema validated)
│   ├── AppConfig.ts      # Configuration (env vars via Effect Config)
│   ├── Clock.ts          # Time observation (deterministic in tests)
│   ├── RateLimiter.ts    # Functional state (Ref-based token bucket)
│   ├── Logger.ts         # Logging
│   └── AlertNotifier.ts  # Alert notification
├── workflows/
│   └── analyse.ts        # Composed effectful analysis pipeline
├── display.ts            # Terminal output with trend deltas
├── demo.ts               # Demo mode (test layers, guaranteed output)
└── test.ts               # 65 tests across 8 categories
```

### Services (7 custom + Effect built-ins)

| Service | Effect | Key Pattern |
|---|---|---|
| `PriceFeed` | Network I/O | `Effect.orElse` failover, `Schema.decodeUnknown` |
| `PortfolioStore` | File I/O | `Schema.decodeUnknownSync` validation |
| `AppConfig` | Configuration | `Config.withDefault` from env vars |
| `Clock` | Time | Deterministic in tests |
| `RateLimiter` | Functional state | `Ref.make` + `Ref.modify` (token bucket) |
| `Logger` | Console I/O | Structured output |
| `AlertNotifier` | Console I/O | Coloured alerts |

Plus `Stream` (reactive pipeline), `Schedule` (time/retry), `Effect.all` (concurrency), `Schema` (validation).

### Test Coverage (65 tests)

| Category | Count | What it proves |
|---|---|---|
| Daily returns | 7 | Pure math correctness + edge cases |
| Portfolio valuation | 9 | Weights, missing prices, empty portfolio |
| Risk metrics | 11 | VaR, volatility, HHI, Sharpe, drawdown |
| Portfolio returns | 3 | Weighted returns, empty data |
| Alert generation | 9 | Threshold logic, multiple alerts, zero-value |
| Schema validation | 7 | Rejects bad input: missing fields, negative amounts, wrong types |
| Effectful workflow | 7 | Full pipeline with mock layers |
| Graceful degradation | 3 | API failure → cached fallback |
| Single-asset | 3 | Edge case: one holding |
| Large portfolio | 3 | 10 assets, weight correctness |
| PriceFeed failover | 3 | Primary fails → fallback used |

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Effect system:** [Effect](https://effect.website/) v3.x
- **Data sources:** [CoinGecko](https://www.coingecko.com/en/api) (primary) + [CoinCap](https://docs.coincap.io/) (fallback)
- **Zero external runtime dependencies** beyond `effect`
