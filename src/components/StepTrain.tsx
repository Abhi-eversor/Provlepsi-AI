'use client';

import React, { useEffect, useState } from 'react';
import * as Comlink from 'comlink';
import { Loader2, CheckCircle2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { storage, modelStoragePrefix } from '../lib/storage';
import { getPyodideAPI, getTfjsAPI, startWorkerRun, isWorkerRunCurrent, cancelActiveWorkers, awaitWorkerResult, resetPyodideWorker, resetTfjsWorker } from '../lib/workerHelper';
import { prepareRun, createModelResult } from '../lib/forecasting';
import type { ModelId, ModelResult } from '../types/forecasting';

interface TrainingStatus { status: 'pending' | 'training' | 'done' | 'error'; progress: string; result?: ModelResult }
const pythonModels: ModelId[] = ['arima', 'boosting', 'linear', 'randomForest'];
export default function StepTrain() {
  const { accountId, projectId, datasetId, modelsToTrain, targetColumn, preprocessing, modelParams, setStep, setModelResults } = useStore();
  const [statuses, setStatuses] = useState<Partial<Record<ModelId, TrainingStatus>>>({});
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const generation = startWorkerRun();
    const runId = crypto.randomUUID();
    let mounted = true;
    const active = () => mounted && isWorkerRunCurrent(generation) && useStore.getState().accountId === accountId && useStore.getState().projectId === projectId;
    const update = (model: ModelId, state: TrainingStatus) => { if (active()) setStatuses(previous => ({ ...previous, [model]: state })); };
    setStatuses(Object.fromEntries(modelsToTrain.map(model => [model, { status: 'pending', progress: 'Waiting to start...' }])));
    setFinished(false);
    setError('');
    setModelResults({});
    const run = async () => {
      try {
        if (!accountId || !projectId || !datasetId || !targetColumn || !modelsToTrain.length) throw new Error('Choose a dataset, numeric target, and at least one model.');
        const raw = await storage.getRawDataset(accountId, datasetId);
        if (!active()) return;
        if (!raw) throw new Error('The saved dataset is unavailable. Upload the CSV again.');
        const python = getPyodideAPI();
        if (!python) throw new Error('Python worker is unavailable.');
        const parsed = await awaitWorkerResult(python.parseDataset(raw.rawContent, targetColumn), generation);
        if (!active()) return;
        const prepared = prepareRun(parsed, preprocessing, modelParams);
        await storage.saveCleanedData(accountId, projectId, JSON.stringify(prepared));
        if (!active()) return;
        const completed: Partial<Record<ModelId, ModelResult>> = {};
        for (const model of modelsToTrain) {
          if (!active()) return;
          update(model, { status: 'training', progress: 'Fitting evaluation model and final forecast model...' });
          try {
            const workerResult = pythonModels.includes(model)
              ? await awaitWorkerResult(python.trainModel(model, prepared, Comlink.proxy((message: string) => update(model, { status: 'training', progress: message }))), generation)
              : await (async () => {
                const tf = getTfjsAPI();
                if (!tf) throw new Error('Neural worker is unavailable.');
                const key = `${modelStoragePrefix(accountId, projectId)}${runId}/${model}`;
                return await awaitWorkerResult(tf.trainModel(model as 'lstm' | 'gru' | 'lstmGruHybrid' | 'bilstm' | 'transformer', prepared, key, Comlink.proxy((epoch: number, logs: { loss?: number }, phase: 'evaluation' | 'final') => {
                  const loss = typeof logs?.loss === 'number' && Number.isFinite(logs.loss) ? logs.loss.toFixed(5) : 'pending';
                  update(model, { status: 'training', progress: `${phase} fit: epoch ${epoch}/${modelParams.epochs}; loss ${loss}` });
                })), generation);
              })();
            if (!active()) return;
            const result = createModelResult(model, runId, datasetId, prepared, workerResult);
            completed[model] = result;
            update(model, { status: 'done', progress: 'Evaluation and final refit complete', result });
            // Persist successful models even if a later model fails or is cancelled.
            setModelResults({ ...completed });
          } catch (cause) {
            if (!active()) return;
            update(model, { status: 'error', progress: cause instanceof Error ? cause.message : 'Training failed.' });
          }
        }
      } catch (cause) {
        if (active()) {
          const message = cause instanceof Error ? cause.message : 'Could not prepare this training run.';
          setError(message);
          setStatuses(previous => Object.fromEntries(modelsToTrain.map(model => [model, previous[model]?.status === 'done' ? previous[model] : { status: 'error', progress: message }])));
        }
      } finally {
        if (active()) {
          resetPyodideWorker();
          resetTfjsWorker();
          setFinished(true);
        }
      }
    };
    void run();
    return () => {
      mounted = false;
      if (isWorkerRunCurrent(generation)) cancelActiveWorkers();
    };
  }, [accountId, projectId, datasetId, targetColumn, modelsToTrain, preprocessing, modelParams, setModelResults, retry]);
  const successCount = Object.values(statuses).filter(status => status?.status === 'done').length;
  return (
    <div className="max-w-4xl mx-auto bg-white dark:bg-gray-900 p-6 rounded-xl border dark:border-gray-800">
      <h2 className="text-2xl font-bold mb-4 dark:text-white">Training Models</h2>
      <p className="mb-6 text-sm text-gray-500">Each model is evaluated from the same fixed chronological cutoff, then refitted for future forecasting. Leaving this step stops unfinished work.</p>
      {error && <p role="alert" className="mb-4 text-red-600">{error}</p>}
      <div className="space-y-4 mb-8">
        {modelsToTrain.map(model => {
          const state = statuses[model];
          return <div key={model} className="p-4 border rounded-lg dark:border-gray-700 flex justify-between gap-4">
            <div className="flex gap-3">
              {state?.status === 'training' ? <Loader2 className="text-blue-500 animate-spin shrink-0" /> : state?.status === 'done' ? <CheckCircle2 className="text-green-600 shrink-0" /> : <span className={`w-5 h-5 rounded-full shrink-0 ${state?.status === 'error' ? 'bg-red-400' : 'bg-gray-300'}`} />}
              <div><h3 className="font-semibold dark:text-white">{model}</h3><p className="text-sm text-gray-500 break-words">{state?.progress || 'Waiting...'}</p></div>
            </div>
            {state?.result && <span className="text-sm whitespace-nowrap dark:text-white">RMSE {state.result.metrics.rmse.toFixed(4)}</span>}
          </div>;
        })}
      </div>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4 dark:border-gray-700">
        <button onClick={() => { cancelActiveWorkers(); setStep('MODEL'); }} className="px-4 py-2 rounded bg-gray-100 text-gray-700">{finished ? 'Back to Models' : 'Cancel Training'}</button>
        {finished && <button onClick={() => setRetry(value => value + 1)} className="px-4 py-2 rounded border border-blue-500 text-blue-600">Run Again</button>}
        <button disabled={!finished || !successCount} onClick={() => setStep('RESULTS')} className="px-6 py-2 rounded bg-blue-600 text-white disabled:opacity-50">View Results &amp; Forecast</button>
      </div>
    </div>
  );
}
