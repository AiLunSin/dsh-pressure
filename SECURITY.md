# Security policy

## Supported versions

`0.1.x` on DeepSeek Harness `>=0.2.2-rc.3 <0.3.0`. Older Host versions are not supported.

## Reporting

Please report vulnerabilities through the repository's private security advisory or by contacting the maintainers privately. Do not include real session logs, API keys, or personal paths in a public issue. Include the plugin version, DSH version, platform, and reproduction steps with synthetic data only.

## Data handling

- Receipts contain numbers, stable signal codes, advice keys, and a hash-derived receipt id. They never contain prompt text, tool arguments, tool results, attachments, or credentials.
- Tool arguments are hashed in memory for repeat detection; the raw string is not persisted.
- The only files written are under `$DSH_HOME/squeeze/` (or `storage.dataDir`): receipts, exports, and an audit log of mode/budget/mute/purge changes.
- POSIX directories are created `0700` and files `0600`. Windows has no equivalent mode; the plugin reports best-effort behaviour and does not claim POSIX permissions.
- Uninstalling or disabling the plugin does not delete receipts; removal requires an explicit `/squeeze purge --yes` per session.
- The plugin makes no external network requests. Its HTTP API is read-only, GET/HEAD only, mounted under the Host's existing same-origin web server.

## Threat model

| Threat | Mitigation |
|---|---|
| Malicious workspace text tries to steer the plugin | The plugin never reads workspace or conversation text; it folds event metadata only. Repository text is treated as untrusted input. |
| A session id used for path traversal | File names are SHA-256-derived; HTTP session ids are whitelisted to `[A-Za-z0-9._:-]{1,200}`. |
| Accidental body capture in a receipt | A recursive privacy guard rejects records containing forbidden keys before write; tests cover it. |
| Hook failure ending a turn | Every hook is wrapped; failures downgrade to a warning. |
| Guard killing legitimate tools | `enforce` is opt-in, per-session overridable, reason text explains usage/limit/escape hatch. |
| HTTP exposure to other origins | Inherits the Host's local auth and same-origin fence; no CORS headers; no write routes; no new port. |

## Scope

Report issues in the plugin itself. Issues in DeepSeek Harness core or official packages belong with their maintainers.
