// ─── Demo Mode ─────────────────────────────────────────────────
// Runs the full analysis pipeline with test layers — no network,
// no filesystem, deterministic results. Guaranteed to work on
// any machine with Node.js installed.
//
// This demonstrates the complete data flow:
//   Config → Portfolio → Prices → Valuation → Risk → Alerts → Display
//
// Usage: npm run demo

import { Effect, Layer } from "effect"
import { PriceFeedTest } from "./services/PriceFeed.js"
import { PortfolioStoreTest } from "./services/PortfolioStore.js"
import { LoggerLive } from "./services/Logger.js"
import { AlertNotifierLive } from "./services/AlertNotifier.js"
import { AppConfigTest } from "./services/AppConfig.js"
import { ClockLive } from "./services/Clock.js"
import { RateLimiterTest } from "./services/RateLimiter.js"
import { runAnalysis } from "./workflows/analyse.js"
import { renderAnalysis } from "./display.js"
import type { Portfolio } from "./domain/models.js"

// ─── Demo Layer ────────────────────────────────────────────────
// Uses test layers for data (deterministic, no network) but live
// layers for Logger and AlertNotifier so you see the full output.

const DemoLayer = Layer.mergeAll(
  PriceFeedTest,
  PortfolioStoreTest,
  LoggerLive,
  AlertNotifierLive,
  AppConfigTest,
  ClockLive,
  RateLimiterTest
)

// ─── Demo Portfolio ────────────────────────────────────────────

const demoPortfolio: Portfolio = {
  name: "Demo DeFi Portfolio",
  holdings: [
    { symbol: "BTC",  coinGeckoId: "bitcoin",     amount: 0.5   },
    { symbol: "ETH",  coinGeckoId: "ethereum",    amount: 8.0   },
    { symbol: "SOL",  coinGeckoId: "solana",      amount: 50.0  },
    { symbol: "AVAX", coinGeckoId: "avalanche-2", amount: 100.0 },
    { symbol: "LINK", coinGeckoId: "chainlink",   amount: 200.0 },
  ],
}

// ─── Program ───────────────────────────────────────────────────

const program = Effect.gen(function* () {
  console.log("\x1b[2m[Demo mode: using deterministic test data — no network required]\x1b[0m\n")

  const result = yield* runAnalysis(demoPortfolio)
  console.log(renderAnalysis(result))

  console.log("\x1b[2mTo run with live CoinGecko data: npm start\x1b[0m")
  console.log("\x1b[2mTo run the test suite:           npm test\x1b[0m\n")
})

Effect.runPromise(program.pipe(Effect.provide(DemoLayer))).catch((error) => {
  console.error("\nFatal error:", error)
  process.exit(1)
})
