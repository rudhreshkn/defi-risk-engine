// ─── AlertNotifier Service ─────────────────────────────────────
// Effect: Console I/O (risk alert notifications)
// This service encapsulates the notification side effect.

import { Context, Effect, Layer } from "effect"
import type { RiskAlert } from "../domain/models.js"

// ─── Service Definition ────────────────────────────────────────

export class AlertNotifier extends Context.Tag("@app/AlertNotifier")<
  AlertNotifier,
  {
    readonly notify: (
      alerts: readonly RiskAlert[]
    ) => Effect.Effect<void>
  }
>() {}

// ─── Formatting Helpers ────────────────────────────────────────

const ICONS: Record<string, string> = {
  critical: "\x1b[31m●\x1b[0m",  // Red
  warning:  "\x1b[33m●\x1b[0m",  // Yellow
  info:     "\x1b[36m●\x1b[0m",  // Cyan
}

const LEVEL_COLOUR: Record<string, string> = {
  critical: "\x1b[31m",  // Red
  warning:  "\x1b[33m",  // Yellow
  info:     "\x1b[36m",  // Cyan
}

const RESET = "\x1b[0m"

// ─── Live Implementation (console) ─────────────────────────────

export const AlertNotifierLive = Layer.succeed(AlertNotifier, {
  notify: (alerts) =>
    Effect.sync(() => {
      if (alerts.length === 0) {
        console.log(`\n  \x1b[32m✓\x1b[0m No risk alerts\n`)
        return
      }

      console.log(`\n  ALERTS (${alerts.length})`)
      console.log(`  ${"─".repeat(54)}`)
      for (const alert of alerts) {
        const icon = ICONS[alert.level] ?? "●"
        const colour = LEVEL_COLOUR[alert.level] ?? ""
        console.log(
          `  ${icon} ${colour}[${alert.level.toUpperCase()}]${RESET} ${alert.metric}: ${alert.message}`
        )
      }
      console.log()
    }),
})

// ─── Silent Implementation (for tests) ─────────────────────────

export const AlertNotifierSilent = Layer.succeed(AlertNotifier, {
  notify: () => Effect.void,
})
