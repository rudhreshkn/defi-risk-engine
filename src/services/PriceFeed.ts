// ─── PriceFeed Service ─────────────────────────────────────────
// Effect: Network I/O (HTTP calls to price APIs)
//
// Multi-source architecture with automatic failover:
//   Primary:   CoinGecko API (richer data, 24h change)
//   Fallback:  CoinCap API (simpler, different rate limits)
//
// Uses Effect.orElse for composable failover — if the primary
// source fails, the fallback is tried transparently. Both sources
// validate responses with Effect Schema at the I/O boundary.

import { Context, Effect, Layer, Data, Schema } from "effect"
import type { TokenPrice, HistoricalPrices } from "../domain/models.js"

// ─── Typed Error ───────────────────────────────────────────────

export class PriceFeedError extends Data.TaggedError("PriceFeedError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

// ─── CoinGecko ID → CoinCap ID Mapping ────────────────────────
// CoinCap uses slightly different identifiers for some tokens.

const COINCAP_ID_MAP: Record<string, string> = {
  "bitcoin": "bitcoin",
  "ethereum": "ethereum",
  "solana": "solana",
  "avalanche-2": "avalanche",
  "chainlink": "chainlink",
  "cardano": "cardano",
  "polkadot": "polkadot",
  "polygon-ecosystem-token": "polygon",
  "uniswap": "uniswap",
  "aave": "aave",
}

const toCoinCapId = (coinGeckoId: string): string =>
  COINCAP_ID_MAP[coinGeckoId] ?? coinGeckoId

// ─── Response Schemas ──────────────────────────────────────────
// Runtime validation of API responses using Effect Schema.

// CoinGecko schemas
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

// CoinCap schemas
const CoinCapAsset = Schema.Struct({
  id: Schema.String,
  priceUsd: Schema.String,
  changePercent24Hr: Schema.optional(Schema.NullOr(Schema.String)),
})

const CoinCapCurrentResponse = Schema.Struct({
  data: Schema.Array(CoinCapAsset),
})

const CoinCapHistoryEntry = Schema.Struct({
  priceUsd: Schema.String,
  time: Schema.Number,
})

const CoinCapHistoryResponse = Schema.Struct({
  data: Schema.Array(CoinCapHistoryEntry),
})

// ─── Schema Decoders ───────────────────────────────────────────

const decodeCoinGeckoCurrent = Schema.decodeUnknown(CurrentPriceResponse)
const decodeCoinGeckoHistorical = Schema.decodeUnknown(HistoricalPriceResponse)
const decodeCoinCapCurrent = Schema.decodeUnknown(CoinCapCurrentResponse)
const decodeCoinCapHistory = Schema.decodeUnknown(CoinCapHistoryResponse)

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

// ─── CoinGecko Implementation ──────────────────────────────────

const COINGECKO_BASE = "https://api.coingecko.com/api/v3"
const HEADERS = { "Accept": "application/json", "User-Agent": "defi-risk-engine/1.0" }

const coinGeckoGetPrices = (coinIds: readonly string[]) =>
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
        new PriceFeedError({ reason: "[CoinGecko] Failed to fetch current prices", cause: error }),
    })

    const data = yield* decodeCoinGeckoCurrent(raw).pipe(
      Effect.mapError((e) =>
        new PriceFeedError({ reason: "[CoinGecko] Invalid response format", cause: e })
      )
    )

    return coinIds.map((id) => ({
      coinGeckoId: id,
      priceUsd: data[id]?.usd ?? 0,
      change24h: data[id]?.usd_24h_change ?? 0,
    }))
  })

const coinGeckoGetHistorical = (coinId: string, days: number) =>
  Effect.gen(function* () {
    const url = `${COINGECKO_BASE}/coins/${coinId}/market_chart?vs_currency=usd&days=${days}&interval=daily`

    const raw = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(url, { headers: HEADERS })
        if (!res.ok) throw new Error(`CoinGecko responded with ${res.status}`)
        return await res.json()
      },
      catch: (error) =>
        new PriceFeedError({ reason: `[CoinGecko] Failed historical for ${coinId}`, cause: error }),
    })

    const data = yield* decodeCoinGeckoHistorical(raw).pipe(
      Effect.mapError((e) =>
        new PriceFeedError({ reason: `[CoinGecko] Invalid historical format: ${coinId}`, cause: e })
      )
    )

    return {
      coinGeckoId: coinId,
      dailyPrices: data.prices.map(([, price]) => price),
    }
  })

// ─── CoinCap Implementation (Fallback) ────────────────────────

const COINCAP_BASE = "https://api.coincap.io/v2"

const coinCapGetPrices = (coinIds: readonly string[]) =>
  Effect.gen(function* () {
    const capIds = coinIds.map(toCoinCapId).join(",")
    const url = `${COINCAP_BASE}/assets?ids=${capIds}`

    const raw = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(url, { headers: HEADERS })
        if (!res.ok) throw new Error(`CoinCap responded with ${res.status}`)
        return await res.json()
      },
      catch: (error) =>
        new PriceFeedError({ reason: "[CoinCap] Failed to fetch current prices", cause: error }),
    })

    const data = yield* decodeCoinCapCurrent(raw).pipe(
      Effect.mapError((e) =>
        new PriceFeedError({ reason: "[CoinCap] Invalid response format", cause: e })
      )
    )

    // Map CoinCap IDs back to CoinGecko IDs
    const priceMap = new Map(
      data.data.map((a) => [a.id, {
        priceUsd: parseFloat(a.priceUsd) || 0,
        change24h: a.changePercent24Hr ? parseFloat(a.changePercent24Hr) || 0 : 0,
      }])
    )

    return coinIds.map((id) => {
      const capId = toCoinCapId(id)
      const entry = priceMap.get(capId)
      return {
        coinGeckoId: id,
        priceUsd: entry?.priceUsd ?? 0,
        change24h: entry?.change24h ?? 0,
      }
    })
  })

const coinCapGetHistorical = (coinId: string, days: number) =>
  Effect.gen(function* () {
    const capId = toCoinCapId(coinId)
    const end = Date.now()
    const start = end - days * 24 * 60 * 60 * 1000
    const url = `${COINCAP_BASE}/assets/${capId}/history?interval=d1&start=${start}&end=${end}`

    const raw = yield* Effect.tryPromise({
      try: async () => {
        const res = await fetch(url, { headers: HEADERS })
        if (!res.ok) throw new Error(`CoinCap responded with ${res.status}`)
        return await res.json()
      },
      catch: (error) =>
        new PriceFeedError({ reason: `[CoinCap] Failed historical for ${coinId}`, cause: error }),
    })

    const data = yield* decodeCoinCapHistory(raw).pipe(
      Effect.mapError((e) =>
        new PriceFeedError({ reason: `[CoinCap] Invalid historical format: ${coinId}`, cause: e })
      )
    )

    return {
      coinGeckoId: coinId,
      dailyPrices: data.data.map((d) => parseFloat(d.priceUsd) || 0),
    }
  })

// ─── Live Implementation (CoinGecko → CoinCap failover) ───────
// Uses Effect.orElse for composable, automatic failover:
// if the primary source fails for any reason (rate limit, outage,
// malformed response), the fallback source is tried transparently.

export const PriceFeedLive = Layer.succeed(PriceFeed, {
  getCurrentPrices: (coinIds) =>
    coinGeckoGetPrices(coinIds).pipe(
      Effect.orElse(() => coinCapGetPrices(coinIds))
    ),

  getHistoricalPrices: (coinId, days) =>
    coinGeckoGetHistorical(coinId, days).pipe(
      Effect.orElse(() => coinCapGetHistorical(coinId, days))
    ),
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
