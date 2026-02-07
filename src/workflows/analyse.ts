// ─── Analysis Workflow ─────────────────────────────────────────
// This module composes effectful services with pure domain logic
// into a complete analysis pipeline. It is the bridge between the
// effectful world (services) and the pure world (risk.ts).
//
// Data flow:
//   Config (env vars) → Portfolio config (file) → prices (network)
//   → valuation (pure) → historical prices (network, concurrent)
//   → returns (pure) → risk metrics (pure) → alerts (pure)
//   → persist (file I/O) → notify (console I/O)
//
// Graceful degradation:
//   If historical price fetching fails, the pipeline falls back
//   to the last cached analysis result rather than failing entirely.

import { Effect, Schedule } from "effect"
import { PriceFeed } from "../services/PriceFeed.js"
import { PortfolioStore } from "../services/PortfolioStore.js"
import { Logger } from "../services/Logger.js"
import { AlertNotifier } from "../services/AlertNotifier.js"
import { AppConfig } from "../services/AppConfig.js"
import { Clock } from "../services/Clock.js"
import * as Risk from "../domain/risk.js"
import type { Portfolio, AnalysisResult } from "../domain/models.js"

// ─── Core Analysis Pipeline ────────────────────────────────────

export const runAnalysis = (portfolio: Portfolio) =>
  Effect.gen(function* () {
    const priceFeed = yield* PriceFeed
    const store = yield* PortfolioStore
    const logger = yield* Logger
    const alertNotifier = yield* AlertNotifier
    const config = yield* AppConfig
    const clock = yield* Clock

    yield* logger.info("Starting portfolio analysis", {
      portfolio: portfolio.name,
      holdings: portfolio.holdings.length,
    })

    // ── Retry Policy ───────────────────────────────────────────
    // Exponential backoff: 1s → 2s → 4s, configurable max retries.
    const retryPolicy = Schedule.exponential("1 seconds").pipe(
      Schedule.intersect(Schedule.recurs(config.maxRetries))
    )

    // ── Step 1: Fetch current prices (effect: network I/O) ─────
    const coinIds = portfolio.holdings.map((h) => h.coinGeckoId)
    yield* logger.debug("Fetching current prices", { coins: coinIds })

    const prices = yield* priceFeed.getCurrentPrices(coinIds).pipe(
      Effect.retry(retryPolicy),
      Effect.tapError((e) =>
        logger.error("Price fetch failed after retries", { error: e.reason })
      )
    )

    yield* logger.debug("Prices received", {
      prices: prices.map((p) => ({
        id: p.coinGeckoId,
        usd: p.priceUsd,
      })),
    })

    // ── Step 2: Fetch historical prices concurrently ───────────
    //    (effect: network I/O + concurrency, configurable)
    //    Graceful degradation: if this fails, fall back to cached
    //    history rather than aborting the entire pipeline.
    yield* logger.debug("Fetching 30-day historical prices concurrently", {
      concurrency: config.priceFeedConcurrency,
    })

    const historicalResult = yield* Effect.all(
      coinIds.map((id) =>
        priceFeed.getHistoricalPrices(id, 30).pipe(Effect.retry(retryPolicy))
      ),
      { concurrency: config.priceFeedConcurrency }
    ).pipe(
      Effect.map((data) => ({ ok: true as const, data })),
      Effect.catchTag("PriceFeedError", (e) =>
        Effect.gen(function* () {
          yield* logger.warn("Historical prices unavailable, using fallback", {
            error: e.reason,
          })
          return { ok: false as const, data: [] as any[] }
        })
      )
    )

    // ── Step 3: Pure calculations (no effects) ─────────────────
    yield* logger.debug("Computing risk metrics (pure)")

    const valuation = Risk.valuatePortfolio(portfolio.holdings, prices)

    let risk: ReturnType<typeof Risk.calculateRiskMetrics>

    if (historicalResult.ok && historicalResult.data.length > 0) {
      // Full calculation with live historical data
      const portfolioReturns = Risk.calculatePortfolioReturns(
        historicalResult.data,
        valuation.holdings
      )
      risk = Risk.calculateRiskMetrics(
        valuation.totalValueUsd,
        portfolioReturns,
        valuation.holdings
      )
    } else {
      // Graceful degradation: attempt to use last cached result
      yield* logger.warn("Using estimated risk metrics from cached data")
      const cached = yield* store.loadHistory(config.historyPath).pipe(
        Effect.catchAll(() => Effect.succeed([] as AnalysisResult[]))
      )
      if (cached.length > 0) {
        risk = cached[cached.length - 1].risk
      } else {
        // No cache available — compute concentration only (no history needed)
        risk = {
          valueAtRisk95: 0,
          valueAtRisk99: 0,
          volatilityAnnualised: 0,
          sharpeRatio: 0,
          concentrationHHI: valuation.holdings.reduce(
            (sum, h) => sum + h.weight ** 2,
            0
          ),
          maxDrawdown: 0,
        }
      }
    }

    const alerts = Risk.generateAlerts(valuation, risk, config.thresholds)

    // ── Step 4: Timestamp (effect: time) ───────────────────────
    const timestamp = yield* clock.nowIso()

    const result: AnalysisResult = {
      timestamp,
      valuation,
      risk,
      alerts,
    }

    // ── Step 5: Persist results (effect: file I/O) ─────────────
    yield* store.saveResult(config.historyPath, result).pipe(
      Effect.catchAll((e) =>
        logger.warn("Could not persist results", { error: e.reason })
      )
    )

    // ── Step 6: Send alerts (effect: notification) ─────────────
    yield* alertNotifier.notify(alerts)

    yield* logger.info("Analysis complete", {
      value: valuation.totalValueUsd.toFixed(2),
      var95: risk.valueAtRisk95.toFixed(2),
      alertCount: alerts.length,
      dataSource: historicalResult.ok ? "live" : "cached",
    })

    return result
  })
