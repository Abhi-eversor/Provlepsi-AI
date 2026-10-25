# Implementation repair and verification report

**Date:** 2026-10-25 (Asia/Calcutta). This report describes the implementation repairs following the publication audit. The [October 13 audit](docs/audits/2026-10-13-publication.md) is retained as a historical snapshot; its dependency counts, limitations, directory layout and proposed initial-import instructions are not the current state.

## Assessment and scope

The existing Next.js/React application, browser Python/neural worker architecture and nine forecasting families are preserved. The repairs address preprocessing integration, evaluation leakage/comparability, the Transformer representation defect, chart/export alignment, account storage, cancellation, authentication and repeatable checks. Existing Git history and the Apache 2.0 license were present at the start of this work and have been preserved. No commit, staging, push or remote modification was performed.

This remains an **experimental forecasting application**. Structural and integration checks do not demonstrate accuracy, production security, large-data performance or compatibility with every browser/GPU.

## Forecasting correctness

- One typed contract and preparation implementation is shared by both worker engines. Settings are validated and each run records original row indices, source CSV SHA-256, target, data ranges, preprocessing fits, seed/configuration, evaluation predictions, future predictions, warnings and available engine versions.
- pandas parses CSVs for every model; direct comma/line splitting has been removed. UTF-8, file size, row/column limits, unique headers, strict quoting and logical-record field counts are checked before pandas can infer an unintended index. Numeric target coercion rejects malformed/infinite values. The upload remains unchanged.
- Training history is capped consistently across models (default 300 rows, configurable 50–2,000). Evaluation preprocessing is fitted on the training partition only. Missing-value/outlier choices are operational and have a processed preview with transformation counts.
- Validation targets stay original. Missing truths are excluded from metric counts rather than filled, clipped or assigned zero error. The baseline repeats the last originally observed training target.
- Every model evaluates the full chronological holdout recursively from one fixed origin. Test targets and future covariates are not fed into recursive predictions. Additional numeric covariates for lag-based Python regressors remain fixed at their last known value, with an explicit warning.
- A separate preprocessing/model fit on all retained observed history produces future forecasts. Its fit is distinct from the earlier holdout evaluation; metric labels and plot traces make that distinction visible.
- Row dropping retains excluded positions as gaps on the original grid. Lag windows crossing gaps are excluded; incomplete recent context is rejected explicitly. ARIMA retains missing positions for its state-space implementation. The complete-numeric-row policy is documented, including its effects on univariate models.
- Transformer attention now operates on a 16-dimensional embedding with positions, scaled attention and dimension-preserving residual normalization. The scalar output is produced at the end. Existing recurrent families retain their 50-unit default; initialization is seeded and training order fixed. The Transformer remains experimental.
- Neural backend initialization probes real kernel execution and falls back from WebGPU to WebGL to CPU. Temporary tensors, models and optimizers are disposed on success and failure.

## Results, storage and lifecycle

- Results, CSV exports and charts use actual run positions. A preview length no longer determines forecast origin. History, holdout predictions and future forecasts are distinguished; baseline errors and scored observation counts are visible.
- PNG export waits for chart initialization. CSV fields are escaped and object URLs released. Run JSON exports configuration, preprocessing/scaler information, predictions and provenance; it does not export source CSVs or model weights.
- Zustand state, IndexedDB datasets and neural model paths are scoped by verified account and UUID project. Account lookup gates the wizard, and identity is rechecked when focus returns. Stale overlapping identity responses are ignored; login in another tab invalidates the active identity and stops its work.
- Sign-out clears the active account's local data and saved neural weights. Current-project deletion is explicit and awaited. Starting a new project preserves earlier local datasets/weights until deletion or sign-out. Legacy unscoped data is detected without adoption or silent deletion; a separate action deletes it.
- Cross-tab logout/project deletion stop affected work. Worker run identifiers, cancellation-aware waits, termination, proxy release and callback guards prevent stale results from overwriting newer work. Upload/training failures are visible and retryable.
- IndexedDB cleanup no longer creates an empty, incompatible TensorFlow database. Expected upgrade cancellation and transaction failure paths have regression coverage against unhandled promise errors.

Account namespaces prevent accidental mixing; they do not encrypt browser data or protect it from a person controlling the browser profile. Use an appropriate device/data policy for sensitive datasets.

## Authentication and required database migration

- Bounded UTF-8 JSON parsing checks streamed body size, content type, field types and lengths. Emails are normalized; new passwords require at least 12 characters and at most 72 UTF-8 bytes. Existing shorter passwords and legacy long bcrypt passwords remain usable for login, with a 1,024-byte login limit and the existing hashes' original 72-byte truncation semantics.
- Login/signup/logout mutations require the correct origin. Optional `APP_ORIGIN` supports an explicitly configured public reverse-proxy origin. Credentials and internal database errors are not returned in service-failure responses.
- A normalized-email unique index and atomic insertion protect simultaneous signup. Existing case-insensitive duplicates are reported for deliberate owner reconciliation, never silently merged or removed.
- Atomic PostgreSQL attempt counters apply across server instances. Counter keys use HMACs rather than raw email addresses or untrusted client IP headers. Rate-limit failures return `429`/`Retry-After`; unavailable configuration/schema fails closed.
- JWT signature/algorithm/identity/lifetime checks and HTTP-only, SameSite cookies are retained and strengthened. Production cookies are Secure; deploy behind HTTPS.

**Before deploying these routes:** apply [db/schema.sql](db/schema.sql) to a new database, or review and apply [db/migrations/001_auth_hardening.sql](db/migrations/001_auth_hardening.sql) to an existing database. Resolve any normalized-email duplicates reported by that migration. The application does not run migrations automatically. No real user database was modified during this work.

## Dependencies and verification

Compatible updates moved Next.js and its ESLint configuration to **16.4.3**, and updated vulnerable transitive resolution. Playwright is a development dependency for reproducible isolated browser checks. The full audit gate remains enabled; it was not weakened or restricted to production dependencies.

| Check | Result and scope |
| --- | --- |
| Clean `npm ci` | Passed: 625 packages installed from the lockfile; 626 audited. |
| `npm run typecheck` | Passed after clean installation and the identity/CSV corrections. |
| `npm run lint` | Passed after clean installation; zero errors/warnings. |
| `npm test` | Passed: 43 tests passed, zero failed; one live Neon integration test explicitly skipped because `AUTH_TEST_DATABASE_URL` was not supplied. Includes actual legacy bcrypt compatibility. |
| `npm run build` | Passed on Next.js 16.4.3 after the final source changes; all routes generated. |
| `npm run test:storage:browser` | Passed in isolated production Chrome: 13 assertions, including owned deletion, failure/retry paths and no unhandled browser errors. |
| `npm run test:browser` | Passed on the final production build in isolated Chrome: all nine models on 620 synthetic rows; applied preprocessing; common holdout; nondefault settings; correct forecast indices/source hash; actual CSV/JSON/PNG downloads; reload; cancellation; account switching; cross-tab logout and owned deletion. Additional real Pyodide fixtures rejected six malformed inputs and accepted BOM/quoted/multiline fields. Delayed account-response ordering and cross-tab identity invalidation passed. Zero browser errors. |
| Isolated PostgreSQL-compatible SQL harness | Passed schema/idempotent migration, concurrent normalized signup, real bcrypt login, shared limit counters/reset/cleanup and safe response checks. Temporary PGlite harness outside the repository; this is not Neon connectivity evidence. |
| `npm audit --audit-level=high` | Passed after clean installation: zero reported vulnerabilities. This is the registry's result at the check date, not a claim that all possible vulnerabilities are absent. |
| Live Neon integration | Unexecuted: no dedicated test credentials supplied. The opt-in test uses a random isolated schema and never uses `DATABASE_URL` or production `public.users`. |
| Linux GitHub Actions/CodeQL, other browser/GPU matrix, accuracy/performance benchmarks | Unexecuted locally. Updated CI includes unit, build, browser storage, production browser smoke and security checks. |

Install a test browser with `npx playwright install chromium`, then run the browser scripts after `npm run build`. An installed Chrome can be selected with `PLAYWRIGHT_CHANNEL=chrome`. Tests use isolated profiles, synthetic CSVs and an intercepted account lookup; they do not bypass authentication in application code or claim real Neon login coverage.

An earlier browser run caught an unhandled IndexedDB `AbortError` during cleanup. The database existence probe and aborted-transaction handling were repaired and covered by storage failure-path checks; the repeated full browser run passed without suppressing browser errors. Tests use one neural epoch to exercise integration in bounded time, not to establish model quality.

## Remaining limitations

- No automated model/hyperparameter selection, rolling backtest, confidence intervals, automatic seasonal/order search or future-covariate input is introduced by this repair.
- Row order is treated as time; timestamps, irregular spacing, calendars and duplicate timestamps are not automatically inferred or corrected. Preserved row indices avoid misleading alignment but are not date forecasts.
- ARIMA order and some architecture choices remain fixed. Neural models are univariate. Seeded CPU checks do not guarantee deterministic GPU/browser forecasts.
- Saved neural weights and replay metadata are retained, but model reload/portable weight export has no UI workflow. Python fitted models are not persisted.
- Email verification, password recovery, MFA and centralized session revocation are not implemented. Database throttling supplements, rather than replaces, deployment request controls and monitoring.
- CDN runtime/package and Google font downloads require network access. Pyodide scientific packages belong to its pinned distribution rather than the npm lockfile. Training twice per model increases resource use; limits and cancellation remain necessary.
- The Apache license applies to original source; third-party notices and distribution obligations remain separate. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Review before committing

Changes span worker/model correctness, the shared pipeline/contracts, authentication routes/helpers and migration, browser state/storage/lifecycle/results, regression tests, CI and documentation. The older source remains in the existing Git history. Installed dependencies, `.next`, generated type files, build caches, private environment files and local credentials remain excluded by `.gitignore`; only the blank `.env.example` is intended for publication.

The current review set contains **29 modified existing files, 19 added files and zero deleted files**; there are 68 source candidates in total. New material includes the shared contracts/pipeline/Python snippets/neural builders, authentication service helpers and additive migration, CSV/session helpers, regression/browser tests and the archived audit. A final scan detected no recognizable credential tokens, private-key bodies, credential-bearing URLs or personal local paths; no oversized source files, exact duplicate files or broken relative documentation links were found. All 21 representative private/generated paths were ignored, including Playwright outputs. Every value in `.env.example` is blank. The Git index remained untouched and the existing HEAD stayed at `e18c1ee`.

From the repository root, review without staging or committing:

```sh
git status --short
git diff --stat
git diff
git ls-files --others --exclude-standard
git diff --cached --stat
```

Review new files as well as the tracked diff, especially the additive database migration and tests. No commit or push is part of this implementation task.
