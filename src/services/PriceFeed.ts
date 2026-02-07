// ─── PriceFeed Service ─────────────────────────────────────────
// Effect: Network I/O (HTTP calls to CoinGecko API)
// This service encapsulates all external price data fetching.
// API responses are validated at runtime using Effect Schema,
// ensuring no malformed data leaks into the pure domain.

import { Context, Effect, Layer, Data, Schema } from "effect"
import type { TokenPrice, HistoricalPrices } from "../domain/models.js"

// ─── Typed Error ───────────────────────────────────────────────

export class PriceFeedError extends Data.TaggedError("PriceFeedError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

// ─── Response Schemas ──────────────────────────────────────────
// Runtime validation of CoinGecko API responses. These schemas
// ensure that malformed or unexpected responses are caught at
// the I/O boundary rather than causing failures in pure code.

const CoinPriceEntry = Schema.Struct({
  usd: Schema.optional(Schema.Number),
  usd_24h_change: Schema.optional(Schema.Number),
})

const CurrentPriceResponse = Schema.Record({
  key: Schema.String,
  value: CoinPriceEntry,
})

const HistoricalPriceResponse = Schema.Struct({
  prices: Schema.Array(Schema.Tuple(Schema.Number, Schema.Number)),
})

// ─── Service Definition ────────────────────────────────────────

export class PriceFeed extends Context.Tag("@app/PriceFeed")<
  PriceFeed,
  {
    readonly getCurrentPrices: (
      coinIds: readonly string[]
    ) => Effect.Effect<TokenPrice[], PriceFeedError>
    readonly getHistoricalPrices: (
      coinId: string,
      days: number
    ) => Effect.Effect<HistoricalPrices, PriceFeedError>
  }
>() {}

// ─── Live Implementation (CoinGecko) ──────────────────────────

const COINGECKO_BASE = "https://api.coingecko.com/api/v3"
const HEADERS = { "Accept": "application/json", "User-Agent": "defi-risk-engine/1.0" }

const decodeCurrentPrices = Schema.decodeUnknown(CurrentPriceResponse)
const decodeHistoricalPrices = Schema.decodeUnknown(HistoricalPriceResponse)

export const PriceFeedLive = Layer.succeed(PriceFeed, {
  getCurrentPrices: (coinIds) =>
    Effect.gen(function* () {
      const ids = coinIds.join(",")
      const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`

      const raw = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetch(url, { headers: HEADERS })
          if (!res.ok) throw new Error(`CoinGecko responded with ${res.status}`)
          return await res.json()
        },
        catch: (error) =>
          new PriceFeedError({ reason: "Failed to fetch current prices", cause: error }),
      })

      // Validate response structure with Schema
      const data = yield* decodeCurrentPrices(raw).pipe(
        Effect.mapError((parseError) =>
          new PriceFeedError({
            reason: "Invalid response format from CoinGecko (current prices)",
            cause: parseError,
          })
        )
      )

      return coinIds.map((id) => ({
        coinGeckoId: id,
        priceUsd: data[id]?.usd ?? 0,
        change24h: data[id]?.usd_24h_change ?? 0,
      }))
    }),

  getHistoricalPrices: (coinId, days) =>
    Effect.gen(function* () {
      const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`

      const raw = yield* Effect.tryPromise({
        try: async () => {
          const res = await fetch(url, { headers: HEADERS })
          if (!res.ok) throw new Error(`CoinGecko responded with ${res.status}`)
          return await res.json()
        },
        catch: (error) =>
          new PriceFeedError({
            reason: `Failed to fetch historical prices for ${coinId}`,
            cause: error,
          }),
      })

      // Validate response structure with Schema
      const data = yield* decodeHistoricalPrices(raw).pipe(
        Effect.mapError((parseError) =>
          new PriceFeedError({
            reason: `Invalid response format from CoinGecko (historical: ${coinId})`,
            cause: parseError,
          })
        )
      )

      return {
        coinGeckoId: coinId,
        dailyPrices: data.prices.map(([, price]) => price),
      }
    }),
})

// ─── Test Implementation (deterministic, no network) ──────────

export const PriceFeedTest = Layer.succeed(PriceFeed, {
  getCurrentPrices: (coinIds) =>
    Effect.succeed(
      coinIds.map((id, i) => ({
        coinGeckoId: id,
        priceUsd: [42000, 2200, 145, 28, 15][i] ?? 100,
        change24h: [-2.5, 1.3, -0.8, 3.1, -1.2][i] ?? 0,
      }))
    ),
  getHistoricalPrices: (coinId) =>
    Effect.succeed({
      coinGeckoId: coinId,
      dailyPrices: Array.from({ length: 31 }, (_, i) => {
        const base = coinId === "bitcoin" ? 40000 : coinId === "ethereum" ? 2000 : 100
        return base + Math.sin(i * 0.5) * base * 0.05
      }),
    }),
})
