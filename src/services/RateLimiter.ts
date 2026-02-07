// ─── RateLimiter Service ───────────────────────────────────────
// Effect: Functional mutable state (Ref) + Time
//
// Implements a token-bucket rate limiter using Effect's Ref — the
// functional alternative to mutable variables. The Ref holds the
// current token count and last refill timestamp, ensuring all
// state mutations are tracked by the Effect type system.
//
// This solves the real CoinGecko rate-limit problem: the free
// tier allows ~10-30 requests per minute. The rate limiter
// transparently delays requests when the budget is exhausted,
// preventing 429 errors.
//
// Uses Layer.scoped to manage the Ref lifecycle — the rate
// limiter is created when the layer is built and lives for the
// duration of the program.

import { Context, Effect, Layer, Ref, Data } from "effect"

// ─── Typed Error ───────────────────────────────────────────────

export class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly reason: string
}> {}

// ─── Internal State (held in Ref) ──────────────────────────────

interface TokenBucket {
  readonly tokens: number
  readonly lastRefillMs: number
}

// ─── Service Definition ────────────────────────────────────────

export class RateLimiter extends Context.Tag("@app/RateLimiter")<
  RateLimiter,
  {
    readonly acquire: () => Effect.Effect<void>
    readonly status: () => Effect.Effect<{
      readonly availableTokens: number
      readonly maxTokens: number
    }>
  }
>() {}

// ─── Live Implementation (token bucket via Ref) ────────────────

export const makeRateLimiter = (config: {
  readonly maxTokens: number
  readonly refillRatePerSecond: number
}) =>
  Effect.gen(function* () {
    // Create a Ref holding the token bucket state.
    // Ref is Effect's primitive for managed mutable state —
    // all reads and writes are effectful and composable.
    const bucketRef = yield* Ref.make<TokenBucket>({
      tokens: config.maxTokens,
      lastRefillMs: Date.now(),
    })

    const refill = (bucket: TokenBucket): TokenBucket => {
      const now = Date.now()
      const elapsedSeconds = (now - bucket.lastRefillMs) / 1000
      const newTokens = Math.min(
        config.maxTokens,
        bucket.tokens + elapsedSeconds * config.refillRatePerSecond
      )
      return { tokens: newTokens, lastRefillMs: now }
    }

    const acquire = (): Effect.Effect<void> =>
      Effect.gen(function* () {
        // Atomically refill and try to consume a token
        const hasToken = yield* Ref.modify(bucketRef, (bucket) => {
          const refilled = refill(bucket)
          if (refilled.tokens >= 1) {
            return [true, { ...refilled, tokens: refilled.tokens - 1 }] as const
          }
          return [false, refilled] as const
        })

        if (!hasToken) {
          // No tokens available — calculate wait time and delay
          const bucket = yield* Ref.get(bucketRef)
          const waitMs = Math.ceil(
            ((1 - bucket.tokens) / config.refillRatePerSecond) * 1000
          )
          yield* Effect.sleep(`${Math.max(waitMs, 100)} millis`)
          // Retry after waiting
          yield* acquire()
        }
      })

    const status = () =>
      Effect.gen(function* () {
        const bucket = yield* Ref.get(bucketRef)
        const refilled = refill(bucket)
        return {
          availableTokens: Math.floor(refilled.tokens),
          maxTokens: config.maxTokens,
        }
      })

    return { acquire, status } as const
  })

// ─── Layer (scoped lifecycle) ──────────────────────────────────
// The Ref is created once when the layer is built and shared
// across all consumers for the program's lifetime.

export const RateLimiterLive = Layer.effect(
  RateLimiter,
  makeRateLimiter({
    maxTokens: 10,
    refillRatePerSecond: 0.33, // ~20 per minute (CoinGecko free tier)
  })
)

// ─── Test Implementation (no delays) ───────────────────────────

export const RateLimiterTest = Layer.succeed(RateLimiter, {
  acquire: () => Effect.void,
  status: () => Effect.succeed({ availableTokens: 10, maxTokens: 10 }),
})
