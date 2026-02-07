// ─── Pure Risk Calculations ────────────────────────────────────
// Every function in this module is a pure function: deterministic,
// no I/O, no service dependencies, no Effect types. Given the same
// inputs, they always produce the same outputs. This is the
// mathematical core of the engine.

import type {
  TokenHolding,
  TokenPrice,
  HistoricalPrices,
  HoldingValuation,
  PortfolioValuation,
  RiskMetrics,
  RiskAlert,
} from "./models.js"

// ─── Constants ─────────────────────────────────────────────────

const Z_95 = 1.645                    // Normal distribution 95th percentile
const Z_99 = 2.326                    // Normal distribution 99th percentile
const TRADING_DAYS_PER_YEAR = 365     // Crypto markets trade 24/7/365
const RISK_FREE_RATE = 0.045          // Annualised risk-free rate (~US T-bill)

// ─── Portfolio Valuation ───────────────────────────────────────

export function valuatePortfolio(
  holdings: readonly TokenHolding[],
  prices: readonly TokenPrice[]
): PortfolioValuation {
  const priceMap = new Map(prices.map((p) => [p.coinGeckoId, p]))

  const valued: HoldingValuation[] = holdings.map((h) => {
    const price = priceMap.get(h.coinGeckoId)
    const priceUsd = price?.priceUsd ?? 0
    const valueUsd = h.amount * priceUsd
    return {
      symbol: h.symbol,
      coinGeckoId: h.coinGeckoId,
      amount: h.amount,
      valueUsd,
      weight: 0,
      price: priceUsd,
      change24h: price?.change24h ?? 0,
    }
  })

  const totalValueUsd = valued.reduce((sum, h) => sum + h.valueUsd, 0)

  const withWeights = valued.map((h) => ({
    ...h,
    weight: totalValueUsd > 0 ? h.valueUsd / totalValueUsd : 0,
  }))

  return { totalValueUsd, holdings: withWeights }
}

// ─── Return Series ─────────────────────────────────────────────

export function calculateDailyReturns(prices: readonly number[]): number[] {
  const returns: number[] = []
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] > 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1])
    }
  }
  return returns
}

export function calculatePortfolioReturns(
  historicalPrices: readonly HistoricalPrices[],
  holdings: readonly HoldingValuation[]
): number[] {
  const weightMap = new Map(holdings.map((h) => [h.coinGeckoId, h.weight]))
  const returnsByToken = historicalPrices.map((hp) => ({
    coinGeckoId: hp.coinGeckoId,
    returns: calculateDailyReturns(hp.dailyPrices),
  }))

  if (returnsByToken.length === 0) return []
  const minLength = Math.min(...returnsByToken.map((r) => r.returns.length))
  if (minLength === 0) return []

  const portfolioReturns: number[] = []
  for (let i = 0; i < minLength; i++) {
    let dailyReturn = 0
    for (const { coinGeckoId, returns } of returnsByToken) {
      const weight = weightMap.get(coinGeckoId) ?? 0
      dailyReturn += weight * returns[i]
    }
    portfolioReturns.push(dailyReturn)
  }

  return portfolioReturns
}

// ─── Statistical Helpers ───────────────────────────────────────

function mean(values: readonly number[]): number {
  if (values.length === 0) return 0
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

function standardDeviation(values: readonly number[]): number {
  if (values.length < 2) return 0
  const avg = mean(values)
  const squaredDiffs = values.map((v) => (v - avg) ** 2)
  return Math.sqrt(
    squaredDiffs.reduce((sum, v) => sum + v, 0) / (values.length - 1)
  )
}

function calculateMaxDrawdown(returns: readonly number[]): number {
  if (returns.length === 0) return 0
  let cumulative = 1
  let peak = 1
  let maxDD = 0

  for (const r of returns) {
    cumulative *= 1 + r
    if (cumulative > peak) peak = cumulative
    const drawdown = (peak - cumulative) / peak
    if (drawdown > maxDD) maxDD = drawdown
  }

  return maxDD
}

// ─── Risk Metrics ──────────────────────────────────────────────

export function calculateRiskMetrics(
  portfolioValue: number,
  portfolioReturns: readonly number[],
  weights: readonly { weight: number }[]
): RiskMetrics {
  const dailyVol = standardDeviation(portfolioReturns)
  const annualisedVol = dailyVol * Math.sqrt(TRADING_DAYS_PER_YEAR)

  // Parametric Value at Risk (assumes normal returns)
  const var95 = portfolioValue * Z_95 * dailyVol
  const var99 = portfolioValue * Z_99 * dailyVol

  // Annualised Sharpe ratio
  const dailyMeanReturn = mean(portfolioReturns)
  const annualisedReturn = dailyMeanReturn * TRADING_DAYS_PER_YEAR
  const sharpe =
    dailyVol > 0 ? (annualisedReturn - RISK_FREE_RATE) / annualisedVol : 0

  // Herfindahl-Hirschman Index (portfolio concentration)
  // 1/N = perfectly diversified, 1.0 = single asset
  const hhi = weights.reduce((sum, w) => sum + w.weight ** 2, 0)

  // Maximum drawdown over the return window
  const maxDrawdown = calculateMaxDrawdown(portfolioReturns)

  return {
    valueAtRisk95: var95,
    valueAtRisk99: var99,
    volatilityAnnualised: annualisedVol,
    sharpeRatio: sharpe,
    concentrationHHI: hhi,
    maxDrawdown,
  }
}

// ─── Alert Generation ──────────────────────────────────────────

export interface RiskThresholds {
  readonly varPctWarning: number
  readonly varPctCritical: number
  readonly volWarning: number
  readonly volCritical: number
  readonly hhiWarning: number
  readonly hhiCritical: number
  readonly drawdownCritical: number
}

export const DEFAULT_THRESHOLDS: RiskThresholds = {
  varPctWarning: 0.03,
  varPctCritical: 0.05,
  volWarning: 0.6,
  volCritical: 0.8,
  hhiWarning: 0.35,
  hhiCritical: 0.5,
  drawdownCritical: 0.15,
}

export function generateAlerts(
  valuation: PortfolioValuation,
  risk: RiskMetrics,
  thresholds: RiskThresholds
): RiskAlert[] {
  const alerts: RiskAlert[] = []
  const totalValue = valuation.totalValueUsd

  if (totalValue === 0) return alerts

  // Value at Risk alerts
  const varPct = risk.valueAtRisk95 / totalValue
  if (varPct > thresholds.varPctCritical) {
    alerts.push({
      level: "critical",
      metric: "VaR (95%)",
      message: `Daily VaR is ${(varPct * 100).toFixed(1)}% of portfolio (threshold: ${(thresholds.varPctCritical * 100).toFixed(1)}%)`,
      value: varPct,
      threshold: thresholds.varPctCritical,
    })
  } else if (varPct > thresholds.varPctWarning) {
    alerts.push({
      level: "warning",
      metric: "VaR (95%)",
      message: `Daily VaR is ${(varPct * 100).toFixed(1)}% of portfolio (threshold: ${(thresholds.varPctWarning * 100).toFixed(1)}%)`,
      value: varPct,
      threshold: thresholds.varPctWarning,
    })
  }

  // Volatility alerts
  if (risk.volatilityAnnualised > thresholds.volCritical) {
    alerts.push({
      level: "critical",
      metric: "Volatility",
      message: `Annualised volatility at ${(risk.volatilityAnnualised * 100).toFixed(0)}% (threshold: ${(thresholds.volCritical * 100).toFixed(0)}%)`,
      value: risk.volatilityAnnualised,
      threshold: thresholds.volCritical,
    })
  } else if (risk.volatilityAnnualised > thresholds.volWarning) {
    alerts.push({
      level: "warning",
      metric: "Volatility",
      message: `Annualised volatility at ${(risk.volatilityAnnualised * 100).toFixed(0)}% (threshold: ${(thresholds.volWarning * 100).toFixed(0)}%)`,
      value: risk.volatilityAnnualised,
      threshold: thresholds.volWarning,
    })
  }

  // Concentration alerts
  if (risk.concentrationHHI > thresholds.hhiCritical) {
    alerts.push({
      level: "critical",
      metric: "Concentration",
      message: `HHI at ${risk.concentrationHHI.toFixed(2)} — portfolio highly concentrated (threshold: ${thresholds.hhiCritical.toFixed(2)})`,
      value: risk.concentrationHHI,
      threshold: thresholds.hhiCritical,
    })
  } else if (risk.concentrationHHI > thresholds.hhiWarning) {
    alerts.push({
      level: "warning",
      metric: "Concentration",
      message: `HHI at ${risk.concentrationHHI.toFixed(2)} — moderately concentrated (threshold: ${thresholds.hhiWarning.toFixed(2)})`,
      value: risk.concentrationHHI,
      threshold: thresholds.hhiWarning,
    })
  }

  // Drawdown alert
  if (risk.maxDrawdown > thresholds.drawdownCritical) {
    alerts.push({
      level: "critical",
      metric: "Max Drawdown",
      message: `30-day max drawdown at ${(risk.maxDrawdown * 100).toFixed(1)}% (threshold: ${(thresholds.drawdownCritical * 100).toFixed(0)}%)`,
      value: risk.maxDrawdown,
      threshold: thresholds.drawdownCritical,
    })
  }

  return alerts
}
