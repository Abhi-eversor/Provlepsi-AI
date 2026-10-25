export type ModelId = 'arima' | 'boosting' | 'linear' | 'randomForest' | 'lstm' | 'gru' | 'lstmGruHybrid' | 'bilstm' | 'transformer';
export type DeepModelId = Exclude<ModelId, 'arima' | 'boosting' | 'linear' | 'randomForest'>;
export interface PreprocessingOptions {
  missingValueStrategy: 'ffill' | 'bfill' | 'mean' | 'drop';
  outlierStrategy: 'none' | 'clip' | 'drop';
}
export interface RunSettings {
  splitFraction: number;
  horizon: number;
  lookback: number;
  maxRows: number;
  epochs: number;
  seed: number;
  rfEstimators: number;
  rfMaxDepth: number;
  rfMinSamplesSplit: number;
}
export interface SeriesPoint { index: number; value: number | null }
export interface ParsedDataset {
  indices: number[];
  target: (number | null)[];
  features: (number | null)[][];
  featureNames: string[];
  sourceRowCount: number;
  targetColumn: string;
  sourceSha256?: string;
}
export interface PreparedPartition {
  indices: number[];
  target: (number | null)[];
  features: (number | null)[][];
}
export interface FittedPreprocessing {
  means: number[];
  lowerBounds: (number | null)[];
  upperBounds: (number | null)[];
  filledValues: number;
  clippedValues: number;
  droppedRows: number;
}
export interface PreparedRun {
  train: PreparedPartition;
  validation: { indices: number[]; actual: (number | null)[] };
  final: PreparedPartition;
  history: SeriesPoint[];
  featureNames: string[];
  targetColumn: string;
  sourceRowCount: number;
  effectiveRowCount: number;
  config: RunSettings;
  preprocessing: PreprocessingOptions;
  trainPreprocessing: FittedPreprocessing;
  finalPreprocessing: FittedPreprocessing;
  warnings: string[];
  baselineValue: number;
  sourceSha256?: string;
}
export interface Metrics { rmse: number; mae: number; n: number }
export interface WorkerTrainingResult {
  metrics: Metrics;
  baseline: Metrics;
  forecast: number[];
  evaluationPredictions: number[];
  modelName?: string;
  artifact?: Record<string, unknown>;
  warnings?: string[];
}
export interface ModelResult {
  modelId: ModelId;
  runId: string;
  datasetId: string;
  targetColumn: string;
  metrics: Metrics;
  baseline: Metrics;
  forecast: SeriesPoint[];
  history: SeriesPoint[];
  evaluation: {
    protocol: 'fixed-origin-recursive';
    actual: SeriesPoint[];
    predicted: SeriesPoint[];
    horizon: number;
    trainStart: number;
    trainEnd: number;
  };
  config: RunSettings;
  preprocessing: PreprocessingOptions;
  trainPreprocessing: FittedPreprocessing;
  finalPreprocessing: FittedPreprocessing;
  sourceRowCount: number;
  effectiveRowCount: number;
  modelName?: string;
  artifact?: Record<string, unknown>;
  warnings: string[];
  createdAt: string;
  pipelineVersion: 2;
  sourceSha256?: string;
}
