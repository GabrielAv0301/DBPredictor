# QueryGuard 2.0 — Audit log

Audit performed on 2026-11-01 on the `release/2.0.0` branch: a self-audit of 1.2.1, the 2.0 rewrite,
then an independent review of the rewrite. Every fix below has a regression test.

## 1. Findings in 1.2.1 (fixed by the rewrite)

| Severity | Finding                                                                                                                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical | The "safe simulation" executed the real `DELETE` (also for `UPDATE`s) inside `BEGIN … ROLLBACK`. On a production database this takes row locks on the table and every cascaded table for up to 15 s, fires triggers and consumes sequences. |
| Critical | Connection profiles, including passwords, were stored in plain text in `globalState`.                                                                                                                                                       |
| High     | Prisma tables were looked up as `user` instead of `"User"` → most Prisma mutations showed 0 rows.                                                                                                                                           |
| High     | `where: { x: null }` became `"x" = NULL` (never matches); runtime values were sent as the literal text `'userId'`.                                                                                                                          |
| High     | False DESTRUCTIVE: Drizzle `and()`, Supabase `.lt()/.or()`, every `$queryRaw` `SELECT`.                                                                                                                                                     |
| High     | `ON DELETE` rules were applied to updates; "WILL FAIL (Restrict)" shown for almost every delete (NO ACTION is the default).                                                                                                                 |
| High     | Webview: `WEBVIEW_READY` posted on every render (message loop); _Reconnect_ button threw.                                                                                                                                                   |
| Medium   | Commands not registered while auto-connecting at activation; `Ctrl+Shift+D` chords broke _Run and Debug_.                                                                                                                                   |
| Medium   | Local hosts detected by substring (`localhost.evil.com` → TLS disabled); `sslMode` overridable by workspace settings.                                                                                                                       |
| Medium   | A single callback for simulation results (concurrent requests mixed up); each analysis parsed the file 6 times; results of closed files never released; webview never type-checked.                                                         |

## 2. Independent review of the rewrite

Confirmed: no write path and no SQL injection path (identifiers only from the catalog and quoted, values always bound, `READ ONLY` transaction always rolled back).

| #   | Severity | Finding                                                                       | Status                                                  |
| --- | -------- | ----------------------------------------------------------------------------- | ------------------------------------------------------- |
| 1   | High     | Drizzle chains ending in `.execute()` / `.then()` / `.prepare()` not detected | Fixed                                                   |
| 2   | High     | Raw SQL: `WHERE` inside a sub-query or `$$` string counted as a filter        | Fixed (parenthesis-aware scope, dollar quotes stripped) |
| 3   | Medium   | Unfiltered `DELETE` hidden in a data-modifying CTE                            | Fixed (every statement in a CTE evaluated)              |
| 4   | Medium   | `FOR UPDATE SKIP LOCKED` parsed as `UPDATE "SKIP"`                            | Fixed                                                   |
| 5   | Medium   | `.where(and(undefined))`, `.match({})` counted as filtered                    | Fixed                                                   |
| 6   | Medium   | Self-referencing / depth-limited / multi-path cascades reported as exact      | Fixed (`cascadeApproximate`, shown as `~`)              |
| 7   | Medium   | Simulation result attached to another mutation if the panel changed meanwhile | Fixed                                                   |
| 8   | Medium   | Closing the panel during a simulation threw "Webview is disposed"             | Fixed                                                   |
| 9   | Medium   | Host-side 180 s cap could kill legitimate simulations and disconnect          | Fixed (budget enforced server-side by the worker)       |
| 10  | Medium   | `simulationTimeout` workspace-overridable up to 300 s (lock queueing risk)    | Fixed (machine scope, max 120 s)                        |
| 11  | Low      | RESTRICT child also removed by another cascade reported as a certain failure  | Fixed (reported as "may or may not fail")               |
| S1  | Medium   | Profile deleted when the keychain is temporarily unavailable                  | Fixed                                                   |
| S2  | Low      | Error pop-ups not passed through `redact()`                                   | Fixed                                                   |

## 3. Known limitations (accepted for 2.0, documented)

- **Profile store races (low):** two windows creating a profile at the same instant can lose one profile's metadata (VS Code `globalState` has no compare-and-swap).
- **Activation I/O (low):** the project index reads up to 5 000 files (≤ 1 MB each) in the background on activation to find Drizzle tables. It never blocks activation; lazy indexing is a candidate for 2.1.
- **Drizzle name collisions (low):** in a monorepo with two `users` table variables, the first indexed definition wins.
- **String-concatenated raw SQL** (`'DELETE FROM t ' + where`) is not classified.
- **Row-level security:** counts run with the connected role; with Supabase RLS and a non-owner role they can be lower than what the application role would delete.
- **Bundle size:** `extension.js` is 3.5 MB because it embeds the TypeScript parser (same as 1.x); the `.vsix` is ~1.2 MB.
- **Dev-only advisories:** `npm audit` reports moderate issues in `glob`/`minimatch` pulled by mocha/eslint/c8. Production dependencies: 0 vulnerabilities.

## 4. Verification

| Suite                                                                                 | Result                                                 |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Unit (`npm test`)                                                                     | 102 passing                                            |
| Integration vs real PostgreSQL 13 and 17, bundled worker (`npm run test:integration`) | 10 + 10 passing — counts compared with a real `DELETE` |
| End-to-end in VS Code 1.85.0 and 1.144 (`npm run test:e2e`)                           | 7 + 7 passing                                          |
| ESLint, Prettier, `tsc` (extension + webview)                                         | clean                                                  |
