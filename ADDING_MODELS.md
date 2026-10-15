# Adding models and parameters

Provlepsi-AI runs dataset parsing and model training in browser workers. Authentication and account storage are server-side. This guide describes the integration points in the current source; a model is supported only after its UI, routing, worker implementation and result handling are connected.

The existing forecasting code is experimental. Adding a model does not remove the evaluation, preprocessing or browser limitations documented in [README.md](README.md).

## Choose the worker and check package compatibility

| Worker | Existing model IDs | Role |
| --- | --- | --- |
| `src/workers/pyodide.worker.ts` | `arima`, `boosting`, `linear`, `randomForest` | Statsmodels/scikit-learn through WebAssembly Python. |
| `src/workers/tfjs.worker.ts` | `lstm`, `gru`, `lstmGruHybrid`, `bilstm`, `transformer` | TensorFlow.js layers and browser tensor computation. |

The Python worker loads **Pyodide 0.25.0** from `https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js`. Its runtime and scientific packages are downloaded on demand; npm installation does not install a local Python environment or prebundle those packages.

Check the version-specific [Pyodide package list](https://pyodide.org/en/0.25.0/usage/packages-in-pyodide.html) and [package loading documentation](https://pyodide.org/en/0.25.0/usage/loading-packages.html) before selecting a dependency. Ordinary native Python wheels are not automatically compatible with WebAssembly. XGBoost is present in that distribution, but it is **not integrated into this application**. Prophet is absent from that package list; `loadPackage('prophet')` is not a supported integration recipe.

For either worker, review dependency licensing, browser/backend support, download size and memory requirements. Preserve the versioned runtime unless a separately validated migration is intended.

## 1. Add the model selection entry

In `src/components/StepModelConfig.tsx`:

1. Add a stable model ID to the `selectedModels` initial-state object, usually with `false` as its default.
2. Add a matching card/checkbox using the existing `handleToggle` function and `selectedModels` state.
3. Describe the implemented model accurately. Mark research models as experimental and avoid unsupported performance claims.

For example, a scikit-learn Ridge integration could use the ID `ridge`:

```tsx
// Add this property alongside the existing selectedModels entries:
ridge: false,
```

```tsx
<div onClick={() => handleToggle('ridge')}>
  <input type="checkbox" checked={selectedModels.ridge} readOnly />
  <span>Ridge Regression</span>
</div>
```

Adapt the card to the existing styles and input behavior. `handleContinue` already collects enabled IDs and writes them through `setModelsToTrain`; there is no `toggleModel` helper.

## 2. Route training to the correct worker

`src/components/StepTrain.tsx` runs selected models sequentially. Preserve sequential execution for Pyodide: its input values are written to shared Python globals, so concurrent training would race.

### Python models

Extend the Python-model condition in `runTraining` to include the new ID. The actual worker signature is:

```ts
trainModel(
  modelType: string,
  csvContent: string,
  targetCol: string,
  modelParams: any = {},
  progressCallback?: (message: string) => void
)
```

Pass parameters before the callback, as the existing code does:

```tsx
const pyodide = getPyodideAPI();
if (!pyodide) throw new Error('Pyodide worker unavailable');

const result = await pyodide.trainModel(
  model,
  rawData.rawContent,
  targetColumn,
  modelParams,
  Comlink.proxy((message: string) => {
    setTrainingStatus(previous => ({
      ...previous,
      [model]: { status: 'training', progress: message },
    }));
  })
);
```

This snippet belongs inside the existing training function, where those variables are defined. Passing the callback as argument four would populate `modelParams` incorrectly.

### TensorFlow.js models

Add the new ID to both `DEEP_MODEL_TRAINERS` and `DEEP_MODEL_DISPLAY_NAMES`. The trainer map points to an exported `TfjsAPI` method; its current caller passes:

```ts
trainMyModel(
  data: number[],
  epochs: number,
  unitsOrModelSpecificSize: number,
  progressCallback?: (epoch: number, logs: any) => void
)
```

The existing UI supplies ten epochs and a size argument of 50. Update the caller deliberately if the new method needs a different contract. The target extractor currently receives the raw CSV and uses simple line/comma splitting; account for its limitations rather than assuming full pandas CSV semantics.

## 3. Implement the worker

### Python implementation

In `src/workers/pyodide.worker.ts`:

1. Extend the lazy package-loading branch to include the new ID. A Ridge model would reuse the existing `scikit-learn` package rather than require another runtime.
2. Pass any new validated parameters with `pyodideInstance.globals.set(...)`, following the existing parameter bindings. Do not interpolate user-controlled strings directly into Python source.
3. Add a matching branch inside Python `run_training()`.
4. Validate input size, numeric values and parameter ranges. Construct appropriate chronological training/holdout data and generate the forecast.
5. Set `metrics` and `forecast` before the existing JSON return. Return JSON-compatible finite numbers and surface failures as errors rather than success-shaped empty results.

The current Python pipeline reads the raw CSV, applies fixed forward/backward filling and keeps at most the last 500 rows. Its EDA preprocessing selections are not passed in. If a contribution changes those assumptions, update both the caller and documentation explicitly.

Progress messages can be sent before package loading or fitting. The existing short delays yield execution after a message; they are not a guarantee against deadlocks or failed scientific-library execution. Test the actual package/model in a browser.

### TensorFlow.js implementation

In `src/workers/tfjs.worker.ts`:

1. Add an asynchronous trainer to the `tfjsAPI` object and call `await this.init()` before tensor operations.
2. Prepare chronological sequences and define the layers, compilation and training settings.
3. Report epoch progress with the existing callback contract, including a numeric `loss` if using the unchanged `StepTrain` progress display.
4. Evaluate and forecast in original target units. The existing `evaluateAndForecast` helper expects the worker's sequence/scaling contract and generates ten iterative predictions.
5. Return `metrics` and `forecast`; include `modelName` if saving a model under an `indexeddb://` URL as existing trainers do.
6. Dispose temporary tensors and models when no longer needed, including failure paths. A saved model should not remain allocated merely because its weights were persisted.

`TfjsAPI` is inferred from the exposed object, so a new method becomes part of that type. Keep runtime API methods consistent with `DEEP_MODEL_TRAINERS`.

The shared preparation helper currently uses the last 300 observations, ten-observation windows and a fixed 80/20 split. It fits min/max scaling on the whole retained series, including the holdout. Avoid copying that leakage into a new evaluation design. Saved model weights alone do not preserve a complete forecasting pipeline; a future reload feature also needs preprocessing/scaling metadata and input validation.

The current `transformer` implementation normalizes a single-feature representation, collapsing it to input-independent predictions. Do not use that model as a validated reference architecture.

## 4. Connect results and persistence

Both worker paths must provide the result fields used by `StepTrain.tsx`, the Zustand store and `StepResults.tsx`:

```ts
type ModelResult = {
  metrics: {
    rmse: number;
    mae: number;
  };
  forecast: number[];
};
```

Current forecasts contain ten values. Extend `getModelName` in `StepResults.tsx` for a readable results label; adding a name to the training map does not update that separate helper.

Only successful results are copied into `modelResults`. If result fields or forecast length change, inspect the store type, metric display, graph and CSV export together. The displayed/exported history currently comes from the first 100-row preview, while training can use the full retained tail; do not describe those indices as a verified full-history timeline.

Deep models are saved to IndexedDB, but the UI does not currently expose a model reload/export flow. `storage.saveCleanedData`, `storage.getCleanedData` and `storage.clearAll` are not connected to the wizard. Do not imply those helper methods provide completed user-facing features.

## 5. Add adjustable parameters

For every new parameter:

1. Extend `AppState['modelParams']` in `src/store/useStore.ts` and supply defaults in both initial state and `reset`.
2. Add a control to `StepModelConfig.tsx`, using `setModelParams`.
3. Pass the value from `StepTrain.tsx` to the appropriate worker. Python already receives the `modelParams` object; deep trainers currently receive positional arguments instead.
4. Validate type, finiteness and range in the worker. UI min/max attributes are not sufficient because state is persisted and values can arrive through other callers.
5. Bind it through Python globals or the appropriate TF.js layer/compiler/training option.
6. Document which models consume it. The existing split fraction affects linear regression/random forest, not every model.

Changing persisted state also requires considering existing localStorage values. New defaults must not make an old saved wizard state fail unexpectedly.

## 6. Verify and document the integration

Run the repository checks:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

The current automated tests cover focused authentication security regressions, not model correctness or browser workers. Perform a browser smoke check of upload, model selection, training progress, finite metrics, forecast length, charts and CSV/PNG exports. Check the actual package download and the intended TF.js backend.

For a forecasting evaluation, record the real dataset/source, row ordering, split, preprocessing, seed where supported and error definition. Use held-out chronological observations and fit transformations on training data when making comparison claims. Current ARIMA/boosting training-fit metrics are not equivalent to other models' holdout metrics.

Update the README model table, limitations and third-party notices when support is actually implemented. Keep experiment notes and measured results accurate; package availability, a successful build or a selectable UI card alone do not demonstrate a working forecasting integration.
