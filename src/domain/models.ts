// ─── Pure Domain Models ────────────────────────────────────────
// These types describe the domain with zero Effect dependencies.
// They are plain data — no side effects, no I/O, fully serialisable.

export interface TokenHolding {
  readonly symbol: string
  readonly coinGeckoId: string
  readonly amount: number
}

export interface Portfolio {
  readonly name: string
  readonly holdings: readonly TokenHolding[]
}

export interface TokenPrice {
  readonly coinGeckoId: string
  readonly priceUsd: number
  readonly change24h: number
}

export interface HistoricalPrices {
  readonly coinGeckoId: string
  readonly dailyPrices: readonly number[]
}

export interface HoldingValuation {
  readonly symbol: string
  readonly coinGeckoId: string
  readonly amount: number
  readonly valueUsd: number
  readonly weight: number
  readonly price: number
  readonly change24h: number
}

export interface PortfolioValuation {
  readonly totalValueUsd: number
  readonly holdings: readonly HoldingValuation[]
}

export interface RiskMetrics {
  readonly valueAtRisk95: number
  readonly valueAtRisk99: number
  readonly volatilityAnnualised: number
  readonly sharpeRatio: number
  readonly concentrationHHI: number
  readonly maxDrawdown: number
}

export interface RiskAlert {
  readonly level: "info" | "warning" | "critical"
  readonly metric: string
  readonly message: string
  readonly value: number
  readonly threshold: number
}

export interface AnalysisResult {
  readonly timestamp: string
  readonly valuation: PortfolioValuation
  readonly risk: RiskMetrics
  readonly alerts: readonly RiskAlert[]
}
