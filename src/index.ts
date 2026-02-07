// ─── Entry Point ───────────────────────────────────────────────
// This is the single boundary where the effectful world meets
// the real world. All services are wired via Layer composition
// and the Effect runtime executes the program here.
//
// Usage:
//   npm start                           Single-shot analysis
//   npm run monitor                     Continuous monitoring
//   npm start -- --portfolio=my.json    Custom portfolio file
//
// Environment variables (all optional, sensible defaults):
//   PORTFOLIO_PATH             Path to portfolio JSON (default: ./portfolio.json)
//   HISTORY_PATH               Path to history file (default: ./analysis-history.json)
//   MONITOR_INTERVAL           Seconds between monitor cycles (default: 60)
//   PRICE_FEED_CONCURRENCY     Concurrent historical price fetches (default: 3)
//   MAX_RETRIES                Retry attempts on API failure (default: 3)
//   THRESHOLD_VAR_WARNING      VaR % warning level (default: 0.03)
//   THRESHOLD_VAR_CRITICAL     VaR % critical level (default: 0.05)
//   THRESHOLD_VOL_WARNING      Volatility warning level (default: 0.6)
//   THRESHOLD_VOL_CRITICAL     Volatility critical level (default: 0.8)
//   THRESHOLD_HHI_WARNING      HHI warning level (default: 0.35)
//   THRESHOLD_HHI_CRITICAL     HHI critical level (default: 0.5)
//   THRESHOLD_DRAWDOWN_CRITICAL Drawdown critical level (default: 0.15)

import { Effect, Layer, Schedule } from "effect"
import { PriceFeedLive } from "./services/PriceFeed.js"
import { PortfolioStoreLive, PortfolioStore } from "./services/PortfolioStore.js"
import { LoggerLive, Logger } from "./services/Logger.js"
import { AlertNotifierLive } from "./services/AlertNotifier.js"
import { AppConfigLive, AppConfig } from "./services/AppConfig.js"
import { ClockLive } from "./services/Clock.js"
import { runAnalysis } from "./workflows/analyse.js"
import { renderAnalysis } from "./display.js"

// ─── Layer Composition ─────────────────────────────────────────
// All live service implementations composed into a single layer.
// Each service is an independent, swappable building block:
//   PriceFeedLive  → CoinGecko HTTP (swap to PriceFeedTest for mocks)
//   PortfolioStoreLive → filesystem (swap to PortfolioStoreTest for in-memory)
//   LoggerLive → console (swap to LoggerSilent for tests)
//   AlertNotifierLive → formatted console (swap to AlertNotifierSilent)
//   AppConfigLive → environment variables (swap to AppConfigTest for defaults)
//   ClockLive → system clock (swap to ClockTest for fixed time)

const AppLive = Layer.mergeAll(
  PriceFeedLive,
  PortfolioStoreLive,
  LoggerLive,
  AlertNotifierLive,
  AppConfigLive,
  ClockLive
)

// ─── CLI Arguments ─────────────────────────────────────────────

const isMonitorMode = process.argv.includes("--monitor")

// Allow CLI override of portfolio path (takes precedence over env var)
const cliPortfolioPath = process.argv
  .find((a) => a.startsWith("--portfolio="))
  ?.split("=")[1]

// ─── Program ───────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const store = yield* PortfolioStore
  const logger = yield* Logger
  const config = yield* AppConfig

  const portfolioPath = cliPortfolioPath ?? config.portfolioPath

  // Load portfolio from config file (effect: file I/O)
  yield* logger.info("Loading portfolio", { path: portfolioPath })
  const portfolio = yield* store.loadPortfolio(portfolioPath)
  yield* logger.info("Portfolio loaded", {
    name: portfolio.name,
    holdings: portfolio.holdings.length,
  })

  if (isMonitorMode) {
    // ── Monitoring Mode ──────────────────────────────────────
    // Runs the analysis pipeline on a configurable interval using
    // Effect.repeat with a Schedule (effect: time).
    yield* logger.info("Entering monitoring mode", {
      intervalSeconds: config.monitorIntervalSeconds,
    })

    const loop = Effect.gen(function* () {
      const result = yield* runAnalysis(portfolio)
      yield* Effect.sync(() => {
        console.clear()
        console.log(renderAnalysis(result))
        console.log(
          `  \x1b[2mNext update in ${config.monitorIntervalSeconds}s... (Ctrl+C to exit)\x1b[0m`
        )
      })
    }).pipe(
      Effect.catchAll((e) =>
        Effect.gen(function* () {
          const logSvc = yield* Logger
          yield* logSvc.error("Analysis cycle failed", { error: String(e) })
        })
      )
    )

    // Run once immediately, then repeat on schedule
    yield* loop
    yield* Effect.repeat(
      loop,
      Schedule.spaced(`${config.monitorIntervalSeconds} seconds`)
    )
  } else {
    // ── Single-Shot Mode ─────────────────────────────────────
    const result = yield* runAnalysis(portfolio)
    yield* Effect.sync(() => console.log(renderAnalysis(result)))
  }
})

// ─── Runtime ───────────────────────────────────────────────────
// The single call to Effect.runPromise — the edge of the world.
// Everything above is a description of what to do. This line
// actually does it.

Effect.runPromise(program.pipe(Effect.provide(AppLive))).catch((error) => {
  console.error("\nFatal error:", error)
  process.exit(1)
})
