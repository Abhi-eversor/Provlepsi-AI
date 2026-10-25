import * as Comlink from 'comlink';
import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import '@tensorflow/tfjs-backend-webgl';
import { calculateMetrics, baselineForRun } from '../lib/forecasting';
import { fitNeuralModel, recursiveNeuralForecast, type TrainingProgress } from '../lib/neural-models';
import type { DeepModelId, PreparedRun, WorkerTrainingResult } from '../types/forecasting';

let initialization: Promise<string> | null = null;
let training = false;

async function initializeBackend(progressCallback?: (message: string) => void): Promise<string> {
  if (!initialization) {
    initialization = (async () => {
      for (const backend of ['webgpu', 'webgl', 'cpu']) {
        try {
          if (!await tf.setBackend(backend)) continue;
          await tf.ready();
          // A registered backend may still fail when its first kernel runs.
          const probe = tf.tidy(() => tf.scalar(2).square());
          try { if ((await probe.data())[0] !== 4) continue; } finally { probe.dispose(); }
          progressCallback?.(`TensorFlow.js is using ${backend}${backend === 'cpu' ? ' (GPU unavailable; training may be slower)' : ''}.`);
          return backend;
        } catch {
          progressCallback?.(`${backend} is unavailable; trying the next backend.`);
        }
      }
      throw new Error('No working TensorFlow.js backend is available in this browser.');
    })();
  }
  try { return await initialization; } catch (error) { initialization = null; throw error; }
}

const tfjsAPI = {
  async init(progressCallback?: (message: string) => void) { return initializeBackend(progressCallback); },

  async trainModel(
    modelId: DeepModelId, run: PreparedRun, modelKey: string, progressCallback?: TrainingProgress,
  ): Promise<WorkerTrainingResult> {
    if (training) throw new Error('A neural training run is already active. Cancel it before starting another.');
    const path = modelKey.split('/');
    if (path.length !== 5 || path[0] !== 'provlepsi' || !/^[1-9]\d*$/.test(path[1]) ||
        !/^[a-f\d-]{36}$/i.test(path[2]) || !/^[a-f\d-]{36}$/i.test(path[3]) || path[4] !== modelId) {
      throw new Error('Neural model storage requires an account/project scoped model key.');
    }
    training = true;
    try {
      const backend = await initializeBackend();
      const { lookback, epochs, seed, horizon } = run.config;
      const settings = { lookback, epochs, seed, units: modelId === 'transformer' ? 16 : 50 };
      if (!run.validation.actual.length) throw new Error('A non-empty chronological holdout is required.');
      const evaluation = await fitNeuralModel(modelId, run.train.target, settings, 'evaluation', progressCallback);
      let evaluationPredictions: number[];
      try {
        evaluationPredictions = await recursiveNeuralForecast(
          evaluation.model, run.train.target, evaluation.scaler, lookback, run.validation.actual.length,
        );
      } finally { evaluation.model.dispose(); }
      const metrics = calculateMetrics(run.validation.actual, evaluationPredictions);
      const baseline = baselineForRun(run);
      // Final forecasts use a separate model and scaler fitted to all known observations.
      const final = await fitNeuralModel(modelId, run.final.target, settings, 'final', progressCallback);
      try {
        const forecast = await recursiveNeuralForecast(final.model, run.final.target, final.scaler, lookback, horizon);
        try { await final.model.save(`indexeddb://${modelKey}`); } catch {
          throw new Error('Could not save the trained model in browser storage. Check available storage and browser privacy settings.');
        }
        return {
          metrics, baseline, evaluationPredictions, forecast, modelName: modelKey,
          artifact: {
            modelKey, modelId, backend, tensorflowVersion: tf.version.tfjs, settings,
            evaluationScaler: evaluation.scaler, finalScaler: final.scaler,
            evaluationWindows: evaluation.windowCount, finalWindows: final.windowCount,
            input: 'target-only', transformerEmbedding: modelId === 'transformer' ? 16 : undefined,
            trainingOrder: 'chronological-no-shuffle',
          },
          warnings: [
            ...(backend === 'cpu' ? ['GPU acceleration unavailable; CPU backend was used.'] : []),
            ...(run.featureNames.length ? ['Neural models use target history only; additional numeric feature columns are ignored as model inputs.'] : []),
            'Seeded initialization and fixed sample order improve repeatability; GPU/browser floating-point results can still differ.',
          ],
        };
      } finally { final.model.dispose(); }
    } finally { training = false; }
  },
};

export type TfjsAPI = typeof tfjsAPI;
Comlink.expose(tfjsAPI);
