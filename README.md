# Provlepsi-AI

Provlepsi-AI is an experimental time-series forecasting application built with Next.js, React and TypeScript. Its current interface is named **Time-Series AutoML Studio**. Users upload a CSV, explore its data, choose models and compare forecasts generated in browser workers.

This repository preserves the application and its research implementations. The "AutoML" name refers to the model-comparison workflow: automated hyperparameter search, model selection and production forecasting validation are not implemented. Read the limitations below before interpreting forecasts or comparing scores.

## Implemented workflow

- Sign up, sign in and sign out using server-side authentication, hashed passwords and HTTP-only session cookies.
- Read CSV files in the browser, retain them in IndexedDB and generate a pandas preview, numeric summary statistics and correlations.
- Explore line charts, histograms, box plots and correlation heatmaps with Plotly; export chart images.
- Select a numeric target and one or more forecasting models. Linear regression and random forest support a configurable chronological holdout; random forest also exposes estimator count, maximum depth and minimum split size.
- Train models sequentially through Comlink Web Workers, display RMSE/MAE and generate ten-step forecasts.
- View results, export forecast CSV files and retain wizard state in browser localStorage.

### Model implementations

| UI model / internal ID | Engine | Current implementation and evaluation |
| --- | --- | --- |
| ARIMA / `arima` | Statsmodels in Pyodide | Fixed ARIMA `(1, 1, 1)`; RMSE/MAE compare fitted values with training observations. |
| Gradient Boosting / `boosting` | scikit-learn in Pyodide | `HistGradientBoostingRegressor` using row index as its predictor; training-fit RMSE/MAE. This is not XGBoost. |
| Linear Regression / `linear` | scikit-learn in Pyodide | Numeric input columns plus three target lags; chronological holdout controlled by the split setting. |
| Random Forest / `randomForest` | scikit-learn in Pyodide | Numeric input columns plus three target lags; chronological holdout and adjustable forest parameters. |
| LSTM / `lstm` | TensorFlow.js | Ten-observation windows, ten training epochs and a fixed 80/20 chronological split. |
| GRU / `gru` | TensorFlow.js | Same data preparation/evaluation as LSTM, with a GRU layer. |
| LSTM-GRU Hybrid / `lstmGruHybrid` | TensorFlow.js | Stacked LSTM and GRU layers; same data preparation/evaluation. |
| Bi-LSTM / `bilstm` | TensorFlow.js | Bidirectional LSTM; same data preparation/evaluation. |
| Transformer / `transformer` | TensorFlow.js | Experimental attention implementation. Its single-feature layer normalization collapses the representation and produces input-independent predictions. Retained as research code; do not treat it as a validated forecasting model. |

Prophet and XGBoost are not integrated into the application. Availability of a package in a Pyodide distribution does not mean the application supports it.

## Architecture

- **Application:** Next.js 16 App Router, React 19, TypeScript and Tailwind CSS 4.
- **Browser state/storage:** Zustand with localStorage persistence; IndexedDB through `idb` for datasets and TensorFlow.js model storage.
- **Python worker:** Pyodide **0.25.0**, loaded from a versioned jsDelivr URL, with pandas and lazily loaded Statsmodels/scikit-learn. Python runs through WebAssembly; no local Python installation is required.
- **Deep-learning worker:** TensorFlow.js, which attempts WebGPU and falls back to WebGL when backend initialization throws. Availability depends on the browser and worker environment.
- **Visualization:** Plotly and React Plotly.
- **Server:** Next.js authentication API routes, Neon serverless PostgreSQL, Bcryptjs password hashing and Jose JWT sessions.

Dataset parsing and model computation run in the browser in the current source. Authentication sends account information to the application server and stores account records in PostgreSQL. Runtime/package downloads and font downloads require network access; this is not an offline application.

## Prerequisites

- **Node.js 22.18.0 or newer**; `.nvmrc` selects Node.js 24 for development.
- **npm**, using the committed `package-lock.json` for installation.
- A modern browser supporting Web Workers, WebAssembly and IndexedDB. Deep models also depend on a usable TensorFlow.js backend; support and performance vary by browser/device.
- A **Neon PostgreSQL** database and a connection string compatible with `@neondatabase/serverless`. An arbitrary local PostgreSQL URL alone does not provide the HTTP service used by this driver.
- Internet access for npm installation, the Pyodide runtime/packages and Google fonts during Next.js font compilation.

Run the following commands from the directory containing `package.json`. In the supplied workspace, that directory is `Provlepsi AI/time-series-autoML-main`.

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

3. Fill in the two server-side environment variables:

   | Variable | Purpose |
   | --- | --- |
   | `DATABASE_URL` | Your Neon PostgreSQL connection string, including the database name and credentials. |
   | `JWT_SECRET` | A private, cryptographically random signing secret. Use at least 32 random bytes; do not reuse an example value. |

   Generate a 32-byte random secret with Node.js and copy its output into `JWT_SECRET`:

   ```sh
   node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
   ```

   Keep `.env.local` private. Neither variable needs a `NEXT_PUBLIC_` prefix. Configure the same variables in your deployment environment.

4. Apply [db/schema.sql](db/schema.sql) to the database, for example in the Neon SQL editor. Authentication expects a `users` table with `id`, `name`, nullable `gender`, unique `email` and `password_hash` columns. The application does not automatically provision this table.

5. Start the development server:

   ```sh
   npm run dev
   ```

6. Open [http://localhost:3000](http://localhost:3000), create an account and upload a CSV. Missing database configuration/schema prevents authentication; there is no guest mode.

### CSV input

Use a CSV with a header row, a numeric target column and observations already in chronological order. Timestamp columns are not parsed, sorted or used to define a sampling frequency. Deep models need enough observations to produce nonempty training/test windows beyond their ten-observation lookback.

The pandas preview parser supports normal CSV input, but the deep-model target extractor currently splits lines/commas directly. Quoted commas or multiline fields can therefore be misread during deep-model training. Begin with a simple CSV and a numeric target.

## Checks and production build

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm start
```

`typecheck` generates Next.js route types before running TypeScript. `npm test` runs seven focused checks of JWT/session validation and missing database configuration. It does not exercise account routes or real Neon signup/login. There is no existing end-to-end or model-correctness test suite; these checks do not establish forecast accuracy or confirm every browser backend.

`npm start` serves the production build. Deploy behind HTTPS so production session cookies can be used securely. A successful build does not verify database connectivity, the required table, CDN downloads or browser model execution. See [AUDIT_REPORT.md](AUDIT_REPORT.md) for the checks actually executed during the publication audit and their results.

## Current limitations

- **Preprocessing controls are incomplete.** EDA stores the selected missing-value/outlier strategies, but training reads the original CSV and does not apply those selections. Python uses hardcoded forward/backward filling; deep models use their own numeric extraction and forward filling. Mean imputation and IQR clipping/dropping are not integrated.
- **Metrics are not directly comparable.** ARIMA/boosting report training-fit errors; linear/random forest use the selected holdout; deep models use a fixed 80/20 split. The global split slider does not change ARIMA, boosting or deep-model evaluation. Deep-model min/max scaling currently uses the entire retained series, including the holdout.
- **Data is capped for browser performance.** Python training uses at most the last 500 rows; deep-model training uses at most the last 300. Neural model initialization/training is not seeded for deterministic results.
- **Preview and result history are partial.** Line/histogram/box plots, result history and exported historical rows use the first 100-row preview. Correlations/statistics use the full uploaded CSV. Forecast charts/CSV indices are appended to that preview, which can misrepresent the forecast's position for larger datasets.
- **Forecast assumptions are basic.** The horizon is fixed at ten row steps. No confidence intervals, seasonality search, rolling backtest, automated tuning or future external-feature inputs are implemented. Linear/random forest hold non-lag numeric predictors at their last observed values during iterative forecasting.
- **Transformer remains experimental.** Its known representation-collapse defect requires research work before it can be relied on.
- **Browser coverage is limited.** All nine models completed a production Chrome smoke check on 60 synthetic rows. This verifies one integration path, not accuracy, large-data performance or other browsers. Memory, storage quotas, worker GPU support and package downloads can limit execution; worker isolation does not guarantee a responsive or successful run on every device. Training has no user-facing cancellation mechanism. See [AUDIT_REPORT.md](AUDIT_REPORT.md) for the verification scope.
- **Local state is not account-isolated.** Browser datasets, saved deep models and persisted wizard state survive signout and "Start New Project". Those actions do not erase stored data. On a shared browser, another signed-in user of the same origin can encounter the same state. Clear the site's localStorage/IndexedDB through browser site settings when needed.
- **Authentication is basic.** Account verification, password recovery, rate limiting and a full production abuse-protection strategy are not implemented.

No benchmark accuracy, speed or production-readiness claims are made by this repository.

## Project structure

```text
.
├── .github/                 # CI, CodeQL and dependency updates
├── db/schema.sql           # Authentication database schema
├── public/                 # Existing static assets
├── src/
│   ├── app/                # App Router pages, layout and auth API routes
│   ├── components/         # Upload → EDA → model → training → results wizard
│   ├── lib/                # Auth, database, worker and browser-storage helpers
│   ├── store/              # Persisted Zustand wizard state
│   ├── workers/            # Pyodide and TensorFlow.js implementations
│   └── proxy.ts            # Session-based page routing
├── tests/                  # Focused authentication regression tests
├── .env.example            # Empty configuration template; no credentials
├── ADDING_MODELS.md         # Actual model/parameter integration points
├── AGENTS.md                # Next.js guidance for coding agents
├── AUDIT_REPORT.md          # Publication audit findings and validation
├── THIRD_PARTY_NOTICES.md   # Dependency/asset licensing notes
└── package-lock.json       # Locked npm dependency tree
```

Read [ADDING_MODELS.md](ADDING_MODELS.md) before extending a worker or adding model parameters.

## Licensing and attribution

A source-code license has not yet been selected or granted. **Apache License 2.0 is recommended for original source only after the owner confirms the necessary rights.** Do not infer a license from the old README badge or apply a new source license to third-party code/assets.

Dependencies, runtime downloads, fonts and existing template assets remain subject to their own licenses. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the attribution review and unresolved provenance questions.
