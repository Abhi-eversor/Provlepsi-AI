import * as Comlink from 'comlink';
import { calculateMetrics, baselineForRun } from '../lib/forecasting';
import { READ_CSV_PYTHON, PREVIEW_PYTHON, PARSE_DATASET_PYTHON, TRAIN_MODEL_PYTHON } from '../lib/python-code';
import type { ModelId, ParsedDataset, PreparedRun, WorkerTrainingResult } from '../types/forecasting';

// Pyodide's dynamic Python bridge does not expose static types to this application.
let pyodideInstance: any = null;
let initPromise: Promise<boolean> | null = null;
let queue: Promise<unknown> = Promise.resolve();
function sequential<T>(operation: () => Promise<T>): Promise<T> {
  const result = queue.then(operation, operation);
  queue = result.catch(() => undefined);
  return result;
}
function checkCsv(content: string) {
  if (!content.trim()) throw new Error('CSV is empty.');
  if (new TextEncoder().encode(content).length > 5 * 1024 * 1024) throw new Error('CSV exceeds the 5 MiB upload limit.');
}

const pyodideAPI = {
  async init(progressCallback?: (message: string) => void) {
    if (pyodideInstance) return true;
    if (!initPromise) initPromise = (async () => {
      progressCallback?.('Loading Pyodide 0.25.0 runtime…');
      const runtime = self as unknown as { importScripts: (url: string) => void; loadPyodide: (options: { indexURL: string }) => Promise<typeof pyodideInstance> };
      runtime.importScripts('https://cdn.jsdelivr.net/pyodide/v0.25.0/full/pyodide.js');
      const instance = await runtime.loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.25.0/full/' });
      progressCallback?.('Loading pandas…');
      await instance.loadPackage('pandas');
      pyodideInstance = instance;
      return true;
    })();
    try { return await initPromise; }
    catch (error) { initPromise = null; throw new Error(`Python runtime initialization failed. Check your connection to jsDelivr. ${error instanceof Error ? error.message : ''}`); }
  },
  async getPreview(csvContent: string) {
    checkCsv(csvContent);
    return sequential(async () => {
      await this.init();
      pyodideInstance.globals.set('csv_content', csvContent);
      try { return JSON.parse(await pyodideInstance.runPythonAsync(READ_CSV_PYTHON + PREVIEW_PYTHON)); }
      finally { pyodideInstance.globals.delete('csv_content'); }
    });
  },
  async parseDataset(csvContent: string, targetCol: string): Promise<ParsedDataset> {
    checkCsv(csvContent);
    return sequential(async () => {
      await this.init();
      pyodideInstance.globals.set('csv_content', csvContent);
      pyodideInstance.globals.set('target_col', targetCol);
      try {
        const parsed: ParsedDataset = JSON.parse(await pyodideInstance.runPythonAsync(READ_CSV_PYTHON + PARSE_DATASET_PYTHON));
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(csvContent));
        parsed.sourceSha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        return parsed;
      }
      finally { pyodideInstance.globals.delete('csv_content'); pyodideInstance.globals.delete('target_col'); }
    });
  },
  async trainModel(modelType: ModelId, run: PreparedRun, progressCallback?: (message: string) => void): Promise<WorkerTrainingResult> {
    return sequential(async () => {
      await this.init(progressCallback);
      if (!['arima', 'boosting', 'linear', 'randomForest'].includes(modelType)) throw new Error('Unknown Python model.');
      progressCallback?.(`Loading ${modelType === 'arima' ? 'Statsmodels' : 'scikit-learn'}…`);
      await pyodideInstance.loadPackage(modelType === 'arima' ? 'statsmodels' : 'scikit-learn');
      progressCallback?.('Evaluating chronological holdout, then fitting final history…');
      pyodideInstance.globals.set('run_json', JSON.stringify(run));
      pyodideInstance.globals.set('model_type', modelType);
      try {
        const output = JSON.parse(await pyodideInstance.runPythonAsync(TRAIN_MODEL_PYTHON));
        return { ...output, metrics: calculateMetrics(run.validation.actual, output.evaluationPredictions), baseline: baselineForRun(run) };
      } finally { pyodideInstance.globals.delete('run_json'); pyodideInstance.globals.delete('model_type'); }
    });
  },
};

export type PyodideAPI = typeof pyodideAPI;
Comlink.expose(pyodideAPI);
