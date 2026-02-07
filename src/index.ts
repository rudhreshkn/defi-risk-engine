// ─── Entry Point ───────────────────────────────────────────────
// This is the single boundary where the effectful world meets
// the real world. All services are wired via Layer composition
// and the Effect runtime executes the program here.
//
// Monitoring mode uses Effect Stream — a reactive, composable
// pipeline that models the infinite sequence of analysis cycles
// as a typed stream of AnalysisResult values, transformed and
// consumed through functional operators.
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

import { Effect, Layer, Schedule, Stream, Sink, Option } from "effect"
import { PriceFeedLive } from "./services/PriceFeed.js"
import { PortfolioStoreLive, PortfolioStore } from "./services/PortfolioStore.js"
import { LoggerLive, Logger } from "./services/Logger.js"
import { AlertNotifierLive } from "./services/AlertNotifier.js"
import { AppConfigLive, AppConfig } from "./services/AppConfig.js"
import { ClockLive } from "./services/Clock.js"
import { RateLimiterLive } from "./services/RateLimiter.js"
import { runAnalysis } from "./workflows/analyse.js"
import { renderAnalysis } from "./display.js"
import type { AnalysisResult, Portfolio } from "./domain/models.js"

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
  ClockLive,
  RateLimiterLive
)

// ─── CLI Arguments ─────────────────────────────────────────────

const isMonitorMode = process.argv.includes("--monitor")

// Allow CLI override of portfolio path (takes precedence over env var)
const cliPortfolioPath = process.argv
  .find((a) => a.startsWith("--portfolio="))
  ?.split("=")[1]

// ─── Stream-Based Monitoring Pipeline ──────────────────────────
// Models continuous monitoring as a reactive Stream:
//
//   tick stream (Schedule)
//     │
//     ▼
//   run analysis (effectful transformation)
//     │
//     ▼
//   render & display (sink / consumer)
//
// Each tick produces an AnalysisResult. Failed cycles emit
// nothing (errors are logged and swallowed). The stream runs
// until interrupted (Ctrl+C).

const monitorStream = (
  portfolio: Portfolio,
  intervalSeconds: number
) =>
  // Create an infinite stream of ticks on a schedule
  Stream.fromSchedule(Schedule.spaced(`${intervalSeconds} seconds`)).pipe(
    // Prepend an immediate first tick (don't wait for first interval)
    Stream.prepend(0),
    // For each tick, run the analysis pipeline
    Stream.mapEffect((_tick) =>
      runAnalysis(portfolio).pipe(
        Effect.map((result) => ({ ok: true as const, result })),
        Effect.catchAll((error) =>
          Effect.gen(function* () {
            const logger = yield* Logger
            yield* logger.error("Analysis cycle failed", { error: String(error) })
            return { ok: false as const, result: null as unknown as AnalysisResult }
          })
        )
      )
    ),
    // Filter out failed cycles
    Stream.filter((outcome): outcome is { ok: true; result: AnalysisResult } => outcome.ok),
    // Extract the result
    Stream.map((outcome) => outcome.result),
    // Track consecutive results for comparison
    Stream.zipWithPrevious,
    // Render each result with optional comparison to previous
    Stream.tap(([previousOpt, current]) =>
      Effect.sync(() => {
        const previous = Option.isSome(previousOpt) ? previousOpt.value : null
        console.clear()
        console.log(renderAnalysis(current, previous))
        console.log(
          `  \x1b[2mNext update in ${intervalSeconds}s... (Ctrl+C to exit)\x1b[0m`
        )
      })
    )
  )

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
    // ── Stream-Based Monitoring Mode ─────────────────────────
    // The monitoring pipeline is expressed as an Effect Stream:
    // an infinite, composable sequence of analysis results that
    // is consumed via Stream.runDrain (a Sink that discards
    // values after side effects have been performed).
    yield* logger.info("Entering stream-based monitoring mode", {
      intervalSeconds: config.monitorIntervalSeconds,
    })

    yield* monitorStream(portfolio, config.monitorIntervalSeconds).pipe(
      Stream.runDrain
    )
  } else {
    // ── Single-Shot Mode ─────────────────────────────────────
    // Load previous result from history for comparison
    const history = yield* store.loadHistory(config.historyPath).pipe(
      Effect.catchAll(() => Effect.succeed([] as AnalysisResult[]))
    )
    const previous = history.length > 0 ? history[history.length - 1] : null

    const result = yield* runAnalysis(portfolio)
    yield* Effect.sync(() => console.log(renderAnalysis(result, previous)))
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
