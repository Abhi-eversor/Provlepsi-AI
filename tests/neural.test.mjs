import assert from 'node:assert/strict';
import { before, test } from 'node:test';
import * as tf from '@tensorflow/tfjs';
import { buildNeuralModel, fitTargetScaler, neuralWindows, fitNeuralModel, recursiveNeuralForecast } from '../src/lib/neural-models.ts';

before(async () => { await tf.setBackend('cpu'); await tf.ready(); });
const settings = { lookback: 4, epochs: 2, seed: 42 };

test('target scaler handles constants and rejects absent or overflowing targets', () => {
  assert.deepEqual(fitTargetScaler([2, null, 4]), { min: 2, range: 2 });
  assert.deepEqual(fitTargetScaler([7, 7, 7]), { min: 7, range: 1 });
  assert.throws(() => fitTargetScaler([null, NaN]), /No finite/);
  assert.throws(() => fitTargetScaler([-1e308, 1e308]), /numeric range/);
});

test('sliding windows preserve dropped-row gaps and reject insufficient history', () => {
  const values = [0, 1, 2, 3, 4, 5, null, 7, 8, 9, 10, 11, 12];
  const { inputs, targets } = neuralWindows(values, 4, { min: 0, range: 1 });
  assert.deepEqual(targets, [[4], [5], [11], [12]]);
  assert.deepEqual(inputs[2], [[7], [8], [9], [10]]);
  assert.throws(() => neuralWindows([0, 1, null, 3, 4, 5], 4, { min: 0, range: 1 }), /consecutive/);
});

test('Transformer predictions depend on values and their ordering', async () => {
  const before = tf.memory().numTensors;
  const model = buildNeuralModel('transformer', settings);
  const xs = tf.tensor3d([
    [[0], [0], [0], [0]], [[1], [1], [1], [1]],
    [[0], [1], [0], [1]], [[1], [0], [1], [0]],
  ]);
  const prediction = model.predict(xs);
  try {
    assert.deepEqual(prediction.shape, [4, 1]);
    const values = Array.from(await prediction.data());
    assert.ok(values.every(Number.isFinite));
    assert.ok(Math.abs(values[0] - values[1]) > 1e-4, 'distinct values must not collapse under layer normalization');
    assert.ok(Math.abs(values[2] - values[3]) > 1e-4, 'positional representation must distinguish reversed windows');
  } finally { prediction.dispose(); xs.dispose(); model.dispose(); }
  assert.equal(tf.memory().numTensors, before);
});

test('all five neural families fit with finite gradients, forecast recursively, and release tensors', async () => {
  const values = Array.from({ length: 20 }, (_, index) => index / 20);
  for (const modelId of ['lstm', 'gru', 'lstmGruHybrid', 'bilstm', 'transformer']) {
    const before = tf.memory().numTensors;
    const losses = [];
    const fitted = await fitNeuralModel(modelId, values, settings, 'evaluation', (_, logs) => losses.push(logs.loss));
    try {
      assert.equal(losses.length, 2);
      assert.ok(losses.every(Number.isFinite), modelId);
      assert.ok(losses[1] < losses[0], `${modelId} must reduce loss on this controlled training fixture`);
      const forecast = await recursiveNeuralForecast(fitted.model, values, fitted.scaler, 4, 5);
      assert.equal(forecast.length, 5);
      assert.ok(forecast.every(Number.isFinite), modelId);
      await assert.rejects(recursiveNeuralForecast(fitted.model, [1, 2, null, 4], fitted.scaler, 4, 2), /last 4/);
    } finally { fitted.model.dispose(); }
    assert.equal(tf.memory().numTensors, before, `${modelId} leaked tensors`);
  }
});

test('custom Transformer layers survive weight serialization and reload', async () => {
  const before = tf.memory().numTensors;
  const model = buildNeuralModel('transformer', settings);
  let artifacts;
  let loaded;
  const xs = tf.tensor3d([[[0.1], [0.2], [0.3], [0.4]]]);
  try {
    await model.save(tf.io.withSaveHandler(async value => {
      artifacts = value;
      return { modelArtifactsInfo: tf.io.getModelArtifactsInfoForJSON(value) };
    }));
    loaded = await tf.loadLayersModel(tf.io.fromMemory(artifacts));
    const original = model.predict(xs);
    const restored = loaded.predict(xs);
    try {
      assert.deepEqual(Array.from(await restored.data()), Array.from(await original.data()));
    } finally { original.dispose(); restored.dispose(); }
  } finally { xs.dispose(); loaded?.dispose(); model.dispose(); }
  assert.equal(tf.memory().numTensors, before);
});

test('seeded CPU training repeats and evaluation scaler excludes unseen future values', async () => {
  const before = tf.memory().numTensors;
  const training = Array.from({ length: 20 }, (_, index) => index / 20);
  const first = await fitNeuralModel('transformer', training, settings, 'evaluation');
  const second = await fitNeuralModel('transformer', training, settings, 'evaluation');
  try {
    assert.deepEqual(first.scaler, { min: 0, range: 0.95 });
    assert.deepEqual(await recursiveNeuralForecast(first.model, training, first.scaler, 4, 3),
      await recursiveNeuralForecast(second.model, training, second.scaler, 4, 3));
    // A separate final fit can use newly observed values; it cannot mutate the evaluation artifact.
    const finalScaler = fitTargetScaler([...training, 100]);
    assert.equal(finalScaler.range, 100);
    assert.equal(first.scaler.range, 0.95);
  } finally { first.model.dispose(); second.model.dispose(); }
  assert.equal(tf.memory().numTensors, before);
});

test('training failures release model, optimizer and input tensors', async () => {
  const before = tf.memory().numTensors;
  await assert.rejects(fitNeuralModel('transformer', Array.from({ length: 20 }, (_, index) => index), settings,
    'evaluation', () => { throw new Error('test callback failure'); }), /test callback failure/);
  assert.equal(tf.memory().numTensors, before);
});
