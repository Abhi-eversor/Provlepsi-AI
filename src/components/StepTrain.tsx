'use client';

import React, { useEffect, useState } from 'react';
import { useStore } from '../store/useStore';
import { storage } from '../lib/storage';
import { getPyodideAPI, getTfjsAPI, resetPyodideWorker } from '../lib/workerHelper';
import { Loader2, CheckCircle2 } from 'lucide-react';
import * as Comlink from 'comlink';
import type { TfjsAPI } from '../workers/tfjs.worker';

const DEEP_MODEL_DISPLAY_NAMES: Record<string, string> = {
  lstm: 'LSTM',
  gru: 'GRU',
  lstmGruHybrid: 'LSTM-GRU Hybrid',
  bilstm: 'Bi-LSTM',
  transformer: 'Transformer'
};

const DEEP_MODEL_TRAINERS: Record<string, keyof TfjsAPI> = {
  lstm: 'trainLSTM',
  gru: 'trainGRU',
  lstmGruHybrid: 'trainLSTMGRUHybrid',
  bilstm: 'trainBiLSTM',
  transformer: 'trainTransformer'
};

function extractNumericColumn(csvString: string, targetCol: string): number[] {
  const lines = csvString.trim().split('\n');
  if (lines.length < 2) return [];
  
  const header = lines[0].split(',').map(s => s.trim().replace(/^"|"$/g, ''));
  const colIndex = header.indexOf(targetCol);
  if (colIndex === -1) return [];
  
  const values: number[] = [];
  let lastValid = 0;
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const cols = line.split(','); 
    if (cols.length > colIndex) {
      const valStr = cols[colIndex].trim().replace(/^"|"$/g, '');
      const val = parseFloat(valStr);
      if (!isNaN(val)) {
        values.push(val);
        lastValid = val;
      } else if (values.length > 0) {
        // Forward fill
        values.push(lastValid);
      }
    }
  }
  return values;
}


export default function StepTrain() {
  const { datasetId, modelsToTrain, targetColumn, setStep, currentStep, setModelResults, datasetPreview, modelParams } = useStore();
  
  const [trainingStatus, setTrainingStatus] = useState<Record<string, { status: 'pending' | 'training' | 'done' | 'error', progress?: string, metrics?: any, forecast?: number[] }>>({});
  const [allDone, setAllDone] = useState(false);

  useEffect(() => {
    if (currentStep !== 'TRAIN') return;

    // Initialize state
    const initStatus: any = {};
    modelsToTrain.forEach(m => {
      initStatus[m] = { status: 'pending', progress: 'Waiting to start...' };
    });
    setTrainingStatus(initStatus);

    const runTraining = async () => {
      if (!datasetId || !targetColumn) return;
      const rawData = await storage.getRawDataset(datasetId);
      if (!rawData) return;
      
      // Free up Web Worker memory by resetting Pyodide before loading massive ML libraries
      resetPyodideWorker();

      // Run sequentially to prevent race conditions on Pyodide globals
      for (const model of modelsToTrain) {
        try {
          setTrainingStatus(prev => ({ ...prev, [model]: { status: 'training', progress: 'Training in progress...' } }));
          
          if (model === 'arima' || model === 'boosting' || model === 'linear' || model === 'randomForest') {
            const pyodide = getPyodideAPI();
            if (!pyodide) throw new Error("Pyodide worker unavailable");
            
            const result = await pyodide.trainModel(
              model, 
              rawData.rawContent, 
              targetColumn,
              modelParams,
              Comlink.proxy((msg: string) => {
                setTrainingStatus(prev => ({ ...prev, [model]: { status: 'training', progress: msg } }));
              })
            );
            
            setTrainingStatus(prev => ({ 
              ...prev, 
              [model]: { status: 'done', progress: 'Complete', metrics: result.metrics, forecast: result.forecast } 
            }));
          } else if (model in DEEP_MODEL_TRAINERS) {
            const tfjs = getTfjsAPI();
            if (!tfjs) throw new Error("TF.js worker unavailable");
            
            const timeSeriesData = extractNumericColumn(rawData.rawContent, targetColumn);
            if (timeSeriesData.length === 0) throw new Error("Could not extract numeric data for target column.");
            
            const trainFn = (tfjs as any)[DEEP_MODEL_TRAINERS[model]];

            const result = await trainFn(timeSeriesData, 10, 50, Comlink.proxy((epoch: number, logs: any) => {
              setTrainingStatus(prev => ({ 
                ...prev, 
                [model]: { status: 'training', progress: `Epoch ${epoch+1}/10 (Loss: ${logs.loss.toFixed(4)})` } 
              }));
            }));
            
            setTrainingStatus(prev => ({ 
              ...prev, 
              [model]: { status: 'done', progress: 'Complete', metrics: result.metrics, forecast: result.forecast } 
            }));
          }
        } catch (e: any) {
          let errorMsg = e.message || 'Unknown error';
          if (errorMsg.includes('ValueError:')) {
            errorMsg = errorMsg.split('ValueError:').pop().trim();
          } else if (errorMsg.includes('Exception:')) {
            errorMsg = errorMsg.split('Exception:').pop().trim();
          } else {
            const lines = errorMsg.split('\\n').filter((l: string) => l.trim().length > 0);
            errorMsg = lines[lines.length - 1] || errorMsg;
          }
          if (errorMsg.includes('contains no valid numeric data')) {
            errorMsg = `${errorMsg} Please go back to Step 2 (EDA) and select a numerical column like 'Open' or 'Close'.`;
          }
          setTrainingStatus(prev => ({ ...prev, [model]: { status: 'error', progress: errorMsg } }));
        }
      }

      setAllDone(true);
    };

    runTraining();
  }, [currentStep, datasetId, modelsToTrain, targetColumn, datasetPreview?.preview, modelParams]);

  const handleContinue = () => {
    const results: any = {};
    Object.keys(trainingStatus).forEach(m => {
      const stat = trainingStatus[m];
      if (stat.status === 'done' && stat.metrics && stat.forecast) {
        results[m] = { metrics: stat.metrics, forecast: stat.forecast };
      }
    });
    setModelResults(results);
    setStep('RESULTS');
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      <div className="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
        <h2 className="text-2xl font-bold mb-6 text-gray-800 dark:text-gray-100">Training Models</h2>
        
        <div className="space-y-4 mb-8">
          {modelsToTrain.map(model => {
            const stat = trainingStatus[model];
            return (
              <div key={model} className="p-4 rounded-lg border border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-800/50 flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  {stat?.status === 'pending' && <div className="w-6 h-6 rounded-full bg-gray-200 dark:bg-gray-700" />}
                  {stat?.status === 'training' && <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />}
                  {stat?.status === 'done' && <CheckCircle2 className="w-6 h-6 text-green-500" />}
                  {stat?.status === 'error' && <div className="w-6 h-6 rounded-full bg-red-500" />}
                  
                  <div>
                    <h3 className="font-semibold text-gray-800 dark:text-gray-200">
                      {DEEP_MODEL_DISPLAY_NAMES[model] || (model === 'boosting' ? 'Gradient Boosting' : model === 'randomForest' ? 'Random Forest' : model === 'linear' ? 'Linear Regression' : model.toUpperCase())}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-400">{stat?.progress || 'Waiting...'}</p>
                  </div>
                </div>
                
                {stat?.metrics && (
                  <div className="text-right">
                    <div className="text-xs text-gray-500">RMSE</div>
                    <div className="font-mono font-medium dark:text-white">{stat.metrics.rmse.toFixed(3)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="flex justify-between items-center pt-4 border-t border-gray-100 dark:border-gray-800">
          <button 
            onClick={() => setStep('MODEL')}
            className="px-6 py-2 text-sm font-medium text-gray-600 bg-gray-100 rounded-md hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
          >
            Back
          </button>
          <button 
            onClick={handleContinue}
            disabled={!allDone}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm transition-colors"
          >
            View Results & Forecast
          </button>
        </div>
      </div>
    </div>
  );
}
