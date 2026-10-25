'use client';

import React, { useState } from 'react';
import dynamic from 'next/dynamic';
import { useStore } from '../store/useStore';
import { storage } from '../lib/storage';
import { cancelActiveWorkers } from '../lib/workerHelper';
import { broadcastProjectDeletion } from '../lib/session-events';
import { forecastCSV, downloadText } from '../lib/result-export';
import type { ModelId } from '../types/forecasting';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });
const modelNames: Record<string, string> = { arima: 'ARIMA', boosting: 'Gradient Boosting', linear: 'Linear Regression', randomForest: 'Random Forest', lstm: 'LSTM', gru: 'GRU', lstmGruHybrid: 'LSTM-GRU Hybrid', bilstm: 'Bi-LSTM', transformer: 'Transformer (experimental)' };
export default function StepResults() {
  const { accountId, projectId, modelResults, reset } = useStore();
  const available = Object.keys(modelResults) as ModelId[];
  const [selection, setSelection] = useState<ModelId | ''>(available[0] || '');
  const selected = selection && modelResults[selection] ? selection : available[0];
  const result = selected ? modelResults[selected] : undefined;
  const [graph, setGraph] = useState<HTMLElement | null>(null);
  const [graphModel, setGraphModel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (!result) return <p className="py-12 text-center text-gray-500">No completed forecasts. Return to Model Selection to train a model.</p>;
  const history = result.history;
  const forecast = result.forecast;
  const last = history[history.length - 1];
  const plotId = `${result.runId}:${selected}`;
  const chartReady = graph !== null && graphModel === plotId;
  const deleteProject = async () => {
    if (!accountId || !projectId || !confirm('Permanently delete this project: saved CSV, processed data, results, and neural model weights from this browser?')) return;
    cancelActiveWorkers();
    broadcastProjectDeletion(accountId, projectId);
    setBusy(true);
    setError('');
    try { await storage.deleteProject(accountId, projectId); reset(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Project deletion failed. Close other tabs and retry.'); }
    finally { setBusy(false); }
  };
  return (
    <div className="max-w-5xl mx-auto pb-12 bg-white dark:bg-gray-900 p-6 rounded-xl border dark:border-gray-800">
      <div className="flex flex-col md:flex-row justify-between gap-4 mb-6">
        <div><h2 className="text-2xl font-bold dark:text-white">Forecast Results</h2><p className="text-sm text-gray-500 mt-2">Historical and forecast positions come from the actual training run. Model accuracy is experimental; compare against the last-value baseline.</p></div>
        <label className="text-sm text-gray-500">Completed model
          <select aria-label="Completed model" value={selected} onChange={event => { setSelection(event.target.value as ModelId); setGraph(null); setGraphModel(''); }} className="block p-2 mt-1 rounded border dark:bg-gray-800 dark:border-gray-700 dark:text-white">{available.map(model => <option key={model} value={model}>{modelNames[model]}</option>)}</select>
        </label>
      </div>
      {error && <p role="alert" className="mb-4 text-red-600">{error}</p>}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {[['Holdout RMSE', result.metrics.rmse.toFixed(4)], ['Holdout MAE', result.metrics.mae.toFixed(4)], ['Last-value baseline RMSE', result.baseline.rmse.toFixed(4)], ['Future horizon', `${forecast.length} steps`]].map(([label, value]) => <div key={label} className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg"><p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold dark:text-white">{value}</p></div>)}
      </div>
      <p className="text-sm text-gray-500 mb-4">Evaluation: {result.evaluation.protocol}; {result.metrics.n} observed targets across {result.evaluation.horizon} test steps. Evaluation training rows {result.evaluation.trainStart} to {result.evaluation.trainEnd}. Final refit uses {result.effectiveRowCount} of {result.sourceRowCount} source rows; future predictions begin at index {forecast[0]?.index}. Indices preserve CSV row order; no date sorting or frequency inference is performed.</p>
      <div id="results-plot-container" className="h-[420px] border rounded-lg mb-4 dark:border-gray-700">
        <Plot key={plotId} data={[
          { x: history.map(point => point.index), y: history.map(point => point.value), type: 'scatter', mode: 'lines', name: 'Observed history', connectgaps: false, line: { color: '#64748b', width: 2 } },
          { x: result.evaluation.predicted.map(point => point.index), y: result.evaluation.predicted.map(point => point.value), type: 'scatter', mode: 'lines', name: 'Holdout predictions', line: { color: '#f59e0b', dash: 'dash' } },
          { x: [...(last ? [last.index] : []), ...forecast.map(point => point.index)], y: [...(last ? [last.value] : []), ...forecast.map(point => point.value)], type: 'scatter', mode: 'lines+markers', name: 'Future forecast (final refit)', connectgaps: false, line: { color: '#2563eb', dash: 'dot' } },
        ]} layout={{
          autosize: true, margin: { t: 45, r: 20, b: 50, l: 60 }, paper_bgcolor: 'transparent', plot_bgcolor: 'transparent',
          legend: { orientation: 'h', y: 1.15 }, xaxis: { title: { text: 'Original row index' } }, yaxis: { title: { text: result.targetColumn } },
          shapes: [{ type: 'line', x0: result.evaluation.trainEnd + 0.5, x1: result.evaluation.trainEnd + 0.5, y0: 0, y1: 1, yref: 'paper', line: { color: '#f59e0b', dash: 'dot', width: 1 } }],
        }} config={{ displayModeBar: true, toImageButtonOptions: { filename: `forecast_${selected}`, format: 'png', scale: 2 } }}
          onInitialized={(_figure, div) => { setGraph(div); setGraphModel(plotId); }} onUpdate={(_figure, div) => { setGraph(div); setGraphModel(plotId); }}
          onError={() => { setGraph(null); setError('The chart could not be rendered. CSV and run details remain available.'); }}
          style={{ width: '100%', height: '100%' }} useResizeHandler />
      </div>
      <div className="flex flex-wrap gap-3 mb-6">
        <button disabled={!chartReady || busy} onClick={async () => {
          if (!graph || !chartReady) return;
          setBusy(true);
          setError('');
          try { const Plotly = (await import('plotly.js/dist/plotly')).default; await Plotly.downloadImage(graph, { format: 'png', filename: `forecast_${selected}` }); }
          catch { setError('Could not export this chart image. Try again after the chart finishes rendering.'); }
          finally { setBusy(false); }
        }} className="px-4 py-2 rounded border border-blue-500 text-blue-600 disabled:opacity-40">Save Graph Image</button>
        <button onClick={() => downloadText(forecastCSV(result), `${selected}_forecast.csv`, 'text/csv;charset=utf-8')} className="px-4 py-2 rounded border border-blue-500 text-blue-600">Download Forecast (CSV)</button>
        <button onClick={() => downloadText(JSON.stringify(result, null, 2), `${selected}_run.json`, 'application/json')} className="px-4 py-2 rounded border border-blue-500 text-blue-600">Download Run Details (JSON)</button>
      </div>
      <details className="mb-6 text-sm text-gray-500"><summary className="cursor-pointer">Preprocessing and reproducibility details</summary>
        <p className="mt-3">Missing values: {result.preprocessing.missingValueStrategy}; outliers: {result.preprocessing.outlierStrategy}. Evaluation preprocessing filled {result.trainPreprocessing.filledValues}, clipped {result.trainPreprocessing.clippedValues}, and dropped {result.trainPreprocessing.droppedRows} rows/values as reported by the pipeline. Seed: {result.config.seed}; pipeline: {result.pipelineVersion}; run: {result.runId}.</p>
        {result.modelName && <p className="mt-2 break-all">Neural weights are stored in this browser as {result.modelName}. JSON exports metadata and predictions; it does not contain model weights or the original CSV.</p>}
        {!!result.warnings.length && <ul className="list-disc pl-5 mt-3">{result.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}
      </details>
      <div className="flex flex-wrap justify-between gap-3 border-t pt-4 dark:border-gray-700">
        <button disabled={busy} onClick={() => { cancelActiveWorkers(); reset(); }} className="px-4 py-2 rounded border dark:border-gray-600 dark:text-gray-200">Start New Project</button>
        <button disabled={busy} onClick={deleteProject} className="px-4 py-2 rounded border border-red-400 text-red-600 disabled:opacity-40">Delete Current Project</button>
      </div>
      <p className="text-xs text-gray-500 mt-3">Starting a new project keeps saved browser datasets and model weights until Sign Out. Delete Current Project removes its saved data immediately. Account namespaces prevent accidental mixing; they do not encrypt browser storage.</p>
    </div>
  );
}
