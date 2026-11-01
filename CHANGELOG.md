# Changelog

All notable changes to QueryGuard are documented here. This project follows [Semantic Versioning](https://semver.org/).

## [2.0.0] - 2026-11-01

A ground-up rewrite focused on safety, correctness and honest numbers.

### Security

- **The simulation no longer executes your statement.** 1.x ran the real `DELETE` (also for `UPDATE`s) inside a rolled-back transaction, which takes row locks on production tables, fires triggers and consumes sequences. 2.0 only runs `SELECT count(*)` queries inside `BEGIN TRANSACTION READ ONLY` with server-side `statement_timeout` and `lock_timeout`; PostgreSQL rejects any write.
- **Credentials moved out of plain-text storage.** 1.x saved connection profiles — including passwords — in VS Code global state. They are migrated automatically to SecretStorage (OS keychain) and the plain-text copies are deleted.
- `sslMode` and the new `sslRootCertPath` are machine-scoped: a repository's workspace settings can no longer downgrade TLS.
- Local hosts are detected by parsing the URL (1.x disabled TLS for any URL _containing_ "localhost").
- `sslmode` in the URL is honoured with libpq semantics; `verify-ca` no longer checks the host name.
- Strict webview Content-Security-Policy (no inline scripts or styles) and validation of every webview message. Logs redact connection strings and passwords.

### Correctness

- Prisma models resolve to the real table (`prisma.user` → `"User"`), including `@@map`, `@map` and `@@schema` read from `schema.prisma`. In 1.x most Prisma tables showed 0 rows.
- Drizzle variables resolve through your `pgTable` / `pgSchema().table` / `pgTableCreator` definitions and column names.
- `where: { deletedAt: null }` now means `IS NULL` (1.x generated `= NULL`, which never matches).
- Runtime filter values (`where: { id: userId }`) are no longer sent as the literal text `'userId'`; you are asked for a test value, or the count is labelled as an upper bound.
- No more false **DESTRUCTIVE** on filtered mutations: Drizzle `and()/or()`, Supabase `.lt()/.or()/…`, Prisma `OR`/relation filters.
- `$queryRaw` `SELECT` statements are no longer flagged; raw `DELETE`/`UPDATE`/`TRUNCATE` (including CTEs) are classified with their real table.
- `ON DELETE` rules are no longer applied to updates. "WILL FAIL (Restrict)" became "may fail", and only when referencing rows exist — the exact count tells you for sure.
- Foreign keys are read from `pg_catalog`: schema-aware (e.g. `auth.users` vs `public.users`), multi-column keys, partitioned tables, `SET DEFAULT`.
- Cascade estimates scale with the share of parent rows deleted and are bounded in dense schemas.
- Estimates are labelled honestly: _estimated_, _upper bound_, _at most one row_ or _exact_.

### Added

- **Exact count** with a full breakdown per table and foreign-key rule, and a prediction of `RESTRICT` / `NO ACTION` failures.
- Diagnostics work **without a database** for unfiltered mutations; configurable severity (`queryguard.diagnosticSeverity`).
- Quick fixes: show impact, count rows, insert `// queryguard-ignore`.
- Simulation time budget enforced by the database (4 × `simulationTimeout`, which is now machine-scoped, max 120 s).
- `queryguard.exclude`, `queryguard.criticalRowThreshold`, `queryguard.prismaClientNames`, `queryguard.drizzleClientNames`, `queryguard.autoConnect`, `queryguard.simulationTimeout`, `queryguard.sslRootCertPath`.
- Detection of `tx.*`, `this.prisma.*`, `this.db.*`, `prisma.$transaction`, Supabase `.schema()`, `TRUNCATE`.
- Connection profiles with delete buttons, remembered per workspace; status bar menu; production-looking profiles are highlighted.
- History per workspace with export to a JSON/CSV file (CSV is protected against formula injection).
- Friendly error messages for authentication, TLS, timeouts, permissions, DNS…

### Changed

- New impact panel: lighter (Recharts removed), theme-aware, keyboard accessible, live-updating while you edit.
- Commands are grouped under the _QueryGuard_ category and hidden from the palette when they don't apply.
- Analysis parses each file once (1.x parsed it six times per change) and debounces per file.
- The schema refreshes periodically while connected (`queryguard.cacheTTL`, now _seconds between refreshes_).

### Removed

- The default `Ctrl+Shift+D …` keybindings: they hijacked VS Code's _Run and Debug_ shortcut. Use the status bar menu, CodeLenses or the command palette.

### Fixed

- Webview message loop that re-sent "ready" on every render, and the _Reconnect_ button that threw an error.
- Commands were unavailable while the extension auto-connected at startup.
- Concurrent requests to the database worker could receive each other's results; a second connection attempt could orphan a worker.
- Analysis results of closed documents were never released.

See [docs/AUDIT-2.0.md](docs/AUDIT-2.0.md) for the full audit, including the independent review of this release.

### Internal

- Pure, VS Code-independent core with 102 unit tests; integration tests against real PostgreSQL 13 and 17 that compare counts with a real `DELETE`; end-to-end tests in VS Code 1.85 and stable.
- Single package (the webview is built with Vite from the root), React 19, TypeScript 6, ESLint flat config with React Hooks rules.

## [1.2.1] - 2026-05-07

### Fixed

- Resolved dependency vulnerabilities (`esbuild`, `diff`, `serialize-javascript`).
- ESLint and `tsconfig.json` configuration fixes.

## [1.2.0] - 2026-05-01

### Added

- Export history to CSV/JSON (via clipboard).
- Blast radius visualisation, cascade tree and History tab.

## [1.1.2] - 2026-04-17

### Fixed

- History tab navigation.

## [1.1.1] - 2026-04-15

- Initial release: Prisma, Supabase and Drizzle detection, row estimates, cascade analysis, simulation and impact panel.
