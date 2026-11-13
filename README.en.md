# DSH Pressure

> A pressure gauge for DeepSeek Harness agent loops: see the waste first, then decide whether to brake.

**Status: v0.1.0, installed in the desktop profile.** The Host half passes 66 tests; a real DSH turn is verified with an offline scripted provider; a 108-run real-model budget smoke cost about ¥0.59 (105/108 passed) and found **no evidence for coach benefit while enforce hurt tool-heavy tasks**, so observe stays the default. The Web panel is verified in a real browser (Chinese light/dark, English, 520px). Not published to npm yet.

## What it is

A loop-governance plugin that closes four steps per turn:

1. **Gauge** — tokens, cache, context pressure, tool failures, and wall time.
2. **Diagnosis** — evidenced waste signals with stable codes and a next step.
3. **Valve** — `observe` / `coach` / `enforce`; observation is the default.
4. **Receipt** — one body-free, exportable receipt per turn.

It registers **no model tools**, calls **no model**, and stores **no prompt, tool arguments, or tool results**. Idle cost is a host-only fold over committed events; the model sees only a short coach notice or a guard denial when those are enabled.

## Install

Not on npm yet. From a local checkout:

```bash
dsh plugin add /absolute/path/to/dsh-pressure
```

Confirm afterwards: the **Pressure** icon appears in the sidebar, `/squeeze status` works, and the first receipt appears after one turn. Use a temporary profile and a separate `DSH_HOME` when trying it.

## See it without a model

```bash
npm run demo
```

Builds a two-turn synthetic session (healthy, then failures + a bloated result + compaction), writes two receipts, and prints Markdown plus JSON/CSV file counts under `.tmp/demo/`.

## Commands

`/squeeze status`, `report [turn]`, `mode observe|coach|enforce`, `budget session|turn <tokens>`, `budget tools <n>`, `flags`, `mute <code>`, `unmute <code>`, `purge --yes`. Commands never enter the model context.

## Configuration

| Field | Default | Notes |
|---|---|---|
| `mode` | `observe` | `observe` / `coach` / `enforce` |
| `locale` | `auto` | `auto` / `zh` / `en` for Host text |
| `budget.sessionTokens` / `turnTokens` | `0` | 0 = unlimited |
| `budget.turnToolCalls` | `0` | 0 = unlimited |
| `thresholds.contextPressure` / `budgetPressure` | `0.8` | 0.5–0.99 |
| `thresholds.failureStreak` | `2` | 1–50 |
| `thresholds.bloatedResultTokens` | `8000` | estimate, never billing |
| `thresholds.compactionChurn` | `2` | 1–20 |
| `coach.maxPerTurn` | `3` | 1–10 |
| `storage.retentionDays` | `30` | receipts only |
| `storage.maxReceiptsPerSession` | `2000` | |
| `storage.maxTotalBytes` | `52428800` | 50 MB |
| `storage.dataDir` | `null` | defaults to `$DSH_HOME/squeeze` |
| `http.enabled` | `true` | same-origin read-only API |

Invalid config fails at load with the field and legal range. Example patch: [`examples/profile-patch.yml`](./examples/profile-patch.yml).

## Data and privacy

Receipts live in `$DSH_HOME/squeeze/` (`receipts/*.jsonl`, `exports/`, `logs/actions.jsonl`). They contain numbers, stable codes, and advice keys only; tool arguments are hashed for repeat detection and never stored. No network egress; the only HTTP surface is a same-origin read-only API on the Host's existing web server. POSIX permissions are `0700`/`0600`; Windows is best-effort and not claimed.

Token figures are runtime volume, not billed amounts. Cache hit rate is `cacheRead / (cacheRead + input + cacheWrite)`, and `null` when the denominator is unknown.

## Compatibility

DeepSeek Harness `>=0.2.2-rc.3 <0.3.0`, Node ≥ 22, zero runtime dependencies. `tools` is the only hard dependency; token meter, projections, session stats, commands, and the web server degrade to "unavailable" when absent.

## Known limits

- `enforce` is a **tool brake**, not a zero-overspend guarantee: usage is known only after a response, so the final answer is still billed.
- The panel is root-scoped and cannot bind the current conversation; it defaults to the most recently active session and offers a selector.
- A plugin loaded mid-turn marks that receipt `partial` and never invents history.
- The real DSH pipeline is verified with an offline scripted provider; real-model quality and savings still need the pre-registered benchmark.
- Real-browser rendering of the panel and receipt drawer is verified; a 520px viewport has no horizontal page overflow; Tab reaches the main controls and turn rows, but the drawer has no focus trap.

## Development

`npm test` (66 tests), `npm run lint` (syntax + zero-dependency/zero-network policy), `npm run demo`, `npm run bench` (micro), `npm run e2e` (real offline DSH turn with a scripted provider), and the pre-registered `npm run bench:plan` / `bench:run` / `bench:report` harness.

MIT. Not an official DeepSeek project; no affiliation or endorsement.
