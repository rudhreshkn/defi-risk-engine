// ─── Logger Service ────────────────────────────────────────────
// Effect: Console I/O (structured, timestamped logging)
// This service encapsulates all log output.

import { Context, Effect, Layer } from "effect"

// ─── Service Definition ────────────────────────────────────────

export class Logger extends Context.Tag("@app/Logger")<
  Logger,
  {
    readonly info: (
      message: string,
      data?: Record<string, unknown>
    ) => Effect.Effect<void>
    readonly warn: (
      message: string,
      data?: Record<string, unknown>
    ) => Effect.Effect<void>
    readonly error: (
      message: string,
      data?: Record<string, unknown>
    ) => Effect.Effect<void>
    readonly debug: (
      message: string,
      data?: Record<string, unknown>
    ) => Effect.Effect<void>
  }
>() {}

// ─── Formatting Helper ─────────────────────────────────────────

const formatLog = (
  level: string,
  message: string,
  data?: Record<string, unknown>
): string => {
  const ts = new Date().toISOString()
  const extra = data ? `  ${JSON.stringify(data)}` : ""
  return `[${ts}] ${level.padEnd(5)} ${message}${extra}`
}

// ─── Live Implementation (console) ─────────────────────────────

export const LoggerLive = Layer.succeed(Logger, {
  info: (msg, data) =>
    Effect.sync(() => console.log(formatLog("INFO", msg, data))),
  warn: (msg, data) =>
    Effect.sync(() => console.warn(formatLog("WARN", msg, data))),
  error: (msg, data) =>
    Effect.sync(() => console.error(formatLog("ERROR", msg, data))),
  debug: (msg, data) =>
    Effect.sync(() => console.log(formatLog("DEBUG", msg, data))),
})

// ─── Silent Implementation (for tests) ─────────────────────────

export const LoggerSilent = Layer.succeed(Logger, {
  info: () => Effect.void,
  warn: () => Effect.void,
  error: () => Effect.void,
  debug: () => Effect.void,
})
