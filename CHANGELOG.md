# Changelog

## 0.1.0 — 2026-11-13

First implementation of the v0.1 design.

### Host

- Event fold over committed Session events (`turn`, `step`, `tool/*`, `compaction/end`), bounded tables.
- Per-turn receipts with official `tokenUsage` deltas, context pressure sampling, tool/compaction counters, signals, advice key.
- Append-only JSONL receipt store: idempotent `(sessionId, turn)`, sharding, retention (age/count/bytes), audit log, Markdown/JSON/CSV export.
- Read-only same-origin HTTP API: `health`, `sessions`, `live` (with or without session id), `receipts`, `receipt`, `export`.
- Signals: `failure_streak`, `context_pressure`, `budget_pressure`, `bloated_result`, `compaction_churn`, `repeat_calls`, `budget_exhausted`.
- `coach` notices via `tools/post-execute` `additionalContexts`, rate limited and mutable.
- `enforce` tool brake via `tools.guard`, with over-budget recorded honestly.
- `/squeeze` command family with runtime mode/budget changes and explicit purge.
- Fail-loud config validation; zh/en Host text; zero runtime dependencies; no model calls or model tools.

### Client

- `sidebar.panellist` entry and `main` panel with KPI cards, pressure bars, signals, turn table, receipt drawer, export links, About section, empty/loading/error states, 3s polling paused when hidden, theme-token styling, zh/en dictionaries.

### Verification

- 48 automated tests (fold, flags, budget, receipts, HTTP, service, client bundle, smoke).
- Temporary-profile integration: plugin activates, `/health` and `/sessions` respond, client bundle injected, uninstall leaves a 404 route with no residue.
- Bench: fold p95 0.003 ms, receipt write p95 ≈1 ms on this machine.

### Known deviations

See `docs/compat-notes.md` D-1…D-7: no `pressureStats` projection (self-fold), no Host package imports, global guard with agent filter, embedded Client dictionaries, honest `partial` receipts.

### Not included

- npm/GitHub publication, real-browser UI acceptance, 9-task model benchmark.
