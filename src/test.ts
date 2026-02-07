// ─── Test Suite ────────────────────────────────────────────────
// Demonstrates the testability benefit of the Effect architecture.
//
// Three test categories:
// 1. Pure Domain Tests — call pure functions directly, no mocks
// 2. Effectful Integration Tests — swap live layers for test layers
// 3. Failure & Edge Case Tests — verify graceful degradation
//
// Key insight: the pure core (domain/risk.ts) requires ZERO
// infrastructure to test. The effectful layer requires only
// swapping Layer implementations — no monkey-patching, no
// dependency injection containers, no test doubles library.

import { Effect, Layer } from "effect"
import { PriceFeedTest, PriceFeed, PriceFeedError } from "./services/PriceFeed.js"
import { PortfolioStoreTest, PortfolioStore } from "./services/PortfolioStore.js"
import { LoggerSilent } from "./services/Logger.js"
import { AlertNotifierSilent } from "./services/AlertNotifier.js"
import { AppConfigTest } from "./services/AppConfig.js"
import { ClockTest } from "./services/Clock.js"
import { runAnalysis } from "./workflows/analyse.js"
import type { Portfolio, PortfolioValuation, RiskMetrics } from "./domain/models.js"
import * as Risk from "./domain/risk.js"

let passed = 0
let failed = 0
const errors: string[] = []

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  \x1b[32m✓\x1b[0m ${label}`)
    passed++
  } else {
    console.log(`  \x1b[31m✗\x1b[0m ${label}`)
    failed++
    errors.push(label)
  }
}

function section(title: string, subtitle?: string) {
  const sub = subtitle ? ` \x1b[2m(${subtitle})\x1b[0m` : ""
  console.log(`\n\x1b[1m${title}\x1b[0m${sub}`)
  console.log("─".repeat(56))
}

// ─── 1. Pure Domain Tests ──────────────────────────────────────
// These tests require no mocks, no layers, no Effect runtime.
// They call pure functions directly with synthetic data.

function testDailyReturns() {
  section("Daily Returns", "pure")

  const returns = Risk.calculateDailyReturns([100, 105, 102, 108])
  assert(returns.length === 3, "4 prices → 3 returns")
  assert(Math.abs(returns[0] - 0.05) < 0.001, "first return is +5%")
  assert(Math.abs(returns[1] - (-3 / 105)) < 0.001, "second return is negative")
  assert(Math.abs(returns[2] - (6 / 102)) < 0.001, "third return is positive")

  // Edge cases
  const empty = Risk.calculateDailyReturns([])
  assert(empty.length === 0, "empty prices → empty returns")

  const single = Risk.calculateDailyReturns([100])
  assert(single.length === 0, "single price → no returns")

  const flat = Risk.calculateDailyReturns([100, 100, 100])
  assert(flat.every((r) => r === 0), "flat prices → zero returns")
}

function testPortfolioValuation() {
  section("Portfolio Valuation", "pure")

  const valuation = Risk.valuatePortfolio(
    [
      { symbol: "BTC", coinGeckoId: "bitcoin", amount: 1 },
      { symbol: "ETH", coinGeckoId: "ethereum", amount: 10 },
    ],
    [
      { coinGeckoId: "bitcoin", priceUsd: 42000, change24h: -1 },
      { coinGeckoId: "ethereum", priceUsd: 2200, change24h: 2 },
    ]
  )

  assert(valuation.totalValueUsd === 64000, `total = $64,000 (got $${valuation.totalValueUsd})`)
  assert(valuation.holdings.length === 2, "two holdings")
  assert(
    Math.abs(valuation.holdings[0].weight - 42000 / 64000) < 0.001,
    `BTC weight ≈ 65.6% (got ${(valuation.holdings[0].weight * 100).toFixed(1)}%)`
  )
  assert(
    Math.abs(valuation.holdings[1].weight - 22000 / 64000) < 0.001,
    `ETH weight ≈ 34.4% (got ${(valuation.holdings[1].weight * 100).toFixed(1)}%)`
  )

  // Weights sum to 1
  const weightSum = valuation.holdings.reduce((s, h) => s + h.weight, 0)
  assert(Math.abs(weightSum - 1.0) < 0.001, `weights sum to 1.0 (got ${weightSum.toFixed(4)})`)

  // Missing price
  const partial = Risk.valuatePortfolio(
    [{ symbol: "XYZ", coinGeckoId: "nonexistent", amount: 5 }],
    []
  )
  assert(partial.totalValueUsd === 0, "missing price → zero value")
  assert(partial.holdings[0].weight === 0, "missing price → zero weight")

  // Empty portfolio
  const empty = Risk.valuatePortfolio([], [])
  assert(empty.totalValueUsd === 0, "empty portfolio → zero value")
  assert(empty.holdings.length === 0, "empty portfolio → no holdings")
}

function testRiskMetrics() {
  section("Risk Metrics", "pure")

  // Realistic daily returns over 30 days
  const returns = [
    0.01, -0.02, 0.015, -0.01, 0.005, -0.005, 0.02, -0.015, 0.008, -0.012,
    0.003, -0.008, 0.011, -0.006, 0.009, -0.004, 0.007, -0.013, 0.006, -0.002,
    0.014, -0.009, 0.004, -0.011, 0.008, -0.003, 0.012, -0.007, 0.005, -0.001,
  ]
  const weights = [{ weight: 0.6 }, { weight: 0.3 }, { weight: 0.1 }]
  const metrics = Risk.calculateRiskMetrics(100000, returns, weights)

  assert(metrics.valueAtRisk95 > 0, `VaR95 is positive ($${metrics.valueAtRisk95.toFixed(2)})`)
  assert(metrics.valueAtRisk99 > 0, `VaR99 is positive ($${metrics.valueAtRisk99.toFixed(2)})`)
  assert(metrics.valueAtRisk99 > metrics.valueAtRisk95, "VaR99 > VaR95")
  assert(metrics.volatilityAnnualised > 0, `volatility is positive (${(metrics.volatilityAnnualised * 100).toFixed(2)}%)`)
  assert(
    metrics.concentrationHHI > 0 && metrics.concentrationHHI <= 1,
    `HHI in (0, 1] (got ${metrics.concentrationHHI.toFixed(4)})`
  )
  assert(
    metrics.maxDrawdown >= 0 && metrics.maxDrawdown <= 1,
    `max drawdown in [0, 1] (got ${(metrics.maxDrawdown * 100).toFixed(2)}%)`
  )

  // HHI for single-asset portfolio = 1.0
  const singleAsset = Risk.calculateRiskMetrics(50000, returns, [{ weight: 1.0 }])
  assert(Math.abs(singleAsset.concentrationHHI - 1.0) < 0.001, "single asset → HHI = 1.0")

  // Equal-weighted two assets → HHI = 0.5
  const equalWeights = Risk.calculateRiskMetrics(50000, returns, [
    { weight: 0.5 },
    { weight: 0.5 },
  ])
  assert(Math.abs(equalWeights.concentrationHHI - 0.5) < 0.001, "equal 2-asset → HHI = 0.5")

  // Zero portfolio value
  const zeroVal = Risk.calculateRiskMetrics(0, returns, weights)
  assert(zeroVal.valueAtRisk95 === 0, "zero portfolio → zero VaR")

  // Empty returns
  const noReturns = Risk.calculateRiskMetrics(100000, [], weights)
  assert(noReturns.volatilityAnnualised === 0, "no returns → zero volatility")
  assert(noReturns.sharpeRatio === 0, "no returns → zero Sharpe")
}

function testPortfolioReturns() {
  section("Portfolio Returns", "pure")

  const historical = [
    { coinGeckoId: "bitcoin", dailyPrices: [40000, 41000, 40500, 42000] },
    { coinGeckoId: "ethereum", dailyPrices: [2000, 2100, 2050, 2150] },
  ]
  const holdings = [
    { symbol: "BTC", coinGeckoId: "bitcoin", amount: 1, valueUsd: 42000, weight: 0.7, price: 42000, change24h: 0 },
    { symbol: "ETH", coinGeckoId: "ethereum", amount: 10, valueUsd: 18000, weight: 0.3, price: 1800, change24h: 0 },
  ]

  const returns = Risk.calculatePortfolioReturns(historical, holdings)
  assert(returns.length === 3, "4 prices per token → 3 portfolio returns")
  assert(returns.every((r) => typeof r === "number" && isFinite(r)), "all returns are finite numbers")

  // Empty historical
  const emptyReturns = Risk.calculatePortfolioReturns([], holdings)
  assert(emptyReturns.length === 0, "no historical data → no returns")
}

function testAlertGeneration() {
  section("Alert Generation", "pure")

  const baseValuation: PortfolioValuation = { totalValueUsd: 100000, holdings: [] }
  const baseRisk: RiskMetrics = {
    valueAtRisk95: 1000,
    valueAtRisk99: 1500,
    volatilityAnnualised: 0.3,
    sharpeRatio: 1.5,
    concentrationHHI: 0.2,
    maxDrawdown: 0.05,
  }

  // No alerts for safe metrics
  const safe = Risk.generateAlerts(baseValuation, baseRisk, Risk.DEFAULT_THRESHOLDS)
  assert(safe.length === 0, "safe portfolio → no alerts")

  // High VaR
  const highVar: RiskMetrics = { ...baseRisk, valueAtRisk95: 6000 }
  const varAlerts = Risk.generateAlerts(baseValuation, highVar, Risk.DEFAULT_THRESHOLDS)
  assert(varAlerts.some((a) => a.metric === "VaR (95%)"), "high VaR → VaR alert")
  assert(varAlerts.some((a) => a.level === "critical"), "6% VaR → critical level")

  // High volatility
  const highVol: RiskMetrics = { ...baseRisk, volatilityAnnualised: 0.9 }
  const volAlerts = Risk.generateAlerts(baseValuation, highVol, Risk.DEFAULT_THRESHOLDS)
  assert(volAlerts.some((a) => a.metric === "Volatility"), "high vol → volatility alert")

  // Warning-level volatility
  const warnVol: RiskMetrics = { ...baseRisk, volatilityAnnualised: 0.65 }
  const warnAlerts = Risk.generateAlerts(baseValuation, warnVol, Risk.DEFAULT_THRESHOLDS)
  assert(
    warnAlerts.some((a) => a.metric === "Volatility" && a.level === "warning"),
    "moderate vol → warning alert"
  )

  // High concentration
  const concentrated: RiskMetrics = { ...baseRisk, concentrationHHI: 0.6 }
  const concAlerts = Risk.generateAlerts(baseValuation, concentrated, Risk.DEFAULT_THRESHOLDS)
  assert(concAlerts.some((a) => a.metric === "Concentration"), "concentrated → HHI alert")

  // High drawdown
  const drawdown: RiskMetrics = { ...baseRisk, maxDrawdown: 0.2 }
  const ddAlerts = Risk.generateAlerts(baseValuation, drawdown, Risk.DEFAULT_THRESHOLDS)
  assert(ddAlerts.some((a) => a.metric === "Max Drawdown"), "high drawdown → alert")

  // Multiple simultaneous alerts
  const allBad: RiskMetrics = {
    valueAtRisk95: 8000,
    valueAtRisk99: 12000,
    volatilityAnnualised: 0.95,
    sharpeRatio: -2.0,
    concentrationHHI: 0.7,
    maxDrawdown: 0.25,
  }
  const multiAlerts = Risk.generateAlerts(baseValuation, allBad, Risk.DEFAULT_THRESHOLDS)
  assert(multiAlerts.length >= 4, `multiple risks → ${multiAlerts.length} alerts (≥4 expected)`)

  // Zero portfolio value → no alerts
  const zeroAlerts = Risk.generateAlerts(
    { totalValueUsd: 0, holdings: [] },
    allBad,
    Risk.DEFAULT_THRESHOLDS
  )
  assert(zeroAlerts.length === 0, "zero-value portfolio → no alerts")
}

// ─── 2. Effectful Integration Tests ────────────────────────────
// Full pipeline with test layers. No network, no filesystem.

async function testEffectfulWorkflow() {
  section("Effectful Workflow", "mock layers")

  const TestLayer = Layer.mergeAll(
    PriceFeedTest,
    PortfolioStoreTest,
    LoggerSilent,
    AlertNotifierSilent,
    AppConfigTest,
    ClockTest
  )

  const mockPortfolio: Portfolio = {
    name: "Test Portfolio",
    holdings: [
      { symbol: "BTC", coinGeckoId: "bitcoin", amount: 1.0 },
      { symbol: "ETH", coinGeckoId: "ethereum", amount: 10.0 },
    ],
  }

  const result = await Effect.runPromise(
    runAnalysis(mockPortfolio).pipe(Effect.provide(TestLayer))
  )

  assert(result.valuation.totalValueUsd > 0, `portfolio has value ($${result.valuation.totalValueUsd.toFixed(2)})`)
  assert(result.valuation.holdings.length === 2, "two holdings returned")
  assert(result.risk.valueAtRisk95 > 0, `VaR95 computed ($${result.risk.valueAtRisk95.toFixed(2)})`)
  assert(result.risk.volatilityAnnualised > 0, `volatility computed (${(result.risk.volatilityAnnualised * 100).toFixed(2)}%)`)
  assert(result.risk.concentrationHHI > 0, `HHI computed (${result.risk.concentrationHHI.toFixed(3)})`)
  assert(result.timestamp === "2026-01-15T12:00:00.000Z", "timestamp from Clock service (deterministic)")

  // Weights are correct
  const totalWeight = result.valuation.holdings.reduce((s, h) => s + h.weight, 0)
  assert(Math.abs(totalWeight - 1.0) < 0.001, "weights sum to 1.0")
}

// ─── 3. Failure & Edge Case Tests ──────────────────────────────
// Verify graceful degradation when services fail.

async function testGracefulDegradation() {
  section("Graceful Degradation", "failing PriceFeed")

  // PriceFeed that fails on historical prices
  const FailingPriceFeed = Layer.succeed(PriceFeed, {
    getCurrentPrices: (coinIds) =>
      Effect.succeed(
        coinIds.map((id) => ({
          coinGeckoId: id,
          priceUsd: id === "bitcoin" ? 42000 : 2200,
          change24h: 0,
        }))
      ),
    getHistoricalPrices: () =>
      Effect.fail(new PriceFeedError({ reason: "Simulated API outage" })),
  })

  const TestLayer = Layer.mergeAll(
    FailingPriceFeed,
    PortfolioStoreTest,
    LoggerSilent,
    AlertNotifierSilent,
    AppConfigTest,
    ClockTest
  )

  const mockPortfolio: Portfolio = {
    name: "Degradation Test",
    holdings: [
      { symbol: "BTC", coinGeckoId: "bitcoin", amount: 1.0 },
      { symbol: "ETH", coinGeckoId: "ethereum", amount: 10.0 },
    ],
  }

  const result = await Effect.runPromise(
    runAnalysis(mockPortfolio).pipe(Effect.provide(TestLayer))
  )

  assert(result.valuation.totalValueUsd > 0, "still has valuation despite API failure")
  assert(result.risk.concentrationHHI > 0, "HHI computed from weights (no history needed)")
  assert(result.timestamp.length > 0, "timestamp still present")
}

async function testSingleAssetPortfolio() {
  section("Single-Asset Portfolio", "mock layers")

  const TestLayer = Layer.mergeAll(
    PriceFeedTest,
    PortfolioStoreTest,
    LoggerSilent,
    AlertNotifierSilent,
    AppConfigTest,
    ClockTest
  )

  const singleAsset: Portfolio = {
    name: "BTC Only",
    holdings: [{ symbol: "BTC", coinGeckoId: "bitcoin", amount: 0.5 }],
  }

  const result = await Effect.runPromise(
    runAnalysis(singleAsset).pipe(Effect.provide(TestLayer))
  )

  assert(result.valuation.holdings.length === 1, "one holding")
  assert(result.valuation.holdings[0].weight === 1.0, "single asset weight = 1.0")
  assert(Math.abs(result.risk.concentrationHHI - 1.0) < 0.001, "single asset HHI = 1.0")
}

async function testLargePortfolio() {
  section("Large Portfolio (10 assets)", "mock layers")

  const TestLayer = Layer.mergeAll(
    PriceFeedTest,
    PortfolioStoreTest,
    LoggerSilent,
    AlertNotifierSilent,
    AppConfigTest,
    ClockTest
  )

  const large: Portfolio = {
    name: "Large Portfolio",
    holdings: Array.from({ length: 10 }, (_, i) => ({
      symbol: `TOKEN${i}`,
      coinGeckoId: `token-${i}`,
      amount: 100,
    })),
  }

  const result = await Effect.runPromise(
    runAnalysis(large).pipe(Effect.provide(TestLayer))
  )

  assert(result.valuation.holdings.length === 10, "ten holdings returned")
  const totalWeight = result.valuation.holdings.reduce((s, h) => s + h.weight, 0)
  assert(Math.abs(totalWeight - 1.0) < 0.001, "10 holdings weights still sum to 1.0")
  assert(result.risk.concentrationHHI < 1.0, `10 assets → HHI < 1.0 (got ${result.risk.concentrationHHI.toFixed(3)})`)
}

// ─── Run All ───────────────────────────────────────────────────

async function main() {
  console.log("\n\x1b[1m══════════════════════════════════════════════════════════\x1b[0m")
  console.log("\x1b[1m  DeFi Risk Engine — Test Suite\x1b[0m")
  console.log("\x1b[1m══════════════════════════════════════════════════════════\x1b[0m")

  // Pure domain tests (no Effect runtime needed)
  testDailyReturns()
  testPortfolioValuation()
  testRiskMetrics()
  testPortfolioReturns()
  testAlertGeneration()

  // Effectful tests (mock layers, no real I/O)
  await testEffectfulWorkflow()
  await testGracefulDegradation()
  await testSingleAssetPortfolio()
  await testLargePortfolio()

  // Summary
  console.log("\n" + "═".repeat(56))
  const status = failed > 0
    ? `\x1b[31m${failed} FAILED\x1b[0m`
    : `\x1b[32m0 failed\x1b[0m`
  console.log(`  \x1b[1m${passed} passed\x1b[0m, ${status}`)

  if (errors.length > 0) {
    console.log(`\n  \x1b[31mFailed tests:\x1b[0m`)
    for (const e of errors) {
      console.log(`    ✗ ${e}`)
    }
  }

  console.log()
  if (failed > 0) process.exit(1)
}

main().catch(console.error)
