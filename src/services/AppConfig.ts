// ─── AppConfig Service ─────────────────────────────────────────
// Effect: Configuration (reading from environment variables)
// This service encapsulates all external configuration loading.
// Using Effect's Config module makes configuration an explicit,
// typed, and testable effect rather than scattered process.env
// reads throughout the codebase.

import { Context, Config, Effect, Layer } from "effect"
import type { RiskThresholds } from "../domain/risk.js"

// ─── Config Shape ──────────────────────────────────────────────

export interface AppConfiguration {
  readonly portfolioPath: string
  readonly historyPath: string
  readonly monitorIntervalSeconds: number
  readonly priceFeedConcurrency: number
  readonly maxRetries: number
  readonly thresholds: RiskThresholds
}

// ─── Service Definition ────────────────────────────────────────

export class AppConfig extends Context.Tag("@app/AppConfig")<
  AppConfig,
  AppConfiguration
>() {}

// ─── Live Implementation (environment variables) ───────────────
// Reads configuration from environment variables with sensible
// defaults. Every value is loaded through Effect's Config module,
// making configuration loading an explicit, composable effect.

const loadConfig = Effect.gen(function* () {
  const portfolioPath = yield* Config.string("PORTFOLIO_PATH").pipe(
    Config.withDefault("./portfolio.json")
  )
  const historyPath = yield* Config.string("HISTORY_PATH").pipe(
    Config.withDefault("./analysis-history.json")
  )
  const monitorIntervalSeconds = yield* Config.number("MONITOR_INTERVAL").pipe(
    Config.withDefault(60)
  )
  const priceFeedConcurrency = yield* Config.number("PRICE_FEED_CONCURRENCY").pipe(
    Config.withDefault(3)
  )
  const maxRetries = yield* Config.number("MAX_RETRIES").pipe(
    Config.withDefault(3)
  )

  // Risk thresholds
  const varPctWarning = yield* Config.number("THRESHOLD_VAR_WARNING").pipe(
    Config.withDefault(0.03)
  )
  const varPctCritical = yield* Config.number("THRESHOLD_VAR_CRITICAL").pipe(
    Config.withDefault(0.05)
  )
  const volWarning = yield* Config.number("THRESHOLD_VOL_WARNING").pipe(
    Config.withDefault(0.6)
  )
  const volCritical = yield* Config.number("THRESHOLD_VOL_CRITICAL").pipe(
    Config.withDefault(0.8)
  )
  const hhiWarning = yield* Config.number("THRESHOLD_HHI_WARNING").pipe(
    Config.withDefault(0.35)
  )
  const hhiCritical = yield* Config.number("THRESHOLD_HHI_CRITICAL").pipe(
    Config.withDefault(0.5)
  )
  const drawdownCritical = yield* Config.number("THRESHOLD_DRAWDOWN_CRITICAL").pipe(
    Config.withDefault(0.15)
  )

  return {
    portfolioPath,
    historyPath,
    monitorIntervalSeconds,
    priceFeedConcurrency,
    maxRetries,
    thresholds: {
      varPctWarning,
      varPctCritical,
      volWarning,
      volCritical,
      hhiWarning,
      hhiCritical,
      drawdownCritical,
    },
  } satisfies AppConfiguration
})

export const AppConfigLive = Layer.effect(AppConfig, loadConfig)

// ─── Test Implementation (hardcoded defaults) ──────────────────

export const AppConfigTest = Layer.succeed(AppConfig, {
  portfolioPath: "./portfolio.json",
  historyPath: "./test-history.json",
  monitorIntervalSeconds: 5,
  priceFeedConcurrency: 2,
  maxRetries: 1,
  thresholds: {
    varPctWarning: 0.03,
    varPctCritical: 0.05,
    volWarning: 0.6,
    volCritical: 0.8,
    hhiWarning: 0.35,
    hhiCritical: 0.5,
    drawdownCritical: 0.15,
  },
})
