'use client';

import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { Download, RefreshCw, BarChart2, Image as ImageIcon } from 'lucide-react';
import dynamic from 'next/dynamic';

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false });

export default function StepResults() {
  const { modelResults, datasetPreview, targetColumn, reset } = useStore();
  
  // Available models that completed successfully
  const availableModels = Object.keys(modelResults);
  const [selectedModel, setSelectedModel] = useState<string>(availableModels[0] || '');
  const [graphDiv, setGraphDiv] = useState<any>(null);

  // Extract historical data
  const previewData = datasetPreview?.preview || [];
  const historicalY = previewData.map((row: any) => row[targetColumn as string]);
  const historicalX = previewData.map((_: any, i: number) => i);
  
  // Extract forecast data for selected model
  const forecastY = selectedModel && modelResults[selectedModel] ? modelResults[selectedModel].forecast : [];
  const forecastX = forecastY.map((_: any, i: number) => historicalX.length + i);

  const currentMetrics = selectedModel && modelResults[selectedModel] ? modelResults[selectedModel].metrics : null;

  const handleDownload = () => {
    if (!selectedModel || !modelResults[selectedModel]) return;
    
    // Create CSV content: Historical + Forecast
    let csvContent = "type,index,value\n";
    
    historicalY.forEach((val: number, i: number) => {
      csvContent += `historical,${i},${val}\n`;
    });
    
    forecastY.forEach((val: number, i: number) => {
      csvContent += `forecast,${historicalX.length + i},${val}\n`;
    });
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedModel}_forecast.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  const handleDownloadGraph = async () => {
    if (graphDiv) {
      try {
        const Plotly = (await import('plotly.js/dist/plotly')).default;
        Plotly.downloadImage(graphDiv, { format: 'png', filename: `forecast_${selectedModel}` });
      } catch (err) {
        console.error('Failed to save graph', err);
      }
    }
  };

  const getModelName = (key: string) => {
    if (key === 'arima') return 'ARIMA';
    if (key === 'boosting') return 'Gradient Boosting';
    if (key === 'lstm') return 'LSTM';
    return key;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-12">
      <div className="bg-white dark:bg-gray-900 p-6 rounded-xl shadow-sm border border-gray-100 dark:border-gray-800">
        
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-800 dark:text-gray-100">Forecast Results</h2>
            <p className="text-gray-500 dark:text-gray-400">Inspect experimental forecasts. Evaluation methods differ between models; the chart and CSV history contain only the first 100 rows.</p>
          </div>
          
          <div className="flex items-center space-x-3 bg-gray-50 dark:bg-gray-800 p-1.5 rounded-lg border border-gray-200 dark:border-gray-700 overflow-x-auto">
            {availableModels.map(model => (
              <button
                key={model}
                onClick={() => setSelectedModel(model)}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap ${
                  selectedModel === model 
                    ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm border border-gray-200 dark:border-gray-600' 
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-gray-200 border border-transparent'
                }`}
              >
                {getModelName(model)}
              </button>
            ))}
          </div>
        </div>

        {currentMetrics && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800/30">
              <div className="text-sm text-blue-600 dark:text-blue-400 font-medium mb-1">RMSE</div>
              <div className="text-2xl font-bold text-blue-900 dark:text-blue-100">{currentMetrics.rmse.toFixed(4)}</div>
            </div>
            <div className="p-4 rounded-lg bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-100 dark:border-indigo-800/30">
              <div className="text-sm text-indigo-600 dark:text-indigo-400 font-medium mb-1">MAE</div>
              <div className="text-2xl font-bold text-indigo-900 dark:text-indigo-100">{currentMetrics.mae.toFixed(4)}</div>
            </div>
            <div className="p-4 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-200 dark:border-gray-700 col-span-2 flex items-center">
               <BarChart2 className="w-8 h-8 text-gray-400 mr-4" />
               <div>
                 <div className="text-sm text-gray-500 dark:text-gray-400 font-medium mb-1">Forecast Horizon</div>
                 <div className="text-lg font-bold text-gray-800 dark:text-gray-200">{forecastY.length} Steps Ahead</div>
               </div>
            </div>
          </div>
        )}

        <div id="results-plot-container" className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden h-[400px] mb-8 bg-gray-50 dark:bg-gray-800/30 relative">
          <Plot
              data={[
                {
                  x: historicalX,
                  y: historicalY,
                  type: 'scatter',
                  mode: 'lines+markers',
                  name: 'Historical',
                  marker: {color: '#64748b', size: 4}, // slate-500
                  line: {color: '#94a3b8', width: 2} // slate-400
                },
                {
                  x: [historicalX[historicalX.length - 1], ...forecastX], // connect the lines visually
                  y: [historicalY[historicalY.length - 1], ...forecastY],
                  type: 'scatter',
                  mode: 'lines+markers',
                  name: getModelName(selectedModel) + ' Forecast',
                  marker: {color: '#2563eb', size: 6}, // blue-600
                  line: {color: '#3b82f6', width: 3, dash: 'dot'} // blue-500
                }
              ]}
              layout={{
                autosize: true, 
                margin: { t: 30, r: 20, b: 50, l: 60 },
                paper_bgcolor: 'transparent',
                plot_bgcolor: 'transparent',
                showlegend: true,
                legend: { orientation: "h", yanchor: "bottom", y: 1.02, xanchor: "right", x: 1 },
                xaxis: { 
                  gridcolor: '#e2e8f0', 
                  title: { text: 'Time Step (Index)', font: { size: 14 } } 
                },
                yaxis: { 
                  gridcolor: '#e2e8f0', 
                  title: { text: targetColumn || 'Target Value', font: { size: 14 } } 
                }
              }}
              config={{
                displayModeBar: true,
                toImageButtonOptions: { filename: `forecast_${selectedModel}`, format: 'png', scale: 2 }
              }}
              onInitialized={(figure, graphDiv) => setGraphDiv(graphDiv)}
              onUpdate={(figure, graphDiv) => setGraphDiv(graphDiv)}
              style={{width: '100%', height: '100%'}}
              useResizeHandler={true}
            />
        </div>

        <div className="flex justify-end mb-8">
            <button 
              onClick={handleDownloadGraph}
              className="flex items-center space-x-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-50 hover:bg-blue-100 rounded-lg dark:bg-blue-900/30 dark:text-blue-300 dark:hover:bg-blue-900/50 transition-colors border border-blue-200 dark:border-blue-800/50"
            >
              <ImageIcon className="w-4 h-4" />
              <span>Save Graph Image</span>
            </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
           <button 
            onClick={handleDownload}
            disabled={!selectedModel}
            className="flex items-center justify-center space-x-2 p-3 rounded-lg border-2 border-blue-500 bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:border-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Download className="w-5 h-5" />
            <span className="font-semibold">Download Forecast (CSV)</span>
          </button>

           <button 
            onClick={reset}
            className="flex items-center justify-center space-x-2 p-3 rounded-lg border-2 border-gray-300 dark:border-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
          >
            <RefreshCw className="w-5 h-5" />
            <span className="font-semibold">Start New Project</span>
          </button>
        </div>
      </div>
    </div>
  );
}
