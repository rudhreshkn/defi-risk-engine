// ─── Clock Service ─────────────────────────────────────────────
// Effect: Time observation
// Wraps the impure act of reading the current time into an
// explicit effect. This makes time deterministic in tests and
// removes hidden impurity from the pure domain boundary.

import { Context, Effect, Layer } from "effect"

// ─── Service Definition ────────────────────────────────────────

export class Clock extends Context.Tag("@app/Clock")<
  Clock,
  {
    readonly now: () => Effect.Effect<Date>
    readonly nowIso: () => Effect.Effect<string>
  }
>() {}

// ─── Live Implementation (system clock) ────────────────────────

export const ClockLive = Layer.succeed(Clock, {
  now: () => Effect.sync(() => new Date()),
  nowIso: () => Effect.sync(() => new Date().toISOString()),
})

// ─── Test Implementation (fixed time, deterministic) ───────────

export const makeClockTest = (fixedDate: Date) =>
  Layer.succeed(Clock, {
    now: () => Effect.succeed(fixedDate),
    nowIso: () => Effect.succeed(fixedDate.toISOString()),
  })

export const ClockTest = makeClockTest(new Date("2026-01-15T12:00:00.000Z"))
