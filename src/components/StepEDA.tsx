'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import dynamic from 'next/dynamic';
import { storage } from '../lib/storage';
import { getPyodideAPI, awaitWorkerResult, getCurrentWorkerRun, cancelActiveWorkers } from '../lib/workerHelper';
import { prepareRun } from '../lib/forecasting';
import type { PreparedRun, PreprocessingOptions } from '../types/forecasting';
import { Target, AlertCircle, Settings2, ChevronDown, Image as ImageIcon } from 'lucide-react';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

export default function StepEDA() {
  const { accountId, datasetId, datasetPreview, preprocessing, modelParams, setEDAOptions, setStep, targetColumn: storeTargetColumn } = useStore();
  
  const columns = datasetPreview?.columns || [];
  const previewData = datasetPreview?.preview || [];
  const dtypes = datasetPreview?.dtypes || {};

  // Auto-select the first numeric column instead of just the first column (which is often a Date string)
  const defaultTarget = columns.find((c: string) => dtypes[c]?.includes('int') || dtypes[c]?.includes('float')) || columns[0] || '';

  const [targetColumn, setTargetColumn] = useState<string>(storeTargetColumn || defaultTarget);
  const [missingValue, setMissingValue] = useState<PreprocessingOptions['missingValueStrategy']>(preprocessing.missingValueStrategy);
  const [outlier, setOutlier] = useState<PreprocessingOptions['outlierStrategy']>(preprocessing.outlierStrategy);
  const [prepared, setPrepared] = useState<PreparedRun | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [preparationError, setPreparationError] = useState('');
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; cancelActiveWorkers(); }, []);
  const [activeTab, setActiveTab] = useState<string>('line');
  const [graphDiv, setGraphDiv] = useState<any>(null);
  const [graphReady, setGraphReady] = useState(false);
  const rememberGraph = (_figure: unknown, div: HTMLElement) => { setGraphDiv(div); setGraphReady(true); };
  const changeTab = (tab: string) => { if (tab !== activeTab) { setGraphReady(false); setActiveTab(tab); } };

  const preparePreview = async () => {
    const current = ++generation.current;
    setPreparing(true);
    setPreparationError('');
    try {
      if (!accountId || !datasetId) throw new Error('Upload a dataset first.');
      const raw = await storage.getRawDataset(accountId, datasetId);
      const api = getPyodideAPI();
      if (!raw || !api) throw new Error('Dataset or Python worker is unavailable.');
      const parsed = await awaitWorkerResult(api.parseDataset(raw.rawContent, targetColumn), getCurrentWorkerRun());
      const run = prepareRun(parsed, { missingValueStrategy: missingValue, outlierStrategy: outlier }, modelParams);
      if (current !== generation.current) return null;
      setPrepared(run);
      return run;
    } catch (error) {
      if (current === generation.current) { setPrepared(null); setPreparationError(error instanceof Error ? error.message : 'Could not prepare this dataset.'); }
      return null;
    } finally { if (current === generation.current) setPreparing(false); }
  };
  const handleContinue = async () => {
    if (await preparePreview()) {
      setEDAOptions(targetColumn, missingValue, outlier);
      setStep('MODEL');
    }
  };

  const handleDownloadGraph = async () => {
    if (graphDiv && graphReady) {
      try {
        const Plotly = (await import('plotly.js/dist/plotly')).default;
        await Plotly.downloadImage(graphDiv, { format: 'png', filename: `eda_${activeTab}_${targetColumn}` });
      } catch (err) {
        console.error('Failed to save graph', err);
        setPreparationError('Could not export the chart. Wait for it to finish rendering and retry.');
      }
    }
  };

  const plotData = previewData.map((row: any, i: number) => ({
    x: i,
    y: row[targetColumn]
  }));

  const renderPlot = () => {
    if (activeTab === 'heatmap') {
      const corr = datasetPreview?.correlation_matrix || {};
      const cols = Object.keys(corr);
      if (cols.length === 0) return <div className="flex items-center justify-center h-full text-gray-500">No numeric columns for correlation</div>;
      
      const zValues = cols.map(colY => cols.map(colX => corr[colY][colX]));
      
      return (
        <Plot
          data={[{
            z: zValues,
            x: cols,
            y: cols,
            type: 'heatmap',
            colorscale: 'RdBu',
            zmin: -1,
            zmax: 1
          }]}
          layout={{
            autosize: true,
            margin: { t: 20, r: 20, b: 80, l: 80 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
          }}
          config={{
            displayModeBar: true,
            toImageButtonOptions: { filename: `eda_heatmap_${targetColumn}`, format: 'png', scale: 2 }
          }}
            onInitialized={rememberGraph}
            onUpdate={rememberGraph}
          style={{width: '100%', height: '100%'}}
          useResizeHandler={true}
        />
      );
    }
    
    if (activeTab === 'histogram') {
      return (
        <Plot
          data={[{
            x: plotData.map((d: any) => d.y),
            type: 'histogram',
            marker: {color: '#3b82f6'},
            opacity: 0.7
          }]}
          layout={{
            autosize: true,
            margin: { t: 20, r: 20, b: 50, l: 60 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            xaxis: { title: { text: targetColumn || 'Value', font: { size: 14 } } },
            yaxis: { title: { text: 'Count', font: { size: 14 } } }
          }}
          config={{
            displayModeBar: true,
            toImageButtonOptions: { filename: `eda_histogram_${targetColumn}`, format: 'png', scale: 2 }
          }}
            onInitialized={rememberGraph}
            onUpdate={rememberGraph}
          style={{width: '100%', height: '100%'}}
          useResizeHandler={true}
        />
      );
    }
    
    if (activeTab === 'boxplot') {
      return (
        <Plot
          data={[{
            y: plotData.map((d: any) => d.y),
            type: 'box',
            name: targetColumn,
            marker: {color: '#3b82f6'}
          }]}
          layout={{
            autosize: true,
            margin: { t: 20, r: 20, b: 50, l: 60 },
            paper_bgcolor: 'transparent',
            plot_bgcolor: 'transparent',
            yaxis: { title: { text: targetColumn || 'Value', font: { size: 14 } } }
          }}
          config={{
            displayModeBar: true,
            toImageButtonOptions: { filename: `eda_boxplot_${targetColumn}`, format: 'png', scale: 2 }
          }}
            onInitialized={rememberGraph}
            onUpdate={rememberGraph}
          style={{width: '100%', height: '100%'}}
          useResizeHandler={true}
        />
      );
    }

    // Default: Line Plot
    return (
      <Plot
        data={[
          {
            x: plotData.map((d: any) => d.x),
            y: plotData.map((d: any) => d.y),
            type: 'scatter',
            mode: 'lines+markers',
            marker: {color: '#3b82f6', size: 4},
            line: {color: '#60a5fa', width: 2}
          },
        ]}
        layout={{
          autosize: true, 
          margin: { t: 20, r: 20, b: 50, l: 60 },
          paper_bgcolor: 'transparent',
          plot_bgcolor: 'transparent',
          xaxis: { 
            gridcolor: '#e2e8f0',
            title: { text: 'Time Step (Index)', font: { size: 14 } } 
          },
          yaxis: { 
            gridcolor: '#e2e8f0',
            title: { text: targetColumn || 'Value', font: { size: 14 } }
          }
        }}
        config={{
          displayModeBar: true,
          toImageButtonOptions: { filename: `eda_lineplot_${targetColumn}`, format: 'png', scale: 2 }
        }}
          onInitialized={rememberGraph}
          onUpdate={rememberGraph}
        style={{width: '100%', height: '100%'}}
        useResizeHandler={true}
      />
    );
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8 pb-12">
      <div className="bg-white dark:bg-gray-900 p-8 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800">
        
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">Exploratory Data Analysis</h2>
          <p className="text-gray-500 dark:text-gray-400">Select the target column you want to forecast to preview the raw time-series data.</p>
        </div>
        
        <div className="bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-800/50 rounded-xl p-6 mb-8">
          <label className="flex items-center text-sm font-semibold text-gray-800 dark:text-gray-200 mb-3">
            <Target className="w-4 h-4 mr-2 text-blue-500" />
            Target Column to Forecast
          </label>
          <div className="relative max-w-sm">
            <select 
              className="w-full appearance-none bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg pl-4 pr-10 py-3 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all font-medium cursor-pointer"
              value={targetColumn} 
              disabled={preparing}
              onChange={e => { setTargetColumn(e.target.value); setPrepared(null); setPreparationError(''); setGraphReady(false); }}
            >
              {columns.map((c: string) => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 dark:text-gray-400">
              <ChevronDown className="w-5 h-5" />
            </div>
          </div>
        </div>

        <div className="mb-10">
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-4 gap-4">
            <div className="flex flex-wrap gap-2">
              <button 
                onClick={() => changeTab('line')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'line' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                Line Plot
              </button>
              <button 
                onClick={() => changeTab('heatmap')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'heatmap' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                Correlation
              </button>
              <button 
                onClick={() => changeTab('histogram')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'histogram' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                Histogram
              </button>
              <button 
                onClick={() => changeTab('boxplot')}
                className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${activeTab === 'boxplot' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' : 'text-gray-600 hover:bg-gray-100 dark:text-gray-400 dark:hover:bg-gray-800'}`}
              >
                Box Plot
              </button>
            </div>
            <span className="bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 px-3 py-1 text-xs font-medium rounded-full border border-gray-200 dark:border-gray-700 whitespace-nowrap">
              {activeTab === 'heatmap' ? 'All numeric columns' : 'Showing first 100 rows'}
            </span>
          </div>
          <div id="eda-plot-container" className="border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden h-[400px] bg-gray-50 dark:bg-gray-800/30">
            {renderPlot()}
          </div>
          <div className="flex justify-end mt-4">
            <button 
              onClick={handleDownloadGraph}
              disabled={!graphReady}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors border border-blue-200 dark:border-blue-800/50"
            >
              <ImageIcon className="w-4 h-4" />
              <span>Save Graph Image</span>
            </button>
          </div>
        </div>

        <div className="border-t border-gray-200 dark:border-gray-700 pt-8 mb-8">
          <div className="mb-6">
            <h3 className="text-lg font-semibold flex items-center text-gray-800 dark:text-gray-200">
              <Settings2 className="w-5 h-5 mr-2 text-gray-500" />
              Preprocessing Strategies
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              These strategies are applied to known training history in both engines. Statistics are fitted before the holdout; held-out target values are never filled or clipped for scoring. The charts above show raw upload data.
            </p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <AlertCircle className="w-4 h-4 mr-2 text-orange-500" />
                Missing Value Strategy
              </label>
              <div className="relative">
                <select 
                  className="w-full appearance-none bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg pl-4 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer"
                  value={missingValue} 
                  disabled={preparing}
                  onChange={e => { setMissingValue(e.target.value as PreprocessingOptions['missingValueStrategy']); setPrepared(null); }}
                >
                  <option value="ffill">Forward Fill (Recommended)</option>
                  <option value="bfill">Backward Fill</option>
                  <option value="mean">Mean Imputation</option>
                  <option value="drop">Drop Rows</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 dark:text-gray-400">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </div>
            
            <div>
              <label className="flex items-center text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                <AlertCircle className="w-4 h-4 mr-2 text-red-500" />
                Outlier Strategy
              </label>
              <div className="relative">
                <select 
                  className="w-full appearance-none bg-gray-50 dark:bg-gray-800 border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white rounded-lg pl-4 pr-10 py-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all cursor-pointer"
                  value={outlier} 
                  disabled={preparing}
                  onChange={e => { setOutlier(e.target.value as PreprocessingOptions['outlierStrategy']); setPrepared(null); }}
                >
                  <option value="none">None (Keep All Data)</option>
                  <option value="clip">Clip (IQR Method)</option>
                  <option value="drop">Drop (IQR Method)</option>
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3 text-gray-500 dark:text-gray-400">
                  <ChevronDown className="w-4 h-4" />
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <button type="button" disabled={preparing || !targetColumn} onClick={preparePreview} className="rounded bg-blue-600 px-4 py-2 text-white disabled:opacity-50">
            {preparing ? 'Preparing training data…' : 'Preview preprocessing'}
          </button>
          <p className="text-sm text-gray-500">Forward fill uses the fitted training mean for leading gaps. Backward fill is confined to known history. Dropping preserves gaps on the original row grid; models can reject incomplete recent context.</p>
          {preparationError && <p role="alert" className="text-sm text-red-600">{preparationError}</p>}
          {prepared && <div className="overflow-x-auto text-sm">
            <p>{prepared.train.indices.length} training rows; {prepared.validation.indices.length} holdout rows. Training preprocessing: {prepared.trainPreprocessing.filledValues} filled values, {prepared.trainPreprocessing.clippedValues} clipped values, {prepared.trainPreprocessing.droppedRows} excluded rows.</p>
            <table className="mt-2 w-full text-left"><caption>First 12 prepared training observations (original zero-based indices)</caption><thead><tr><th>Index</th><th>Prepared target</th></tr></thead><tbody>
              {prepared.train.indices.slice(0, 12).map((index, i) => <tr key={index}><td>{index}</td><td>{prepared.train.target[i] ?? 'Gap (excluded)'}</td></tr>)}
            </tbody></table>
            {prepared.warnings.map(warning => <p key={warning} className="mt-2 text-amber-700 dark:text-amber-400">{warning}</p>)}
          </div>}
        </div>
        <div className="flex justify-between items-center pt-6 border-t border-gray-100 dark:border-gray-800">
          <button 
            onClick={() => setStep('UPLOAD')}
            className="px-6 py-2.5 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700 transition-colors"
          >
            Back
          </button>
          <button 
            onClick={handleContinue}
            disabled={preparing || !targetColumn}
            className="px-8 py-2.5 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 shadow-sm transition-colors"
          >
            Continue to Models
          </button>
        </div>
      </div>
    </div>
  );
}
