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

- 65 automated tests (fold, flags, budget, receipts, HTTP, service, client bundle, replay fixtures, benchmark tooling, smoke).
- Temporary-profile integration: plugin activates, `/health` and `/sessions` respond, client bundle injected, uninstall leaves a 404 route with no residue.
- Real browser (headless Edge + CDP): panel, receipt drawer, Escape close; Chinese light/dark and English light.
- Bench: fold p95 0.003 ms, receipt write p95 ≈1 ms on this machine.

### Added after the first pass

- Contract/replay fixtures (`test/fixtures/*.json`) proving counters match logged events and no body text leaks.
- Offline end-to-end verification (`npm run e2e`): a scripted LLM adapter drives a real DSH headless turn — three failing tool calls, a coach notice, and an enforce denial with `denied=1` in the receipt. No model account or token spend.
- Pre-registered 9-task, 4-group benchmark plan (`docs/benchmark.md`, `bench/`), with a session-log metrics reader, dry-run-by-default runner, and honest report aggregation.
- UI fixes from the browser pass: stored-receipt budget reads `sessionLimit`, shorter cache hint, single privacy row, translated pressure source, compact clock in the turn table, default selection prefers a session with receipts, Escape closes the drawer.
- Narrow-viewport (520px) check: no horizontal page overflow, table scrolls inside its card; Tab reaches the main controls and turn rows.
- `/squeeze` command tests: status, mode, budget, report, flags, mute/unmute, purge guardrails, inactive session.

### Known deviations

See `docs/compat-notes.md` D-1…D-7: no `pressureStats` projection (self-fold), no Host package imports, global guard with agent filter, embedded Client dictionaries, honest `partial` receipts.

### Not included

- npm/GitHub publication, real-browser UI acceptance, 9-task model benchmark.
