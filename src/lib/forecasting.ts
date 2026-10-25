import type { FittedPreprocessing, Metrics, ModelId, ModelResult, ParsedDataset, PreparedPartition, PreparedRun, PreprocessingOptions, RunSettings, WorkerTrainingResult } from '../types/forecasting';

export const DEFAULT_SETTINGS: RunSettings = {
  splitFraction: 0.2, horizon: 10, lookback: 10, maxRows: 300, epochs: 10, seed: 42,
  rfEstimators: 100, rfMaxDepth: 0, rfMinSamplesSplit: 2,
};
export const DEFAULT_PREPROCESSING: PreprocessingOptions = { missingValueStrategy: 'ffill', outlierStrategy: 'none' };

export function validateSettings(settings: RunSettings) {
  const bounds: [keyof RunSettings, number, number][] = [
    ['horizon', 1, 100], ['lookback', 2, 50], ['maxRows', 50, 2000], ['epochs', 1, 100],
    ['seed', 0, 2147483647], ['rfEstimators', 10, 1000], ['rfMaxDepth', 0, 100], ['rfMinSamplesSplit', 2, 20],
  ];
  for (const [key, minimum, maximum] of bounds) {
    if (!Number.isInteger(settings[key]) || settings[key] < minimum || settings[key] > maximum) {
      throw new Error(`${key} must be an integer from ${minimum} to ${maximum}.`);
    }
  }
  if (!Number.isFinite(settings.splitFraction) || settings.splitFraction < 0.05 || settings.splitFraction > 0.5) {
    throw new Error('Test fraction must be between 0.05 and 0.5.');
  }
}

function quantile(sorted: number[], fraction: number) {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

/** Fit on this historical partition only. Dropped rows remain gaps on the original grid. */
export function fitPreprocessing(partition: PreparedPartition, options: PreprocessingOptions): { partition: PreparedPartition; fitted: FittedPreprocessing } {
  const width = (partition.features[0]?.length ?? 0) + 1;
  const rows = partition.target.map((target, i) => [target, ...partition.features[i]]);
  const fitted: FittedPreprocessing = { means: [], lowerBounds: [], upperBounds: [], filledValues: 0, clippedValues: 0, droppedRows: 0 };
  for (let column = 0; column < width; column++) {
    const valid = rows.map(row => row[column]).filter((value): value is number => value !== null && Number.isFinite(value)).sort((a, b) => a - b);
    if (!valid.length) throw new Error(column === 0 ? 'The training target contains no finite observations.' : 'A numeric feature contains no finite training observations.');
    const mean = valid.reduce((sum, value) => sum + value / valid.length, 0);
    if (!Number.isFinite(mean)) throw new Error('Values are too large to preprocess safely. Rescale the input.');
    fitted.means.push(mean);
    if (options.outlierStrategy === 'none') {
      fitted.lowerBounds.push(null); fitted.upperBounds.push(null);
    } else {
      const q1 = quantile(valid, 0.25), q3 = quantile(valid, 0.75), iqr = q3 - q1;
      const lower = q1 - 1.5 * iqr, upper = q3 + 1.5 * iqr;
      if (![q1, q3, iqr, lower, upper].every(Number.isFinite)) throw new Error('Values are too large for IQR preprocessing. Rescale the input.');
      fitted.lowerBounds.push(lower); fitted.upperBounds.push(upper);
    }
    let previous: number | null = null;
    const positions = options.missingValueStrategy === 'bfill' ? rows.map((_, i) => i).reverse() : rows.map((_, i) => i);
    for (const i of positions) {
      const value = rows[i][column];
      if (value !== null) previous = value;
      else if (options.missingValueStrategy !== 'drop') {
        rows[i][column] = options.missingValueStrategy === 'mean' ? mean : previous ?? mean;
        fitted.filledValues++;
      }
    }
  }
  for (const row of rows) {
    let drop = row.some(value => value === null);
    for (let column = 0; column < width; column++) {
      const value = row[column], lower = fitted.lowerBounds[column], upper = fitted.upperBounds[column];
      if (value !== null && lower !== null && upper !== null && (value < lower || value > upper)) {
        if (options.outlierStrategy === 'drop') drop = true;
        else if (options.outlierStrategy === 'clip') {
          row[column] = Math.max(lower, Math.min(upper, value));
          fitted.clippedValues++;
        }
      }
    }
    if (drop) { row.fill(null); fitted.droppedRows++; }
  }
  return { partition: { indices: [...partition.indices], target: rows.map(row => row[0]), features: rows.map(row => row.slice(1)) }, fitted };
}

export function prepareRun(parsed: ParsedDataset, options: PreprocessingOptions, settings: RunSettings): PreparedRun {
  validateSettings(settings);
  if (!['ffill', 'bfill', 'mean', 'drop'].includes(options.missingValueStrategy) || !['none', 'clip', 'drop'].includes(options.outlierStrategy)) throw new Error('Unknown preprocessing strategy.');
  const length = parsed.target.length;
  if (parsed.indices.length !== length || parsed.features.length !== length || parsed.sourceRowCount !== length) throw new Error('Dataset row metadata is inconsistent.');
  parsed.target.forEach((value, i) => {
    if (parsed.indices[i] !== i || parsed.features[i].length !== parsed.featureNames.length || [value, ...parsed.features[i]].some(v => v !== null && !Number.isFinite(v))) throw new Error('Dataset must contain finite numeric values or missing values on its original row grid.');
  });
  const start = Math.max(0, length - settings.maxRows);
  const retained = length - start;
  const split = Math.floor(retained * (1 - settings.splitFraction));
  if (split < settings.lookback + 3 || retained - split < 1) throw new Error(`Not enough history: need at least ${settings.lookback + 3} training rows plus a nonempty holdout. Reduce lookback or provide more data.`);
  // Selecting usable feature columns is based on training observations only.
  const usable = parsed.featureNames.map((_, i) => i).filter(column => parsed.features.slice(start, start + split).some(row => row[column] !== null));
  const partition = (from: number, to: number): PreparedPartition => ({ indices: parsed.indices.slice(from, to), target: parsed.target.slice(from, to), features: parsed.features.slice(from, to).map(row => usable.map(column => row[column])) });
  const training = fitPreprocessing(partition(start, start + split), options);
  const final = fitPreprocessing(partition(start, length), options);
  const actual = parsed.target.slice(start + split);
  const baselineValue = parsed.target.slice(start, start + split).reverse().find((value): value is number => value !== null);
  if (baselineValue === undefined) throw new Error('The training target contains no finite observations.');
  if (!actual.some(value => value !== null)) throw new Error('The holdout contains no observed target values to evaluate.');
  const warnings: string[] = [];
  if (length > retained) warnings.push(`Using the last ${retained} of ${length} rows for every selected model.`);
  if (usable.length !== parsed.featureNames.length) warnings.push('Numeric features without any training observations were excluded.');
  if (options.missingValueStrategy === 'bfill') warnings.push('Backward fill uses later observations within known training history only; validation targets are never filled.');
  if (training.fitted.droppedRows || final.fitted.droppedRows) warnings.push('Dropping applies to the complete selected numeric row, including covariates. Excluded rows retain their time positions as gaps. Lag windows crossing gaps are excluded; missing final context can prevent forecasting.');
  if (actual.some(value => value === null)) warnings.push('Missing holdout targets are excluded from metric counts, never imputed or clipped.');
  return {
    train: training.partition, validation: { indices: parsed.indices.slice(start + split), actual }, final: final.partition,
    history: parsed.indices.slice(start).map((index, i) => ({ index, value: parsed.target[start + i] })),
    featureNames: usable.map(i => parsed.featureNames[i]), targetColumn: parsed.targetColumn,
    sourceRowCount: length, effectiveRowCount: retained, config: { ...settings }, preprocessing: { ...options },
    trainPreprocessing: training.fitted, finalPreprocessing: final.fitted, warnings, baselineValue, sourceSha256: parsed.sourceSha256,
  };
}

export function calculateMetrics(actual: (number | null)[], predicted: number[]): Metrics {
  if (actual.length !== predicted.length || predicted.some(value => !Number.isFinite(value))) throw new Error('Predictions must be finite and match the evaluation period.');
  let squared = 0, absolute = 0, n = 0;
  actual.forEach((value, i) => {
    if (value === null) return;
    const error = value - predicted[i]; squared += error * error; absolute += Math.abs(error); n++;
  });
  if (!n || !Number.isFinite(squared) || !Number.isFinite(absolute)) throw new Error('No finite evaluation metrics are available. Check missing values and numeric ranges.');
  return { rmse: Math.sqrt(squared / n), mae: absolute / n, n };
}

export function persistenceBaseline(training: (number | null)[], actual: (number | null)[]): Metrics {
  const last = [...training].reverse().find((value): value is number => value !== null && Number.isFinite(value));
  if (last === undefined) throw new Error('No last observation is available for the baseline.');
  return calculateMetrics(actual, actual.map(() => last));
}

export function baselineForRun(run: PreparedRun): Metrics {
  return calculateMetrics(run.validation.actual, run.validation.actual.map(() => run.baselineValue));
}

export function createModelResult(modelId: ModelId, runId: string, datasetId: string, run: PreparedRun, output: WorkerTrainingResult): ModelResult {
  if (output.forecast.length !== run.config.horizon || output.forecast.some(value => !Number.isFinite(value))) throw new Error('The model returned an invalid forecast.');
  // Recompute centrally so every engine uses the same truth, mask and metric definition.
  const metrics = calculateMetrics(run.validation.actual, output.evaluationPredictions);
  const last = run.final.indices[run.final.indices.length - 1];
  return {
    modelId, runId, datasetId, targetColumn: run.targetColumn, metrics, baseline: baselineForRun(run),
    forecast: output.forecast.map((value, i) => ({ index: last + i + 1, value })), history: run.history,
    evaluation: { protocol: 'fixed-origin-recursive', actual: run.validation.indices.map((index, i) => ({ index, value: run.validation.actual[i] })), predicted: run.validation.indices.map((index, i) => ({ index, value: output.evaluationPredictions[i] })), horizon: run.validation.indices.length, trainStart: run.train.indices[0], trainEnd: run.train.indices[run.train.indices.length - 1] },
    config: { ...run.config }, preprocessing: { ...run.preprocessing }, trainPreprocessing: run.trainPreprocessing, finalPreprocessing: run.finalPreprocessing,
    sourceRowCount: run.sourceRowCount, effectiveRowCount: run.effectiveRowCount, modelName: output.modelName, artifact: output.artifact,
    warnings: [...run.warnings, ...(output.warnings ?? [])], createdAt: new Date().toISOString(), pipelineVersion: 2, sourceSha256: run.sourceSha256,
  };
}
