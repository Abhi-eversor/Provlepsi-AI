import { create } from 'zustand';
import { accountStateKey } from '../lib/storage';
import { DEFAULT_SETTINGS, DEFAULT_PREPROCESSING } from '../lib/forecasting';
import type { ModelId, ModelResult, PreprocessingOptions, RunSettings } from '../types/forecasting';

export type WizardStep = 'UPLOAD' | 'EDA' | 'MODEL' | 'TRAIN' | 'RESULTS';
export interface DatasetPreview {
  columns: string[];
  shape: number[];
  dtypes: Record<string, string>;
  preview: Record<string, unknown>[];
  correlation_matrix?: Record<string, Record<string, number | null>>;
  summary_statistics?: Record<string, Record<string, number | null>>;
}
interface ProjectState {
  currentStep: WizardStep;
  projectId: string | null;
  datasetId: string | null;
  datasetPreview: DatasetPreview | null;
  targetColumn: string | null;
  preprocessing: PreprocessingOptions;
  modelsToTrain: ModelId[];
  modelResults: Partial<Record<ModelId, ModelResult>>;
  modelParams: RunSettings;
}
interface AppState extends ProjectState {
  accountId: string | null;
  ready: boolean;
  persistenceError: string | null;
  initializeAccount: (accountId: string) => void;
  clearSession: () => void;
  setStep: (step: WizardStep) => void;
  setDataset: (id: string, preview: DatasetPreview) => void;
  setEDAOptions: (target: string, missing: PreprocessingOptions['missingValueStrategy'], outliers: PreprocessingOptions['outlierStrategy']) => void;
  setModelsToTrain: (models: ModelId[]) => void;
  setModelResults: (results: Partial<Record<ModelId, ModelResult>>) => void;
  setModelParams: (params: Partial<RunSettings>) => void;
  reset: () => void;
}
const freshProject = (withId = true): ProjectState => ({
  currentStep: 'UPLOAD',
  projectId: withId ? crypto.randomUUID() : null,
  datasetId: null,
  datasetPreview: null,
  targetColumn: null,
  preprocessing: { ...DEFAULT_PREPROCESSING },
  modelsToTrain: [],
  modelResults: {},
  modelParams: { ...DEFAULT_SETTINGS },
});
function hydrateProject(accountId: string): ProjectState {
  const fallback = freshProject();
  const json = localStorage.getItem(accountStateKey(accountId));
  if (!json) return fallback;
  const saved = JSON.parse(json);
  if (saved.version !== 2 || !saved.project || !/^[a-f\d-]{36}$/i.test(saved.project.projectId)) return fallback;
  const p = saved.project;
  // Pick data explicitly: stored JSON must never overwrite actions or account identity.
  const datasetId = p.datasetId === p.projectId ? p.datasetId : null;
  const results = Object.fromEntries(Object.entries(p.modelResults || {}).filter(([, result]) => (result as ModelResult)?.pipelineVersion === 2));
  return {
    ...fallback,
    projectId: p.projectId,
    datasetId,
    datasetPreview: datasetId ? p.datasetPreview : null,
    targetColumn: typeof p.targetColumn === 'string' ? p.targetColumn : null,
    preprocessing: { ...DEFAULT_PREPROCESSING, ...p.preprocessing },
    modelsToTrain: Array.isArray(p.modelsToTrain) ? p.modelsToTrain.filter((m: string) => ['arima', 'boosting', 'linear', 'randomForest', 'lstm', 'gru', 'lstmGruHybrid', 'bilstm', 'transformer'].includes(m)) : [],
    modelResults: results,
    modelParams: { ...DEFAULT_SETTINGS, ...p.modelParams },
    // Never resume a half-completed worker run after reload.
    currentStep: !datasetId ? 'UPLOAD' : p.currentStep === 'RESULTS' && Object.keys(results).length ? 'RESULTS' : p.targetColumn ? 'MODEL' : 'EDA',
  };
}
export const useStore = create<AppState>((set, get) => ({
  ...freshProject(false),
  accountId: null,
  ready: false,
  persistenceError: null,
  initializeAccount: accountId => {
    if (!/^[1-9]\d*$/.test(accountId)) throw new Error('Invalid account identity.');
    let project: ProjectState;
    let persistenceError: string | null = null;
    try { project = hydrateProject(accountId); }
    catch { project = freshProject(); persistenceError = 'Saved project state could not be read. Local browser storage may be unavailable.'; }
    set({ ...project, accountId, ready: true, persistenceError });
  },
  clearSession: () => set({ ...freshProject(false), accountId: null, ready: false, persistenceError: null }),
  setStep: currentStep => set({ currentStep }),
  setDataset: (id, datasetPreview) => set({ datasetId: id, projectId: id, datasetPreview, targetColumn: null, modelResults: {} }),
  setEDAOptions: (targetColumn, missingValueStrategy, outlierStrategy) => set({ targetColumn, preprocessing: { missingValueStrategy, outlierStrategy }, modelResults: {} }),
  setModelsToTrain: modelsToTrain => set({ modelsToTrain }),
  setModelResults: modelResults => set({ modelResults }),
  setModelParams: params => set(state => ({ modelParams: { ...state.modelParams, ...params }, modelResults: {} })),
  reset: () => { if (get().accountId) set(freshProject()); },
}));
useStore.subscribe(state => {
  if (!state.ready || !state.accountId || typeof localStorage === 'undefined') return;
  const { currentStep, projectId, datasetId, datasetPreview, targetColumn, preprocessing, modelsToTrain, modelResults, modelParams } = state;
  try {
    localStorage.setItem(accountStateKey(state.accountId), JSON.stringify({ version: 2, project: { currentStep, projectId, datasetId, datasetPreview, targetColumn, preprocessing, modelsToTrain, modelResults, modelParams } }));
  } catch {
    if (!state.persistenceError) useStore.setState({ persistenceError: 'Project state could not be saved. Browser storage may be full or unavailable; export your results before leaving.' });
  }
});
