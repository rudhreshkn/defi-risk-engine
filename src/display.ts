// ─── Display ───────────────────────────────────────────────────
// Formats analysis results for terminal output.
// Uses ANSI escape codes for colour (no external dependencies).
// This module is pure — it takes data in and returns a string.
// Optionally accepts a previous result to show trend deltas.

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

const delta = (current: number, previous: number): string => {
  const diff = current - previous
  const sign = diff >= 0 ? "+" : ""
  const colour = diff >= 0 ? G : R
  return `${colour}${sign}${diff.toFixed(2)}${X}`
}

const deltaPct = (current: number, previous: number): string => {
  const diff = (current - previous) * 100
  const sign = diff >= 0 ? "+" : ""
  const colour = diff >= 0 ? G : R
  return `${colour}${sign}${diff.toFixed(2)}pp${X}`
}

// ─── Main Render Function ──────────────────────────────────────

export function renderAnalysis(
  result: AnalysisResult,
  previous?: AnalysisResult | null
): string {
  const { valuation, risk } = result
  const prev = previous ?? null
  const lines: string[] = []
  const W = 62

  lines.push("")
  lines.push(`${B}${"═".repeat(W)}${X}`)
  lines.push(`${B}  DeFi Risk Engine — Portfolio Analysis${X}`)
  lines.push(`${D}  ${new Date(result.timestamp).toLocaleString()}${X}`)
  lines.push(`${B}${"═".repeat(W)}${X}`)

  // Portfolio value with delta
  const valueDelta = prev
    ? `  ${delta(valuation.totalValueUsd, prev.valuation.totalValueUsd)}`
    : ""
  lines.push("")
  lines.push(
    `  ${B}PORTFOLIO VALUE${X}              ${C}${fmtUsd(valuation.totalValueUsd)}${X}${valueDelta}`
  )

  // Risk metrics with deltas
  lines.push("")
  lines.push(`  ${B}RISK METRICS${X}${prev ? `  ${D}(vs previous)${X}` : ""}`)
  lines.push(`  ${D}${"─".repeat(W - 2)}${X}`)

  const varPct = valuation.totalValueUsd > 0 ? risk.valueAtRisk95 / valuation.totalValueUsd : 0
  const varLvl = varPct > 0.05 ? "critical" : varPct > 0.03 ? "warn" : "ok"
  const volLvl = risk.volatilityAnnualised > 0.8 ? "critical" : risk.volatilityAnnualised > 0.6 ? "warn" : "ok"
  const hhiLvl = risk.concentrationHHI > 0.5 ? "critical" : risk.concentrationHHI > 0.35 ? "warn" : "ok"
  const ddLvl = risk.maxDrawdown > 0.15 ? "critical" : risk.maxDrawdown > 0.08 ? "warn" : "ok"

  const varDelta = prev ? `  ${delta(risk.valueAtRisk95, prev.risk.valueAtRisk95)}` : ""
  const volDelta = prev ? `  ${deltaPct(risk.volatilityAnnualised, prev.risk.volatilityAnnualised)}` : ""
  const sharpeDelta = prev ? `  ${delta(risk.sharpeRatio, prev.risk.sharpeRatio)}` : ""
  const hhiDelta = prev ? `  ${delta(risk.concentrationHHI, prev.risk.concentrationHHI)}` : ""
  const ddDelta = prev ? `  ${deltaPct(risk.maxDrawdown, prev.risk.maxDrawdown)}` : ""

  lines.push(`  VaR 95% (1-day):       ${riskColour(varLvl)}${fmtUsd(risk.valueAtRisk95)}  (${fmtPct(varPct)})${X}${varDelta}`)
  lines.push(`  VaR 99% (1-day):       ${fmtUsd(risk.valueAtRisk99)}`)
  lines.push(`  Volatility (ann.):     ${riskColour(volLvl)}${fmtPct(risk.volatilityAnnualised)}${X}${volDelta}`)
  lines.push(`  Sharpe Ratio:          ${risk.sharpeRatio >= 0 ? G : R}${risk.sharpeRatio.toFixed(3)}${X}${sharpeDelta}`)
  lines.push(`  Concentration (HHI):   ${riskColour(hhiLvl)}${risk.concentrationHHI.toFixed(3)}${X}${hhiDelta}`)
  lines.push(`  Max Drawdown (30d):    ${riskColour(ddLvl)}${fmtPct(risk.maxDrawdown)}${X}${ddDelta}`)

  if (prev) {
    lines.push("")
    const elapsed = new Date(result.timestamp).getTime() - new Date(prev.timestamp).getTime()
    const mins = Math.round(elapsed / 60000)
    const timeLabel = mins < 60 ? `${mins}m ago` : `${(mins / 60).toFixed(1)}h ago`
    lines.push(`  ${D}Compared to: ${new Date(prev.timestamp).toLocaleString()} (${timeLabel})${X}`)
  }

  // Holdings table
  lines.push("")
  lines.push(`  ${B}HOLDINGS${X}`)
  lines.push(`  ${D}${"─".repeat(W - 2)}${X}`)

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
