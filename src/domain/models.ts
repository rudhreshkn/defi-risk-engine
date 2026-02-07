// ─── Pure Domain Models ────────────────────────────────────────
// These types describe the domain with zero side effects.
//
// Branded types (via Effect Schema) provide type-level safety:
// you cannot accidentally pass a USD value where a Percentage is
// expected, or a CoinGeckoId where a ticker Symbol is needed.
// The TypeScript compiler enforces these distinctions at build
// time, while Schema validates them at runtime boundaries.

import { Schema } from "effect"

// ─── Branded Primitives ────────────────────────────────────────
// These create nominal types that are structurally incompatible
// even though they are all strings or numbers at runtime.
// A CoinGeckoId cannot be assigned to a Symbol and vice versa.

export const CoinGeckoId = Schema.String.pipe(Schema.brand("CoinGeckoId"))
export type CoinGeckoId = typeof CoinGeckoId.Type

export const TokenSymbol = Schema.String.pipe(Schema.brand("TokenSymbol"))
export type TokenSymbol = typeof TokenSymbol.Type

export const USD = Schema.Number.pipe(Schema.brand("USD"))
export type USD = typeof USD.Type

export const Percentage = Schema.Number.pipe(Schema.brand("Percentage"))
export type Percentage = typeof Percentage.Type

export const Weight = Schema.Number.pipe(
  Schema.filter((n) => n >= 0 && n <= 1, {
    message: () => "Weight must be between 0 and 1",
  }),
  Schema.brand("Weight")
)
export type Weight = typeof Weight.Type

export const ISOTimestamp = Schema.String.pipe(Schema.brand("ISOTimestamp"))
export type ISOTimestamp = typeof ISOTimestamp.Type

// ─── Schema-Validated Domain Models ────────────────────────────
// These schemas validate external data (portfolio JSON, API
// responses) at I/O boundaries. Once validated, the branded
// types flow through the pure domain ensuring correctness.

export const TokenHoldingSchema = Schema.Struct({
  symbol: Schema.String,
  coinGeckoId: Schema.String,
  amount: Schema.Number.pipe(
    Schema.filter((n) => n > 0, {
      message: () => "Amount must be positive",
    })
  ),
})

export const PortfolioSchema = Schema.Struct({
  name: Schema.String,
  holdings: Schema.Array(TokenHoldingSchema),
})

export const decodePortfolio = Schema.decodeUnknownSync(PortfolioSchema)

// ─── Runtime Interfaces ────────────────────────────────────────
// Used throughout the application. The branded types above guard
// the boundaries; these interfaces describe the shapes flowing
// through the pure core.

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
