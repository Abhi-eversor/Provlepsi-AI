import * as tf from '@tensorflow/tfjs';
import type { DeepModelId } from '../types/forecasting';

export interface NeuralSettings { lookback: number; epochs: number; seed: number; units?: number }
export interface TargetScaler { min: number; range: number }
export type TrainingProgress = (epoch: number, logs: Record<string, number>, phase: 'evaluation' | 'final') => void;

/** Serializable sinusoidal positions preserve the order of observations. */
class TimeSeriesPositions extends tf.layers.Layer {
  static className = 'ProvlepsiTimeSeriesPositions';
  computeOutputShape(inputShape: tf.Shape | tf.Shape[]): tf.Shape | tf.Shape[] { return inputShape; }
  call(inputs: tf.Tensor | tf.Tensor[]): tf.Tensor {
    const input = Array.isArray(inputs) ? inputs[0] : inputs;
    const [, length, dimensions] = input.shape;
    if (!length || !dimensions) throw new Error('Transformer requires a fixed window and embedding dimension.');
    return tf.tidy(() => {
      const positions = Array.from({ length }, (_, position) =>
        Array.from({ length: dimensions }, (_, dimension) => {
          const angle = position / Math.pow(10000, (2 * Math.floor(dimension / 2)) / dimensions);
          return dimension % 2 === 0 ? Math.sin(angle) : Math.cos(angle);
        }));
      return input.add(tf.tensor2d(positions));
    });
  }
}

/** Batched, scaled dot-product attention; embedding dimensions stay intact. */
class ScaledTimeSeriesAttention extends tf.layers.Layer {
  static className = 'ProvlepsiScaledTimeSeriesAttention';
  computeOutputShape(inputShape: tf.Shape | tf.Shape[]): tf.Shape { return (inputShape as tf.Shape[])[0]; }
  call(inputs: tf.Tensor | tf.Tensor[]): tf.Tensor {
    if (!Array.isArray(inputs) || inputs.length !== 3) throw new Error('Attention requires query, key and value.');
    const [query, key, value] = inputs;
    const dimensions = query.shape[2];
    if (!dimensions) throw new Error('Attention requires an embedding dimension.');
    return tf.tidy(() => {
      const scores = tf.matMul(query, key, false, true).div(Math.sqrt(dimensions));
      return tf.matMul(tf.softmax(scores, -1), value);
    });
  }
}
tf.serialization.registerClass(TimeSeriesPositions);
tf.serialization.registerClass(ScaledTimeSeriesAttention);

export function buildNeuralModel(modelId: DeepModelId, settings: NeuralSettings): tf.LayersModel {
  const { lookback, seed } = settings;
  const units = settings.units ?? 50;
  if (!Number.isInteger(lookback) || lookback < 2 || lookback > 120 ||
      !Number.isInteger(units) || units < 4 || units > 128 || !Number.isInteger(seed)) {
    throw new Error('Invalid neural lookback, units or seed.');
  }
  let nextSeed = seed;
  const dense = (size: number, activation: 'linear' | 'relu' = 'linear') => tf.layers.dense({
    units: size, activation, kernelInitializer: tf.initializers.glorotUniform({ seed: nextSeed++ }),
  });
  const recurrentOptions = (size: number, returnSequences: boolean) => ({
    units: size, returnSequences,
    kernelInitializer: tf.initializers.glorotUniform({ seed: nextSeed++ }),
    recurrentInitializer: tf.initializers.orthogonal({ seed: nextSeed++ }),
  });
  const input = tf.input({ shape: [lookback, 1] });
  let encoded: tf.SymbolicTensor;
  switch (modelId) {
    case 'lstm':
      encoded = tf.layers.lstm(recurrentOptions(units, false)).apply(input) as tf.SymbolicTensor;
      break;
    case 'gru':
      encoded = tf.layers.gru(recurrentOptions(units, false)).apply(input) as tf.SymbolicTensor;
      break;
    case 'lstmGruHybrid': {
      const sequence = tf.layers.lstm(recurrentOptions(units, true)).apply(input) as tf.SymbolicTensor;
      encoded = tf.layers.gru(recurrentOptions(Math.max(8, Math.round(units / 2)), false)).apply(sequence) as tf.SymbolicTensor;
      break;
    }
    case 'bilstm':
      encoded = tf.layers.bidirectional({ layer: tf.layers.lstm(recurrentOptions(units, false)), mergeMode: 'concat' })
        .apply(input) as tf.SymbolicTensor;
      break;
    case 'transformer': {
      const dimensions = 16;
      const embedding = dense(dimensions).apply(input) as tf.SymbolicTensor;
      const positions = new TimeSeriesPositions({}).apply(embedding) as tf.SymbolicTensor;
      const query = dense(dimensions).apply(positions) as tf.SymbolicTensor;
      const key = dense(dimensions).apply(positions) as tf.SymbolicTensor;
      const value = dense(dimensions).apply(positions) as tf.SymbolicTensor;
      const attention = new ScaledTimeSeriesAttention({}).apply([query, key, value]) as tf.SymbolicTensor;
      const projection = dense(dimensions).apply(attention) as tf.SymbolicTensor;
      const residual = tf.layers.add().apply([positions, projection]) as tf.SymbolicTensor;
      const normalized = tf.layers.layerNormalization({ axis: -1, epsilon: 1e-5 }).apply(residual) as tf.SymbolicTensor;
      const feedForward = dense(dimensions * 2, 'relu').apply(normalized) as tf.SymbolicTensor;
      const projected = dense(dimensions).apply(feedForward) as tf.SymbolicTensor;
      const finalResidual = tf.layers.add().apply([normalized, projected]) as tf.SymbolicTensor;
      const finalNormalized = tf.layers.layerNormalization({ axis: -1, epsilon: 1e-5 }).apply(finalResidual) as tf.SymbolicTensor;
      encoded = tf.layers.flatten().apply(finalNormalized) as tf.SymbolicTensor;
      break;
    }
    default: throw new Error(`Unsupported neural model: ${modelId}`);
  }
  const output = dense(1).apply(encoded) as tf.SymbolicTensor;
  const model = tf.model({ inputs: input, outputs: output });
  // A named optimizer is owned/disposed by LayersModel (an injected optimizer is not).
  model.compile({ optimizer: 'adam', loss: 'meanSquaredError' });
  return model;
}

export function fitTargetScaler(values: (number | null)[]): TargetScaler {
  const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
  if (!finite.length) throw new Error('No finite target observations remain after preprocessing.');
  const min = Math.min(...finite);
  const range = Math.max(...finite) - min || 1;
  if (!Number.isFinite(range)) throw new Error('Target values exceed the supported numeric range. Rescale the source values first.');
  return { min, range };
}

export function neuralWindows(values: (number | null)[], lookback: number, scaler: TargetScaler) {
  const inputs: number[][][] = [];
  const targets: number[][] = [];
  for (let position = lookback; position < values.length; position++) {
    const window = values.slice(position - lookback, position + 1);
    // Gaps remain in their original positions; never concatenate disconnected observations.
    if (window.some(value => value === null || !Number.isFinite(value))) continue;
    const scaled = (window as number[]).map(value => (value - scaler.min) / scaler.range);
    inputs.push(scaled.slice(0, lookback).map(value => [value]));
    targets.push([scaled[lookback]]);
  }
  if (inputs.length < 2) throw new Error(`Need at least ${lookback + 2} consecutive valid target observations for neural training. Choose forward fill or a shorter lookback.`);
  return { inputs, targets };
}

export async function fitNeuralModel(
  modelId: DeepModelId, values: (number | null)[], settings: NeuralSettings,
  phase: 'evaluation' | 'final', progressCallback?: TrainingProgress,
): Promise<{ model: tf.LayersModel; scaler: TargetScaler; windowCount: number }> {
  if (!Number.isInteger(settings.epochs) || settings.epochs < 1 || settings.epochs > 100) {
    throw new Error('Neural training epochs must be between 1 and 100.');
  }
  const scaler = fitTargetScaler(values);
  const { inputs, targets } = neuralWindows(values, settings.lookback, scaler);
  const model = buildNeuralModel(modelId, settings);
  const xs = tf.tensor3d(inputs);
  const ys = tf.tensor2d(targets);
  try {
    await model.fit(xs, ys, {
      epochs: settings.epochs, batchSize: Math.min(16, inputs.length), shuffle: false,
      callbacks: { onEpochEnd: (epoch, logs) => {
        if (logs && Object.values(logs).some(value => !Number.isFinite(value))) {
          throw new Error('Neural training produced a non-finite loss. Try different preprocessing or model settings.');
        }
        progressCallback?.(epoch + 1, logs ?? {}, phase);
      } },
    });
    return { model, scaler, windowCount: inputs.length };
  } catch (error) {
    model.dispose();
    throw error;
  } finally {
    xs.dispose();
    ys.dispose();
  }
}

export async function recursiveNeuralForecast(
  model: tf.LayersModel, values: (number | null)[], scaler: TargetScaler, lookback: number, horizon: number,
): Promise<number[]> {
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 1000) throw new Error('Forecast horizon must be between 1 and 1000 observations.');
  const context = values.slice(-lookback);
  if (context.length !== lookback || context.some(value => value === null || !Number.isFinite(value))) {
    throw new Error(`The last ${lookback} target observations must be valid for forecasting. Choose forward fill or adjust the selected data.`);
  }
  const window = (context as number[]).map(value => (value - scaler.min) / scaler.range);
  const forecast: number[] = [];
  for (let step = 0; step < horizon; step++) {
    const prediction = tf.tidy(() => {
      const output = model.predict(tf.tensor3d([window.map(value => [value])])) as tf.Tensor;
      return output.reshape([]);
    });
    let scaled: number;
    try { scaled = (await prediction.data())[0]; } finally { prediction.dispose(); }
    const value = scaled * scaler.range + scaler.min;
    if (!Number.isFinite(value)) throw new Error('Recursive forecast became non-finite. Try a shorter horizon or another model.');
    forecast.push(value);
    window.shift();
    window.push(scaled);
  }
  return forecast;
}
