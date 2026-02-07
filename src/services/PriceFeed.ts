// ─── PriceFeed Service ─────────────────────────────────────────
// Effect: Network I/O (HTTP calls to CoinGecko API)
// This service encapsulates all external price data fetching.

import { Context, Effect, Layer, Data } from "effect"
import type { TokenPrice, HistoricalPrices } from "../domain/models.js"

// ─── Typed Error ───────────────────────────────────────────────

export class PriceFeedError extends Data.TaggedError("PriceFeedError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

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

export const PriceFeedLive = Layer.succeed(PriceFeed, {
  getCurrentPrices: (coinIds) =>
    Effect.tryPromise({
      try: async () => {
        const ids = coinIds.join(",")
        const url = `${COINGECKO_BASE}/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`
        const res = await fetch(url, { headers: HEADERS })
        if (!res.ok) throw new Error(`CoinGecko responded with ${res.status}`)
        const data = await res.json() as Record<string, { usd?: number; usd_24h_change?: number }>

        return coinIds.map((id) => ({
          coinGeckoId: id,
          priceUsd: data[id]?.usd ?? 0,
          change24h: data[id]?.usd_24h_change ?? 0,
        }))
      },
      catch: (error) =>
        new PriceFeedError({ reason: "Failed to fetch current prices", cause: error }),
    }),

  getHistoricalPrices: (coinId, days) =>
    Effect.tryPromise({
      try: async () => {
        const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`
        const res = await fetch(url, { headers: HEADERS })
        if (!res.ok) throw new Error(`CoinGecko responded with ${res.status}`)
        const data = await res.json() as { prices: [number, number][] }

        return {
          coinGeckoId: coinId,
          dailyPrices: data.prices.map(([, price]) => price),
        }
      },
      catch: (error) =>
        new PriceFeedError({
          reason: `Failed to fetch historical prices for ${coinId}`,
          cause: error,
        }),
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
