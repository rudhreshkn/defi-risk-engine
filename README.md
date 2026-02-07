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

### Run analysis (single-shot)

```bash
npm start
```

### Run monitoring mode (configurable interval)

```bash
npm run monitor
```

### Run tests

```bash
npm test
```

Tests run with mock layers — no network access, no filesystem writes, deterministic timestamps, fully reproducible.

### Custom portfolio

Edit `portfolio.json` to configure your holdings:

```json
{
  "name": "My Portfolio",
  "holdings": [
    { "symbol": "BTC",  "coinGeckoId": "bitcoin",  "amount": 0.5  },
    { "symbol": "ETH",  "coinGeckoId": "ethereum", "amount": 5.0  }
  ]
}
```

CoinGecko IDs can be found at [coingecko.com](https://www.coingecko.com/).

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
2. **Loads** your portfolio from a JSON config file
3. **Fetches** live prices and 30-day historical data from CoinGecko (concurrently, with exponential backoff retries)
4. **Computes** risk metrics using pure, deterministic calculations:
   - **Value at Risk** (parametric, 95th and 99th percentile)
   - **Annualised volatility** from daily returns
   - **Sharpe ratio** (risk-adjusted return)
   - **Herfindahl-Hirschman Index** (portfolio concentration)
   - **Maximum drawdown** over 30-day window
5. **Generates** risk alerts when configurable thresholds are breached
6. **Persists** results to a history file (enables graceful degradation)
7. **Displays** a formatted terminal dashboard with colour-coded metrics
8. **Falls back** to cached data when the API is unavailable (graceful degradation)

## Architecture

See [`EFFECTS.md`](EFFECTS.md) for a complete description of the effect model.

### Key Principle

Every side effect (network, file I/O, configuration, time, logging, alerts) is modelled as an explicit service using Effect's `Context.Tag` and `Layer` system. The pure domain logic in `src/domain/` has **zero** dependencies on any service — all risk calculations are deterministic functions.

### Project Structure

```
src/
├── index.ts              # Entry point — runtime & layer composition
├── domain/
│   ├── models.ts         # Pure domain types (no effects)
│   └── risk.ts           # Pure risk calculations (no effects)
├── services/
│   ├── PriceFeed.ts      # Network I/O service (+ test mock)
│   ├── PortfolioStore.ts # File I/O service (+ test mock)
│   ├── AppConfig.ts      # Configuration service (+ test mock)
│   ├── Clock.ts          # Time observation service (+ test mock)
│   ├── Logger.ts         # Logging service (+ silent mock)
│   └── AlertNotifier.ts  # Alert notification service (+ silent mock)
├── workflows/
│   └── analyse.ts        # Composed effectful analysis pipeline
├── display.ts            # Terminal output formatting
└── test.ts               # Test suite (pure + effectful + failure tests)
```

### Services (6 custom + 2 Effect built-in)

| Service | Effect | Live | Test |
|---|---|---|---|
| `PriceFeed` | Network I/O | CoinGecko API | Deterministic synthetic data |
| `PortfolioStore` | File I/O | Node.js `fs` | In-memory mock |
| `AppConfig` | Configuration | Environment variables | Hardcoded defaults |
| `Clock` | Time observation | System clock | Fixed date |
| `Logger` | Console I/O | Formatted stdout | Silent no-op |
| `AlertNotifier` | Console I/O | Coloured alerts | Silent no-op |

Plus `Schedule` (time/retry) and `Effect.all` (concurrency) from Effect's standard library.

## Tech Stack

- **Language:** TypeScript (strict mode)
- **Effect system:** [Effect](https://effect.website/) v3.x
- **Data source:** [CoinGecko API](https://www.coingecko.com/en/api) (free tier, no key required)
- **Zero external runtime dependencies** beyond `effect`
