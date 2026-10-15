import * as Comlink from 'comlink';
import type { PyodideAPI } from '../workers/pyodide.worker';
import type { TfjsAPI } from '../workers/tfjs.worker';

let pyodideWorker: Worker | null = null;
let tfjsWorker: Worker | null = null;

export const getPyodideAPI = () => {
  if (typeof window === 'undefined') return null;
  if (!pyodideWorker) {
    pyodideWorker = new Worker(new URL('../workers/pyodide.worker.ts', import.meta.url));
  }
  return Comlink.wrap<PyodideAPI>(pyodideWorker);
};

export const resetPyodideWorker = () => {
  if (pyodideWorker) {
    pyodideWorker.terminate();
    pyodideWorker = null;
  }
};

export const getTfjsAPI = () => {
  if (typeof window === 'undefined') return null;
  if (!tfjsWorker) {
    tfjsWorker = new Worker(new URL('../workers/tfjs.worker.ts', import.meta.url));
  }
  return Comlink.wrap<TfjsAPI>(tfjsWorker);
};
