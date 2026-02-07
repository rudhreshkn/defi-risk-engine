// ─── Display ───────────────────────────────────────────────────
// Formats analysis results for terminal output.
// Uses ANSI escape codes for colour (no external dependencies).
// This module is pure — it takes data in and returns a string.

import type { AnalysisResult } from "./domain/models.js"

// ─── ANSI Colours ──────────────────────────────────────────────

const B = "\x1b[1m"
const D = "\x1b[2m"
const R = "\x1b[31m"
const G = "\x1b[32m"
const Y = "\x1b[33m"
const C = "\x1b[36m"
const X = "\x1b[0m"

// ─── Formatting Helpers ────────────────────────────────────────

const fmtUsd = (n: number): string =>
  "$" + n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const fmtPct = (n: number): string => (n * 100).toFixed(2) + "%"

const colourChange = (pct: number): string =>
  pct >= 0 ? `${G}+${pct.toFixed(2)}%${X}` : `${R}${pct.toFixed(2)}%${X}`

const riskColour = (level: "ok" | "warn" | "critical"): string =>
  level === "critical" ? R : level === "warn" ? Y : G

// ─── Main Render Function ──────────────────────────────────────

export function renderAnalysis(result: AnalysisResult): string {
  const { valuation, risk } = result
  const lines: string[] = []
  const W = 62

  lines.push("")
  lines.push(`${B}${"═".repeat(W)}${X}`)
  lines.push(`${B}  DeFi Risk Engine — Portfolio Analysis${X}`)
  lines.push(`${D}  ${new Date(result.timestamp).toLocaleString()}${X}`)
  lines.push(`${B}${"═".repeat(W)}${X}`)

  // Portfolio value
  lines.push("")
  lines.push(`  ${B}PORTFOLIO VALUE${X}              ${C}${fmtUsd(valuation.totalValueUsd)}${X}`)

  // Risk metrics
  lines.push("")
  lines.push(`  ${B}RISK METRICS${X}`)
  lines.push(`  ${D}${"─".repeat(W - 2)}${X}`)

  const varPct = valuation.totalValueUsd > 0 ? risk.valueAtRisk95 / valuation.totalValueUsd : 0
  const varLvl = varPct > 0.05 ? "critical" : varPct > 0.03 ? "warn" : "ok"
  const volLvl = risk.volatilityAnnualised > 0.8 ? "critical" : risk.volatilityAnnualised > 0.6 ? "warn" : "ok"
  const hhiLvl = risk.concentrationHHI > 0.5 ? "critical" : risk.concentrationHHI > 0.35 ? "warn" : "ok"
  const ddLvl = risk.maxDrawdown > 0.15 ? "critical" : risk.maxDrawdown > 0.08 ? "warn" : "ok"

  lines.push(`  VaR 95% (1-day):       ${riskColour(varLvl)}${fmtUsd(risk.valueAtRisk95)}  (${fmtPct(varPct)})${X}`)
  lines.push(`  VaR 99% (1-day):       ${fmtUsd(risk.valueAtRisk99)}`)
  lines.push(`  Volatility (ann.):     ${riskColour(volLvl)}${fmtPct(risk.volatilityAnnualised)}${X}`)
  lines.push(`  Sharpe Ratio:          ${risk.sharpeRatio >= 0 ? G : R}${risk.sharpeRatio.toFixed(3)}${X}`)
  lines.push(`  Concentration (HHI):   ${riskColour(hhiLvl)}${risk.concentrationHHI.toFixed(3)}${X}`)
  lines.push(`  Max Drawdown (30d):    ${riskColour(ddLvl)}${fmtPct(risk.maxDrawdown)}${X}`)

  // Holdings table
  lines.push("")
  lines.push(`  ${B}HOLDINGS${X}`)
  lines.push(`  ${D}${"─".repeat(W - 2)}${X}`)

  // Header
  const hdr =
    `  ${D}` +
    "Token".padEnd(7) +
    "Amount".padStart(11) +
    "Price".padStart(13) +
    "Value".padStart(13) +
    "Weight".padStart(8) +
    "  24h".padStart(10) +
    X

  lines.push(hdr)

  // Rows
  for (const h of valuation.holdings) {
    const change = h.change24h >= 0
      ? `${G}+${h.change24h.toFixed(2)}%${X}`
      : `${R}${h.change24h.toFixed(2)}%${X}`

    const row =
      "  " +
      h.symbol.padEnd(7) +
      h.amount.toFixed(4).padStart(11) +
      fmtUsd(h.price).padStart(13) +
      fmtUsd(h.valueUsd).padStart(13) +
      fmtPct(h.weight).padStart(8) +
      "  " +
      change

    lines.push(row)
  }

  lines.push("")
  lines.push(`${B}${"═".repeat(W)}${X}`)
  lines.push("")

  return lines.join("\n")
}
