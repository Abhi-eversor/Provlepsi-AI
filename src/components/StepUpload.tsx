'use client';

import React, { useState } from 'react';
import { useStore } from '../store/useStore';
import { storage } from '../lib/storage';
import { getPyodideAPI } from '../lib/workerHelper';
import { UploadCloud, Loader2 } from 'lucide-react';

export default function StepUpload() {
  const { setDataset, setStep } = useStore();
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setLoading(true);
    setStatusMsg('Reading file...');

    try {
      const text = await file.text();
      const datasetId = 'ds-' + Date.now();
      
      setStatusMsg('Saving to local storage...');
      await storage.saveRawDataset(datasetId, file.name, text);
      
      setStatusMsg('Initializing local Python engine...');
      const pyodideApi = getPyodideAPI();
      if (!pyodideApi) throw new Error("Worker not available");
      
      // We pass a callback via comlink (proxy) for progress updates if we want,
      // but for simplicity we'll just wait.
      await pyodideApi.init();
      
      setStatusMsg('Parsing dataset...');
      const preview = await pyodideApi.getPreview(text);
      
      if (preview.error) {
        throw new Error(preview.error);
      }
      
      setDataset(datasetId, preview);
      setStep('EDA');
    } catch (err: any) {
      alert("Error parsing file: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">Upload your Dataset</h2>
        <p className="text-gray-600 dark:text-gray-400">Dataset processing and model training run in your browser. Account details are sent to the sign-in service.</p>
      </div>
      
      <div className="border-2 border-dashed border-blue-500 rounded-xl p-12 text-center bg-blue-50 dark:bg-blue-900/20 relative">
        <input 
          type="file" 
          accept=".csv" 
          onChange={handleFileUpload} 
          disabled={loading}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
        />
        
        {loading ? (
          <div className="flex flex-col items-center justify-center space-y-4">
            <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
            <p className="text-blue-600 dark:text-blue-400 font-medium">{statusMsg}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-blue-100 dark:bg-blue-800 rounded-full flex items-center justify-center">
              <UploadCloud className="w-8 h-8 text-blue-600 dark:text-blue-300" />
            </div>
            <p className="text-xl font-semibold text-gray-800 dark:text-gray-200">Click to Choose a CSV File</p>
            <p className="text-sm text-gray-500 dark:text-gray-400">Supports .csv files</p>
          </div>
        )}
      </div>
    </div>
  );
}
