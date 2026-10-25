import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_SETTINGS, DEFAULT_PREPROCESSING, prepareRun, calculateMetrics, persistenceBaseline, createModelResult } from '../src/lib/forecasting.ts';

function dataset(count = 100, transform = i => i) {
  return { indices: Array.from({ length: count }, (_, i) => i), target: Array.from({ length: count }, (_, i) => transform(i)), features: Array.from({ length: count }, () => []), featureNames: [], sourceRowCount: count, targetColumn: 'target' };
}
test('holdout changes cannot affect training preprocessing or prepared training values', () => {
  for (const missingValueStrategy of ['ffill', 'bfill', 'mean', 'drop']) {
    for (const outlierStrategy of ['none', 'clip', 'drop']) {
      const original = dataset(100, i => i === 5 || i === 79 ? null : i);
      const changed = structuredClone(original);
      changed.target.fill(1e6, 80);
      const options = { missingValueStrategy, outlierStrategy };
      const a = prepareRun(original, options, DEFAULT_SETTINGS);
      const b = prepareRun(changed, options, DEFAULT_SETTINGS);
      assert.deepEqual(a.train, b.train);
      assert.deepEqual(a.trainPreprocessing, b.trainPreprocessing);
      assert.equal(a.validation.actual[0], 80);
      assert.equal(b.validation.actual[0], 1e6);
    }
  }
});
test('training cap preserves source indices and forecasts follow the actual final observation', () => {
  const run = prepareRun(dataset(1000), DEFAULT_PREPROCESSING, DEFAULT_SETTINGS);
  assert.equal(run.train.indices[0], 700);
  assert.equal(run.history.at(-1).index, 999);
  const output = { metrics: { rmse: 0, mae: 0, n: 0 }, baseline: { rmse: 0, mae: 0, n: 0 }, evaluationPredictions: [...run.validation.actual], forecast: Array(10).fill(1000) };
  const result = createModelResult('linear', 'run', 'project', run, output);
  assert.equal(result.forecast[0].index, 1000);
  assert.equal(result.forecast.at(-1).index, 1009);
  assert.equal(result.metrics.n, run.validation.actual.length);
  assert.equal(result.metrics.rmse, 0);
  assert.equal(result.evaluation.trainEnd, 939);
  assert.equal(result.pipelineVersion, 2);
});
test('row dropping preserves gaps rather than changing sampling positions', () => {
  const raw = dataset(100, i => i === 20 ? null : i);
  const run = prepareRun(raw, { missingValueStrategy: 'drop', outlierStrategy: 'none' }, DEFAULT_SETTINGS);
  assert.equal(run.train.indices.length, 80);
  assert.equal(run.train.indices[20], 20);
  assert.equal(run.train.target[20], null);
  assert.equal(run.trainPreprocessing.droppedRows, 1);
  assert.equal(raw.target[20], null);
});
test('outlier handling never clips held-out truth and raw data stays unchanged', () => {
  const raw = dataset(100, i => i === 20 || i === 95 ? 10000 : i);
  const snapshot = structuredClone(raw);
  const run = prepareRun(raw, { missingValueStrategy: 'mean', outlierStrategy: 'clip' }, DEFAULT_SETTINGS);
  assert.ok(run.train.target[20] < 10000);
  assert.equal(run.validation.actual[15], 10000);
  assert.deepEqual(raw, snapshot);
});
test('leading missing observations use fitted historical mean, no future holdout values', () => {
  const run = prepareRun(dataset(100, i => i === 0 ? null : i), DEFAULT_PREPROCESSING, DEFAULT_SETTINGS);
  assert.equal(run.train.target[0], run.trainPreprocessing.means[0]);
  assert.equal(run.trainPreprocessing.filledValues, 1);
});
test('features without training observations are excluded using training only', () => {
  const raw = dataset(); raw.featureNames = ['futureOnly']; raw.features = raw.indices.map(i => [i < 80 ? null : 123]);
  const run = prepareRun(raw, DEFAULT_PREPROCESSING, DEFAULT_SETTINGS);
  assert.deepEqual(run.featureNames, []);
  assert.ok(run.warnings.some(w => w.includes('excluded')));
});
test('metrics exclude missing truths and reject empty/nonfinite outputs', () => {
  assert.deepEqual(calculateMetrics([1, null, 5], [2, 99, 3]), { rmse: Math.sqrt(2.5), mae: 1.5, n: 2 });
  assert.throws(() => calculateMetrics([null], [1]), /No finite/);
  assert.throws(() => calculateMetrics([1], [NaN]), /finite/);
  assert.throws(() => calculateMetrics([1], []), /match/);
  assert.equal(persistenceBaseline([2, 3, null], [3, 3]).rmse, 0);
});
test('short, nonfinite, inconsistent, and invalid-parameter inputs fail with actionable errors', () => {
  assert.throws(() => prepareRun(dataset(10), DEFAULT_PREPROCESSING, DEFAULT_SETTINGS), /Not enough/);
  assert.throws(() => prepareRun(dataset(100, () => null), DEFAULT_PREPROCESSING, DEFAULT_SETTINGS), /training target/);
  assert.throws(() => prepareRun(dataset(100, () => Infinity), DEFAULT_PREPROCESSING, DEFAULT_SETTINGS), /finite numeric/);
  for (const config of [{ horizon: 0 }, { epochs: 1.5 }, { splitFraction: 0.9 }, { maxRows: 20 }]) {
    assert.throws(() => prepareRun(dataset(), DEFAULT_PREPROCESSING, { ...DEFAULT_SETTINGS, ...config }));
  }
});
test('extreme finite values cannot create invalid exported preprocessing bounds', () => {
  assert.throws(() => prepareRun(dataset(100, i => i % 2 ? 1e308 : -1e308), { missingValueStrategy: 'mean', outlierStrategy: 'clip' }, DEFAULT_SETTINGS), /Rescale/);
});
