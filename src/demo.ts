import { Effect, Layer } from "effect"
import { PriceFeedTest } from "./services/PriceFeed.js"
import { PortfolioStoreTest } from "./services/PortfolioStore.js"
import { LoggerLive } from "./services/Logger.js"
import { AlertNotifierLive } from "./services/AlertNotifier.js"
import { AppConfigTest } from "./services/AppConfig.js"
import { ClockLive } from "./services/Clock.js"
import { runAnalysis } from "./workflows/analyse.js"
import { renderAnalysis } from "./display.js"
import type { Portfolio } from "./domain/models.js"

const DemoLayer = Layer.mergeAll(
  PriceFeedTest,
  PortfolioStoreTest,
  LoggerLive,
  AlertNotifierLive,
  AppConfigTest,
  ClockLive
)

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
