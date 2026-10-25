# Adding models and parameters

Provlepsi-AI parses CSVs and trains models in browser workers. Server routes handle authentication. New models must join the shared preparation, evaluation, lifecycle and result contracts; a selectable card or available scientific package alone does not establish a working integration.

Read [README.md](README.md) for supported models and research limitations. Preserve meaningful experiments, but label unvalidated behavior accurately.

## Shared pipeline and contracts

| File | Responsibility |
| --- | --- |
| `src/types/forecasting.ts` | Model IDs, settings, prepared partitions, worker output and versioned stored result types. |
| `src/lib/forecasting.ts` | Settings validation/defaults, chronological split, training-only preprocessing, baseline/metrics and final positioned results. |
| `src/lib/python-code.ts` | Exact pandas parsing and Python fitting/forecasting source used in the browser and source fixtures. |
| `src/lib/neural-models.ts` | Seeded neural architectures, training-only scaling, gap-aware windows, fitting and recursive forecasting. |
| `src/workers/pyodide.worker.ts` | Serialized Python operations and on-demand scientific package loading. |
| `src/workers/tfjs.worker.ts` | Backend selection, evaluation/final fitting, scoped weight storage and tensor/model cleanup. |
| `src/lib/workerHelper.ts` | Worker/proxy creation, run identity, cancellation and stale-result protection. |
| `src/components/StepTrain.tsx` | Parse once, prepare one shared run, route selected models sequentially and store successful results. |
| `src/components/StepResults.tsx` | Positioned charts, model/baseline metrics, warnings, CSV/PNG/JSON export and project deletion. |

`PreparedRun` contains separate `train`, untouched `validation.actual`, and `final` partitions; original row indices; preprocessing choices/fitted metadata; run settings; baseline information; and warnings. Never reconstruct this information from the 100-row EDA preview or reparse the CSV differently inside a new model.

The forecasting protocol is **fixed-origin recursive**. Fit using `run.train`, predict the entire validation period without actual held-out targets, and evaluate against `run.validation.actual`. Then build a fresh final fit using `run.final` and produce exactly `run.config.horizon` future values. Do not reuse holdout-fitted weights or transformations to calculate evaluation scores.

Default settings are 300 retained rows, a 20% test fraction, 10 lags/window observations, 10 neural epochs, a 10-step future horizon and seed 42. Their authoritative values and bounds are in `forecasting.ts`. All models use the same retained row grid and evaluation cutoff, even when an engine has different input capabilities.

## 1. Select the engine and dependencies

| Worker | Existing IDs | Engine |
| --- | --- | --- |
| `pyodide.worker.ts` | `arima`, `boosting`, `linear`, `randomForest` | Statsmodels/scikit-learn through Pyodide 0.25.0. |
| `tfjs.worker.ts` | `lstm`, `gru`, `lstmGruHybrid`, `bilstm`, `transformer` | TensorFlow.js layers and tensors. |

The versioned Pyodide runtime and scientific packages are downloaded from jsDelivr; `npm ci` does not install local Python or bundle those scientific packages. Check the version-specific [package list](https://pyodide.org/en/0.25.0/usage/packages-in-pyodide.html) and [loading documentation](https://pyodide.org/en/0.25.0/usage/loading-packages.html) before introducing dependencies. Native desktop Python wheels are not automatically WebAssembly-compatible. A runtime upgrade requires its own validation.

For both engines, assess licensing, bundle/download size, memory use and backend support. Update third-party notices when introducing a new dependency or redistributed asset.

## 2. Register the model

1. Extend `ModelId` in `src/types/forecasting.ts`. `DeepModelId` currently excludes the four Python IDs: update that exclusion for a new Python model so it is not accidentally treated as neural.
2. Add the ID, readable name and accurate description to the `models` array in `StepModelConfig.tsx`. Its selected-model array and existing checkbox handler collect IDs through `setModelsToTrain`.
3. Add the readable result name in `StepResults.tsx`.
4. Extend the `pythonModels` routing list in `StepTrain.tsx` for a Python model; otherwise route the ID through the neural worker's typed API.
5. Update the worker's supported-ID validation and actual implementation. Unsupported IDs must fail explicitly.

Keep IDs stable: they appear in persisted results and neural model paths. Existing state hydration also filters known IDs in `useStore.ts`; update that allowlist for a new model. Decide how older saved results/configuration should be treated when changing schemas or model behavior.

## 3. Implement the engine

### Python

The exposed API is:

```ts
trainModel(
  modelType: ModelId,
  run: PreparedRun,
  progressCallback?: (message: string) => void,
): Promise<WorkerTrainingResult>
```

1. Extend the accepted Python IDs in `pyodide.worker.ts` and select the required lazy-loaded package. Related scikit-learn estimators can reuse the current package.
2. Add a matching branch in `forecast_partition` in `src/lib/python-code.ts`. It receives a prepared historical partition, forecast length, model ID and validated settings.
3. Build features using only that partition. Current regression/ensemble models use configurable target lags and contemporaneous numeric covariates during fitting; recursive prediction freezes covariates at their final historical values. If a new model needs future inputs, add an explicit input contract instead of reading validation features.
4. Preserve gaps. Null targets/features arrive in Python as missing values. Skip lag windows crossing gaps and reject unusable recent context with an actionable message. ARIMA's state-space handling keeps missing positions; do not compress the time grid to emulate this for another estimator.
5. Return finite original-unit predictions. Surface convergence/runtime warnings and report the model's actual assumptions.
6. Preserve the existing separate evaluation/final calls. Shared TypeScript helpers calculate metrics against unchanged validation truth.

Worker operations are serialized because they share Python globals. Transfer input through `globals.set` and JSON, never by interpolating user-controlled values into executable Python. Delete transient globals and destroy owned proxies when finished. Do not introduce parallel Python fitting without replacing the shared-state contract safely.

### TensorFlow.js

The exposed API is:

```ts
trainModel(
  modelId: DeepModelId,
  run: PreparedRun,
  modelKey: string,
  progressCallback?: (
    epoch: number,
    logs: Record<string, number>,
    phase: 'evaluation' | 'final',
  ) => void,
): Promise<WorkerTrainingResult>
```

Epochs are one-based. The worker selects a working WebGPU/WebGL/CPU backend, trains/evaluates a training-only fit, disposes it, then trains the separate final model. It saves final weights under `indexeddb://${modelKey}` and disposes the model afterward. `modelKey` comes from `modelStoragePrefix(accountId, projectId)` plus run/model IDs; never use an unscoped timestamp-only key.

Add architecture branches in `buildNeuralModel` in `src/lib/neural-models.ts`. Reuse `fitNeuralModel` and `recursiveNeuralForecast` unless the new family requires a deliberately extended contract:

- Fit the scaler only on the supplied historical partition; retain its parameters in the returned artifact.
- Preserve original temporal gaps when building windows. Never concatenate disconnected target observations.
- Validate minimum sample/context size and all emitted losses/predictions. Do not return empty metrics as zero-error success.
- Seed initialization and stochastic settings where supported. Keep training sample order fixed; report browser/GPU nondeterminism honestly.
- Dispose temporary tensors, models and owned optimizers in success and failure paths. A persisted model must not remain allocated solely because its weights were saved.
- Register custom layers with TensorFlow.js serialization and test weight reload. Layer-normalization dimensions must preserve an input-dependent representation.

The repaired Transformer uses a 16-dimensional embedding, sinusoidal positions, scaled self-attention, residuals and vector normalization. It is a structurally checked research reference, not an accuracy benchmark. Current neural models use only the target; adding multivariate inputs requires corresponding feature/scaler metadata and saved-model compatibility work.

## 4. Return a complete, honest result

The worker output is defined centrally:

```ts
interface WorkerTrainingResult {
  metrics: Metrics;                 // rmse, mae, observed count n
  baseline: Metrics;
  evaluationPredictions: number[];   // one per validation row, including missing-truth rows
  forecast: number[];                // exactly config.horizon values
  modelName?: string;
  artifact?: Record<string, unknown>;
  warnings?: string[];
}
```

`createModelResult` rechecks forecasts and recomputes evaluation metrics centrally. It records original row positions, observed history, cutoff, baseline, configuration, preprocessing fits, model artifact, warnings, creation time and pipeline version. Charts and exports consume those positions directly, so forecasts follow the actual final observation even when history is capped.

Do not alter held-out truths, change the test period for one model, consume observed test targets recursively, or substitute in-sample residuals for holdout errors. A model that evaluates a different task needs a separate labelled result protocol and comparison group.

Shared preprocessing currently treats row drop as a complete-numeric-row rule. Any retained numeric feature can mark an entire row missing, even for a univariate model. Backward fill is restricted to the supplied known-history partition; future validation truths remain untouched. Document any contribution that changes these policies.

Run-details JSON includes settings, preprocessing/scaler metadata, positions, predictions and reported runtime versions; it does not contain original CSVs or weights. Neural weights remain in browser IndexedDB with account/project ownership, and the UI does not yet offer reload/portable-weight export. Python fitted estimators are not persisted. Do not describe metadata export as a complete portable model bundle.

## 5. Add adjustable settings

1. Extend `RunSettings` in `src/types/forecasting.ts` and `DEFAULT_SETTINGS`/`validateSettings` in `forecasting.ts`.
2. Add a control in `StepModelConfig.tsx`; identify which model consumes it. UI min/max attributes do not replace pipeline validation.
3. Consume the field through `run.config` in the engine; avoid incompatible positional trainer arguments.
4. Include effective model-specific values in artifacts and update documentation.
5. Review old account-scoped localStorage values: defaults merge during hydration, but incompatible saved schema/behavior may require a version change or migration.

The shared split fraction, history cap, lookback and future horizon affect all applicable model paths. Epochs affect neural training; forest parameters affect random forest. ARIMA's order is fixed unless explicitly extended.

## 6. Preserve lifecycle and storage behavior

`StepTrain.tsx` associates work with a generation/run identity and discards stale results. Navigation, cancellation, account changes and logout terminate active workers; the next operation recreates them. Use `awaitWorkerResult` and the existing active-run checks rather than storing results from unguarded callbacks.

Persist data through account/project-scoped storage helpers. Extend `deleteProject`/`clearAccount` when adding a new artifact store. Deletion must be awaited and errors must be visible. Legacy unscoped data is deliberately not assigned to the next logged-in account.

## 7. Verify and document

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

Add meaningful regressions for the new behavior: leakage isolation, quoted/malformed CSVs, missing/outlier policies, capped-history indices, fixed-origin evaluation, finite outputs, short/constant series, seeded behavior, serialization and resource cleanup where relevant. Use a last-value baseline without assuming the new model will outperform it. Do not turn synthetic learning fixtures into claims about real-world forecast quality.

Then exercise the actual browser worker: runtime/package loading, default and nondefault settings, progress, cancellation/retry, output length, charts, CSV/PNG/JSON exports, and deletion of saved artifacts. CPU unit tests do not validate GPU kernels, scientific WebAssembly packages or browser IndexedDB.

The real Neon authentication integration test is separately opt-in through `AUTH_TEST_DATABASE_URL`; it is unrelated to model correctness. Record successful, failed, skipped and unexecuted checks distinctly. Update the README model table and limitations only for behavior actually implemented and verified.
