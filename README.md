# Provlepsi-AI

Provlepsi-AI is an experimental time-series forecasting application built with Next.js, React and TypeScript. Upload a CSV, inspect its data, select forecasting models, and compare their chronological holdout errors and future forecasts. Parsing and model computation run in browser workers; the server handles authentication.

The project preserves nine model families for research and demonstrations. Its model-comparison workflow does **not** perform automated model selection, hyperparameter search, seasonality discovery or production forecasting validation. No benchmark accuracy or speed claims are made.

## Implemented workflow

- Sign up, sign in and sign out using hashed passwords, HTTP-only session cookies and Neon PostgreSQL account storage. Authentication validates input and origin, normalizes email addresses, handles duplicate signup atomically and uses shared database-backed attempt limits.
- Parse CSVs consistently with pandas for every model. Generate a 100-row preview, numeric summary statistics and correlations; explore Plotly charts and export images.
- Select a numeric target and operational missing-value/outlier strategies. Inspect a processed preview and transformation counts before training.
- Configure a common chronological test fraction, history cap, lag/window length, future horizon, neural epochs and random seed. Random forest also exposes tree count, maximum depth and minimum split size.
- Train models sequentially, evaluate the same fixed-origin recursive holdout task, and compare RMSE/MAE with a repeat-last-observation baseline. Fit a separate final model to available history for future forecasts.
- Cancel training, view correctly positioned history/holdout/future forecasts, and export CSV, PNG and run-details JSON.
- Scope local project data by account and project. Delete the current project explicitly; signing out clears that account's local projects and neural weights. Starting a new project retains earlier local datasets/weights until deletion or sign-out.

### Model implementations

All models use the shared preparation/evaluation contract described below. Models remain experimental even when their numerical and integration checks pass.

| Model / internal ID | Engine | Implementation |
| --- | --- | --- |
| ARIMA / `arima` | Statsmodels in Pyodide | Fixed ARIMA `(1, 1, 1)`, univariate; retains missing positions for the state-space model. Convergence warnings are surfaced. |
| Gradient Boosting / `boosting` | scikit-learn in Pyodide | `HistGradientBoostingRegressor` with target lags and available numeric covariates; not XGBoost. |
| Linear Regression / `linear` | scikit-learn in Pyodide | Linear regression with target lags and available numeric covariates. |
| Random Forest / `randomForest` | scikit-learn in Pyodide | Seeded lag-feature ensemble with configurable forest settings. |
| LSTM / `lstm` | TensorFlow.js | Seeded, 50-unit recurrent model using target-only windows. |
| GRU / `gru` | TensorFlow.js | Seeded, 50-unit gated recurrent model using target-only windows. |
| LSTM-GRU Hybrid / `lstmGruHybrid` | TensorFlow.js | Stacked LSTM and GRU using target-only windows. |
| Bi-LSTM / `bilstm` | TensorFlow.js | Bidirectional LSTM over each entirely historical target window. |
| Transformer / `transformer` | TensorFlow.js | Experimental compact encoder: 16-dimensional embedding, sinusoidal positions, scaled self-attention, residual connections, layer normalization and scalar output. |

The Transformer no longer normalizes a single-feature representation. Input-sensitivity, ordering, fitting and serialization regression checks protect that structural repair; they do not demonstrate useful forecasting accuracy. Prophet and XGBoost are not integrated.

### Preparation, evaluation and forecasting

Default settings retain the last **300 rows**, reserve the final **20%** for evaluation, use **10 lags/window observations**, train neural models for **10 epochs**, and forecast **10 future row steps**, with seed **42**. UI and pipeline validation bound the configurable settings; the history cap supports 50-2,000 rows and the future horizon supports 1-100 steps.

The shared pipeline splits chronologically **before** fitting evaluation preprocessing. Means, IQR bounds and neural min/max scaling use training observations only. Validation target values remain original: they are never filled, clipped or replaced; missing truths are excluded from metric counts. Every engine forecasts the complete holdout recursively from one fixed cutoff without receiving actual test targets. The baseline repeats the last originally observed training target. Final future forecasting uses a separate preprocessing fit and model fit on all retained, now-observed history; evaluation metrics continue to describe the earlier holdout model.

Missing-value options are forward fill, backward fill, historical mean and row drop. At a leading/trailing boundary without a fill neighbour, filling uses the fitted historical mean. Backward fill operates within known historical partitions only; it does not inspect held-out targets during evaluation. Outlier options are none, IQR clipping and row drop.

Dropping is a **shared complete-numeric-row policy**: a missing or rejected value in the target or any retained numeric feature marks the whole row as a gap, including for univariate models that ignore those features. Original positions are preserved. Lag/neural windows crossing gaps are skipped, and an incomplete final context produces an actionable error instead of silently compressing time. Prefer filling/clipping when complete recent forecasting context is needed.

Additional numeric covariates are used by linear regression, random forest and boosting. Their future values are not known: recursive evaluation freezes them at the last training values, and final forecasts freeze them at the last observed values. ARIMA and neural models are univariate. The source CSV is retained unchanged.

## Architecture

- **Application:** Next.js 16 App Router, React 19, TypeScript and Tailwind CSS 4.
- **State/storage:** Account-scoped Zustand/localStorage state, IndexedDB datasets through `idb`, and account/project-scoped TensorFlow.js weight paths.
- **Shared forecasting contract:** Typed settings, prepared partitions, metric definitions, baseline, row positions and versioned result metadata in `src/types/forecasting.ts` and `src/lib/forecasting.ts`.
- **Python worker:** Pyodide **0.25.0**, downloaded from a versioned jsDelivr URL, with pandas and lazily loaded Statsmodels/scikit-learn. The exact Python snippets live in `src/lib/python-code.ts` for fixture verification. No local Python installation is needed to use the application.
- **Neural worker:** TensorFlow.js with seeded architectures in `src/lib/neural-models.ts`. Backend selection attempts WebGPU, WebGL and then CPU, checking actual execution and handling failed/false initialization.
- **Lifecycle:** Comlink worker proxies and run-generation guards prevent stale results from replacing a newer run. Cancellation terminates active workers; subsequent work recreates them. Models and temporary tensors are disposed on success/failure.
- **Server:** Next.js authentication routes, Neon serverless PostgreSQL, Bcryptjs password hashing and Jose JWT sessions.

CSV content/model computation remain local to the browser in the current source. Account information and passwords are sent to the application server; account records/password hashes are stored in PostgreSQL. Runtime/package and font downloads require network access. Browser storage is not encrypted or a security boundary against a person controlling the browser profile.

## Prerequisites

- **Node.js 22.18.0 or newer**; `.nvmrc` selects Node.js 24.
- **npm**, using the committed lockfile.
- A modern browser supporting Web Workers, WebAssembly and IndexedDB. Backend support, memory and performance vary by browser/device; CPU fallback can be slow.
- A **Neon PostgreSQL** database and a connection string compatible with `@neondatabase/serverless`. An arbitrary local PostgreSQL URL does not provide the HTTP service used by this driver.
- Internet access for npm installation, Pyodide/runtime packages and Google fonts during Next.js font compilation.

Run commands from the repository root containing `package.json`.

## Local setup

1. Install the locked dependency tree:

   ```sh
   npm ci
   ```

2. Copy `.env.example` to `.env.local`:

   ```sh
   # macOS / Linux
   cp .env.example .env.local
   ```

   ```powershell
   # Windows PowerShell
   Copy-Item .env.example .env.local
   ```

3. Configure server-side values:

   | Variable | Purpose |
   | --- | --- |
   | `DATABASE_URL` | Neon PostgreSQL connection string, including database and credentials. |
   | `JWT_SECRET` | Private, cryptographically random signing secret; use at least 32 random bytes. |
   | `APP_ORIGIN` | Optional explicit HTTP(S) application origin, for example `http://localhost:3000`, without a path or trailing slash. Configure the public origin if a deployment proxy changes the origin seen by the server. |

   Generate a secret locally:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Keep `.env.local` private; these values must not use a `NEXT_PUBLIC_` prefix. Configure the corresponding deployment secrets separately.

4. For a **new database**, apply [db/schema.sql](db/schema.sql) in the Neon SQL editor. For an **existing database**, review and apply [db/migrations/001_auth_hardening.sql](db/migrations/001_auth_hardening.sql) before deploying the new routes. Its diagnostic identifies case-insensitive duplicate emails; resolve those accounts deliberately before creating the normalized unique index. The application does not automatically migrate databases or rewrite existing accounts.

5. Start development:

   ```sh
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000), create an account and upload a CSV. Signup requires at least 12 password characters and at most 72 UTF-8 bytes. Login accepts up to 1,024 bytes for compatibility with legacy bcrypt passwords; the original bcrypt 72-byte truncation still applies to those legacy hashes. Missing database configuration/schema prevents authentication; there is no guest mode.

### CSV input

Use a header row with unique nonempty column names, a numeric target and observations already in chronological order. The common pandas parser handles quoted commas and multiline fields for every model. Limits are **5 MiB**, **100,000 observations** and **100 columns**; the configured trailing history cap determines the smaller training range.

Timestamps are not sorted or used to infer sampling frequency. Forecast positions are original zero-based CSV observation indices, not inferred dates. Provide enough usable history for the selected lookback, training partition and nonempty holdout. Filled/dropped values and resource limits can still prevent a model from fitting; failures are surfaced rather than reported as zero-error successes.

## Checks and production build

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`typecheck` generates Next.js route types before running TypeScript. Automated checks cover session/configuration behavior, authentication handlers, shared preprocessing/evaluation/index alignment, neural input sensitivity/fitting/serialization/resource cleanup, and result exports. Neural tests run on TensorFlow.js's CPU backend; they are regression checks, not forecasting benchmarks or proof of GPU compatibility.

The Neon integration test is opt-in. Set `AUTH_TEST_DATABASE_URL` to a **separate test Neon database**, then run `npm test`. It creates and drops a randomly named test schema and does not use `DATABASE_URL` or modify production `public.users`. Without that variable it is explicitly skipped; a passing default test run does not establish live database integration.

Browser regression checks use Playwright in isolated browser profiles. Install Chromium once, build, and run:

```sh
npx playwright install chromium
npm run build
npm run test:storage:browser
npm run test:browser
```

Alternatively, set `PLAYWRIGHT_CHANNEL=chrome` to use an installed Chrome browser. The storage check exercises account/project isolation and deletion. The production smoke runs all nine actual model workers, exports, cancellation and account switching with synthetic CSVs and a mocked account lookup; it does not exercise real Neon login/signup. Runtime packages are downloaded during the smoke, so it requires internet access. CI includes both browser checks.

`npm start` serves the production build. Deploy behind HTTPS for secure production session cookies. A build does not verify your database migration/connectivity, runtime downloads, every model/backend, or forecast quality. [AUDIT_REPORT.md](AUDIT_REPORT.md) records the checks actually executed and their scope. Review `npm audit` separately; a successful build/test run is not a security clearance.

## Remaining limitations

- **Research forecasting:** No automated model selection, hyperparameter search, confidence intervals, rolling backtesting, seasonality/order search or future-covariate input. Fixed-origin recursive errors describe one cutoff and can vary substantially with the chosen split.
- **Data assumptions:** Row order represents time. Irregular timestamps, duplicate timestamps, sampling gaps and business calendars are not automatically repaired. Row dropping retains gaps; some models/settings cannot forecast across an incomplete recent context.
- **Model scope:** ARIMA order and several architecture settings are fixed. Neural models use only the target; extra numeric columns are not neural inputs. Holding external predictors constant is a simplifying assumption, surfaced in run warnings.
- **Reproducibility:** Seeds and fixed neural sample order improve repeatability; browser/GPU implementations and floating-point execution can still differ. Runtime packages are supplied by the pinned Pyodide distribution rather than the npm lockfile.
- **Browser resources:** Training is capped and happens twice per model (evaluation and final refit). Memory/storage quotas, GPU support and network access constrain execution. Cancellation terminates a worker and discards its unfinished computation.
- **Persistence:** Datasets, results and neural weights are local to one browser origin/profile; they do not synchronize across devices. Legacy unscoped data is not assigned to the next signed-in user and has an explicit deletion action. Account namespaces prevent accidental mixing, not direct inspection by the browser-profile owner.
- **Saved models:** Run JSON contains settings, preprocessing/scaler metadata, predictions, positions and reported runtime details; it excludes original CSVs and model weights. Neural weights remain in IndexedDB, but the interface does not yet offer a model-reload or portable weight-export workflow. Python fitted models are not persisted.
- **Authentication:** Input/origin validation, shared throttling and database uniqueness improve the implementation, but email verification, password recovery, MFA, session revocation management and a complete deployment abuse-protection strategy are not implemented. Database-backed limits cannot replace infrastructure-level request controls.
- **Verification scope:** Unit checks and synthetic browser smoke runs are not accuracy benchmarks, large-data performance evidence or broad cross-browser/GPU validation. Consult the audit report for verified and unexecuted checks.

## Project structure

```text
.
├── .github/                 # CI, CodeQL and dependency updates
├── db/                      # New-database schema and existing-database migration
├── public/                  # Existing static assets
├── src/
│   ├── app/                 # Pages, layout and authentication routes
│   ├── components/          # Upload → EDA → model → training → results wizard
│   ├── lib/                 # Shared pipeline, neural/Python code, auth, storage and workers
│   ├── store/               # Account-scoped project state
│   ├── types/               # Forecasting contracts and library declarations
│   ├── workers/             # Pyodide and TensorFlow.js entry points
│   └── proxy.ts             # Session-based page routing
├── tests/                   # Regression tests and opt-in Neon integration test
├── .env.example             # Empty local configuration template
├── ADDING_MODELS.md          # Actual model/parameter integration process
├── AGENTS.md                # Next.js guidance for coding agents
├── AUDIT_REPORT.md           # Audit findings and validation scope
├── LICENSE                  # Apache License 2.0
├── THIRD_PARTY_NOTICES.md    # Dependency/asset attribution and license notes
└── package-lock.json        # Locked npm dependency tree
```

Read [ADDING_MODELS.md](ADDING_MODELS.md) before extending a worker or adding settings.

## Licensing and attribution

Original project source is provided under [Apache License 2.0](LICENSE). Third-party dependencies, runtime downloads, fonts and template assets retain their own licenses and notices; the project license does not relicense them. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for attribution and redistribution considerations.
