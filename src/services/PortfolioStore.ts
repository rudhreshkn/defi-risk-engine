// ─── PortfolioStore Service ─────────────────────────────────────
// Effect: File I/O (reading portfolio config, persisting history)
// This service encapsulates all filesystem interactions.

import { Context, Effect, Layer, Data } from "effect"
import type { Portfolio, AnalysisResult } from "../domain/models.js"
import * as fs from "node:fs"

// ─── Typed Error ───────────────────────────────────────────────

export class StoreError extends Data.TaggedError("StoreError")<{
  readonly reason: string
  readonly cause?: unknown
}> {}

// ─── Service Definition ────────────────────────────────────────

export class PortfolioStore extends Context.Tag("@app/PortfolioStore")<
  PortfolioStore,
  {
    readonly loadPortfolio: (
      path: string
    ) => Effect.Effect<Portfolio, StoreError>
    readonly saveResult: (
      path: string,
      result: AnalysisResult
    ) => Effect.Effect<void, StoreError>
    readonly loadHistory: (
      path: string
    ) => Effect.Effect<AnalysisResult[], StoreError>
  }
>() {}

// ─── Live Implementation (filesystem) ──────────────────────────

export const PortfolioStoreLive = Layer.succeed(PortfolioStore, {
  loadPortfolio: (path) =>
    Effect.try({
      try: () => {
        const content = fs.readFileSync(path, "utf-8")
        return JSON.parse(content) as Portfolio
      },
      catch: (error) =>
        new StoreError({ reason: `Failed to load portfolio from ${path}`, cause: error }),
    }),

  saveResult: (path, result) =>
    Effect.try({
      try: () => {
        let history: AnalysisResult[] = []
        try {
          const existing = fs.readFileSync(path, "utf-8")
          history = JSON.parse(existing)
        } catch {
          // File doesn't exist yet — start fresh
        }
        history.push(result)
        if (history.length > 100) history = history.slice(-100)
        fs.writeFileSync(path, JSON.stringify(history, null, 2))
      },
      catch: (error) =>
        new StoreError({ reason: `Failed to save result to ${path}`, cause: error }),
    }),

  loadHistory: (path) =>
    Effect.try({
      try: () => {
        try {
          const content = fs.readFileSync(path, "utf-8")
          return JSON.parse(content) as AnalysisResult[]
        } catch {
          return []
        }
      },
      catch: (error) =>
        new StoreError({ reason: `Failed to load history from ${path}`, cause: error }),
    }),
})

// ─── Test Implementation (in-memory) ───────────────────────────

export const PortfolioStoreTest = Layer.succeed(PortfolioStore, {
  loadPortfolio: () =>
    Effect.succeed({
      name: "Test Portfolio",
      holdings: [
        { symbol: "BTC", coinGeckoId: "bitcoin", amount: 1.0 },
        { symbol: "ETH", coinGeckoId: "ethereum", amount: 10.0 },
      ],
    }),
  saveResult: () => Effect.void,
  loadHistory: () => Effect.succeed([]),
})
