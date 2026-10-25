'use client';

import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import type { ModelId, RunSettings } from '../types/forecasting';
import { validateSettings } from '../lib/forecasting';

const models: { id: ModelId; name: string; description: string }[] = [
  { id: 'arima', name: 'ARIMA', description: 'Statsmodels ARIMA(1,1,1); target history only.' },
  { id: 'boosting', name: 'Gradient Boosting', description: 'Scikit-learn histogram boosting with lag features.' },
  { id: 'linear', name: 'Linear Regression', description: 'Scikit-learn regression with lag features; a useful simple comparison.' },
  { id: 'randomForest', name: 'Random Forest', description: 'Scikit-learn lag-feature ensemble with configurable tree settings.' },
  { id: 'lstm', name: 'LSTM', description: 'TensorFlow.js recurrent sequence model.' },
  { id: 'gru', name: 'GRU', description: 'TensorFlow.js gated recurrent sequence model.' },
  { id: 'lstmGruHybrid', name: 'LSTM-GRU Hybrid', description: 'Stacked recurrent layers; more resource intensive.' },
  { id: 'bilstm', name: 'Bi-LSTM', description: 'Reads each historical input window in both directions.' },
  { id: 'transformer', name: 'Transformer (experimental)', description: 'Compact positional self-attention encoder. Forecast quality is not established.' },
];
const fields: { key: keyof RunSettings; label: string; min: number; max: number }[] = [
  { key: 'maxRows', label: 'Maximum history rows (all models)', min: 50, max: 2000 },
  { key: 'horizon', label: 'Future forecast steps', min: 1, max: 100 },
  { key: 'lookback', label: 'Lag/window length', min: 2, max: 50 },
  { key: 'epochs', label: 'Neural training epochs', min: 1, max: 100 },
  { key: 'seed', label: 'Random seed (best effort across backends)', min: 0, max: 2147483647 },
];
export default function StepModelConfig() {
  const { modelsToTrain, setModelsToTrain, setStep, modelParams, setModelParams } = useStore();
  const [selected, setSelected] = useState<ModelId[]>(modelsToTrain.length ? modelsToTrain : ['arima', 'linear', 'lstm']);
  const [error, setError] = useState('');
  const numberField = (key: keyof RunSettings, label: string, min: number, max: number) => <label key={key} className="block text-sm text-gray-700 dark:text-gray-300">
    {label}
    <input aria-label={label} type="number" min={min} max={max} step={1} value={modelParams[key]} onChange={event => {
      const value = Number(event.target.value);
      if (Number.isFinite(value)) setModelParams({ [key]: value });
    }} className="block w-full mt-1 border rounded p-2 dark:bg-gray-800 dark:border-gray-700" />
  </label>;
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
        <h2 className="text-2xl font-bold mb-2 dark:text-white">Model Selection</h2>
        <p className="text-gray-600 dark:text-gray-400 mb-6">Models train sequentially in browser workers. All use the same chronological holdout and fixed-origin recursive evaluation. A last-value baseline is included. Larger windows and neural models can take several minutes.</p>
        <div className="space-y-3 mb-8">
          {models.map(model => <label key={model.id} className={`flex items-center justify-between gap-4 p-4 rounded-lg border-2 cursor-pointer ${selected.includes(model.id) ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-gray-200 dark:border-gray-700'}`}>
            <span><span className="block font-semibold dark:text-white">{model.name}</span><span className="text-sm text-gray-500">{model.description}</span></span>
            <input aria-label={model.name} type="checkbox" checked={selected.includes(model.id)} onChange={() => setSelected(previous => previous.includes(model.id) ? previous.filter(id => id !== model.id) : [...previous, model.id])} className="w-5 h-5" />
          </label>)}
        </div>
        <div className="bg-gray-50 dark:bg-gray-800/50 p-4 rounded-lg border border-gray-200 dark:border-gray-700 mb-6">
          <h3 className="font-semibold mb-4 dark:text-white">Shared Training Settings</h3>
          <label className="block text-sm mb-4 dark:text-gray-300">Chronological test fraction (all models)
            <div className="flex items-center gap-4 mt-2"><input aria-label="Chronological test fraction" type="range" min="0.05" max="0.5" step="0.05" value={modelParams.splitFraction} onChange={event => setModelParams({ splitFraction: Number(event.target.value) })} /><span>{Math.round(modelParams.splitFraction * 100)}% test</span></div>
          </label>
          <div className="grid md:grid-cols-2 gap-4">{fields.map(field => numberField(field.key, field.label, field.min, field.max))}</div>
          <p className="mt-4 text-xs text-gray-500">The last configured rows are used without sorting dates. Test predictions start at one fixed cutoff and do not consume observed test targets. Final future forecasts use a separate refit on available history. Neural seeds do not guarantee identical GPU results.</p>
        </div>
        {selected.includes('randomForest') && <div className="grid md:grid-cols-3 gap-4 mb-6">
          {numberField('rfEstimators', 'Forest estimators', 10, 1000)}
          {numberField('rfMaxDepth', 'Forest max depth (0 = unlimited)', 0, 100)}
          {numberField('rfMinSamplesSplit', 'Forest minimum split samples', 2, 20)}
        </div>}
        {error && <p role="alert" className="text-red-600 mb-4">{error}</p>}
        <div className="flex justify-between pt-4 border-t dark:border-gray-800">
          <button onClick={() => setStep('EDA')} className="px-4 py-2 rounded bg-gray-100 text-gray-700">Back</button>
          <button onClick={() => {
            if (!selected.length) { setError('Select at least one model.'); return; }
            try { validateSettings(modelParams); }
            catch (cause) { setError(cause instanceof Error ? cause.message : 'Check the training settings.'); return; }
            setModelsToTrain(selected);
            setStep('TRAIN');
          }} className="px-6 py-2 rounded bg-blue-600 text-white">Start Training</button>
        </div>
      </div>
    </div>
  );
}
