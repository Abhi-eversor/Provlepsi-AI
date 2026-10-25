'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useStore, type DatasetPreview } from '../store/useStore';
import { storage } from '../lib/storage';
import { getPyodideAPI, startWorkerRun, isWorkerRunCurrent, cancelActiveWorkers, awaitWorkerResult } from '../lib/workerHelper';
import { UploadCloud, Loader2 } from 'lucide-react';

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
export default function StepUpload() {
  const { accountId, setDataset, setStep } = useStore();
  const [loading, setLoading] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [error, setError] = useState('');
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; cancelActiveWorkers(); }; }, []);
  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !accountId || loading) return;
    if (!file.name.toLowerCase().endsWith('.csv') || file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
      setError('Choose a nonempty CSV file no larger than 5 MiB.');
      return;
    }
    const generation = startWorkerRun();
    const active = () => mounted.current && isWorkerRunCurrent(generation) && useStore.getState().accountId === accountId;
    const projectId = crypto.randomUUID();
    setLoading(true);
    setError('');
    try {
      setStatusMsg('Reading file...');
      let content: string;
      try { content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer()); }
      catch { throw new Error('The CSV must use UTF-8 encoding. Export it as UTF-8 CSV and retry.'); }
      if (!active()) return;
      if (content.includes('\0')) throw new Error('The file contains binary data. Choose a UTF-8 CSV file.');
      setStatusMsg('Loading Python and parsing CSV...');
      const api = getPyodideAPI();
      if (!api) throw new Error('Worker unavailable.');
      const preview = await awaitWorkerResult(api.getPreview(content), generation) as DatasetPreview & { error?: string };
      if (!active()) return;
      if (preview.error) throw new Error(preview.error);
      if (!preview.columns?.length || !preview.shape?.[0]) throw new Error('The CSV has no data rows.');
      setStatusMsg('Saving this account project...');
      await storage.saveRawDataset(accountId, projectId, file.name, content);
      if (!active()) { await storage.deleteProject(accountId, projectId); return; }
      setDataset(projectId, preview);
      setStep('EDA');
    } catch (cause) {
      if (active()) setError(cause instanceof Error ? cause.message : 'Could not parse or save the CSV.');
    } finally { if (active()) setLoading(false); }
  };
  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold mb-4 dark:text-white">Upload your Dataset</h2>
        <p className="text-gray-600 dark:text-gray-400">CSV processing and model training run in your browser. Account details are sent to the sign-in service. Use observations in chronological order with a consistent interval.</p>
      </div>
      {error && <p role="alert" className="mb-4 text-red-600">{error}</p>}
      <div className="border-2 border-dashed border-blue-500 rounded-xl p-12 text-center bg-blue-50 dark:bg-blue-900/20 relative">
        <input aria-label="Upload CSV dataset" type="file" accept=".csv,text/csv" onChange={handleFileUpload} disabled={loading} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed" />
        <div className="flex flex-col items-center justify-center space-y-4">
          {loading ? <Loader2 className="w-12 h-12 text-blue-500 animate-spin" /> : <UploadCloud className="w-12 h-12 text-blue-500" />}
          <p className="text-xl font-semibold dark:text-gray-200">{loading ? statusMsg : 'Click to Choose a CSV File'}</p>
          <p className="text-sm text-gray-500">UTF-8 CSV / maximum 5 MiB / bounded training window</p>
        </div>
      </div>
      {loading && <button onClick={() => { cancelActiveWorkers(); setLoading(false); setStatusMsg(''); }} className="mt-4 text-sm underline">Cancel upload</button>}
    </div>
  );
}
