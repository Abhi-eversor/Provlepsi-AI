import * as Comlink from 'comlink';
import type { PyodideAPI } from '../workers/pyodide.worker';
import type { TfjsAPI } from '../workers/tfjs.worker';

let pyodideWorker: Worker | null = null;
let tfjsWorker: Worker | null = null;
let pyodideProxy: Comlink.Remote<PyodideAPI> | null = null;
let tfjsProxy: Comlink.Remote<TfjsAPI> | null = null;
let runGeneration = 0;
let runController = new AbortController();
function watchWorker(worker: Worker, name: string) {
  worker.addEventListener('error', () => {
    if (worker === pyodideWorker || worker === tfjsWorker) runController.abort(new Error(`${name} worker failed to load or crashed. Retry the run and check runtime download access.`));
  });
  worker.addEventListener('messageerror', () => {
    if (worker === pyodideWorker || worker === tfjsWorker) runController.abort(new Error(`${name} worker returned an unreadable response. Retry the run.`));
  });
}

export const getPyodideAPI = () => {
  if (typeof window === 'undefined') return null;
  if (!pyodideWorker) {
    pyodideWorker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url));
    watchWorker(pyodideWorker, 'Python');
    pyodideProxy = Comlink.wrap<PyodideAPI>(pyodideWorker);
  }
  return pyodideProxy;
};
export const getTfjsAPI = () => {
  if (typeof window === 'undefined') return null;
  if (!tfjsWorker) {
    tfjsWorker = new Worker(new URL('../workers/tfjs.worker.ts', import.meta.url));
    watchWorker(tfjsWorker, 'Neural');
    tfjsProxy = Comlink.wrap<TfjsAPI>(tfjsWorker);
  }
  return tfjsProxy;
};
export const resetPyodideWorker = () => {
  if (pyodideProxy) pyodideProxy[Comlink.releaseProxy]();
  pyodideWorker?.terminate();
  pyodideProxy = null;
  pyodideWorker = null;
};
export const resetTfjsWorker = () => {
  if (tfjsProxy) tfjsProxy[Comlink.releaseProxy]();
  tfjsWorker?.terminate();
  tfjsProxy = null;
  tfjsWorker = null;
};
export const cancelActiveWorkers = () => {
  runController.abort();
  runGeneration += 1;
  runController = new AbortController();
  resetPyodideWorker();
  resetTfjsWorker();
};
export const startWorkerRun = () => { cancelActiveWorkers(); return runGeneration; };
export const isWorkerRunCurrent = (generation: number) => generation === runGeneration;
export const getCurrentWorkerRun = () => runGeneration;
export function awaitWorkerResult<T>(work: Promise<T>, generation: number): Promise<T> {
  const signal = runController.signal;
  if (!isWorkerRunCurrent(generation) || signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Run cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const cancelled = () => reject(signal.reason ?? new DOMException('Run cancelled.', 'AbortError'));
    signal.addEventListener('abort', cancelled, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', cancelled));
  });
}
