'use client';

import React from 'react';
import { useStore } from '../store/useStore';
import StepUpload from './StepUpload';
import StepEDA from './StepEDA';
import StepModelConfig from './StepModelConfig';
import StepTrain from './StepTrain';
import StepResults from './StepResults';

export default function Wizard() {
  const { currentStep } = useStore();

  const steps = ['UPLOAD', 'EDA', 'MODEL', 'TRAIN', 'RESULTS'];
  
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 py-4 px-6 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
            Time-Series AutoML Studio
          </h1>
          
          <div className="flex items-center space-x-6">
            <nav className="hidden md:flex space-x-2">
              {steps.map((step, idx) => (
                <div key={step} className="flex items-center">
                  <button 
                    onClick={() => useStore.getState().setStep(step as any)}
                    className={`px-3 py-1 rounded-full text-xs font-semibold tracking-wider transition-colors cursor-pointer hover:opacity-80 ${
                      currentStep === step 
                        ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300' 
                        : steps.indexOf(currentStep) > idx
                        ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                        : 'text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
                    }`}>
                    {idx + 1}. {step}
                  </button>
                  {idx < steps.length - 1 && (
                    <div className="w-4 h-px bg-gray-300 dark:bg-gray-700 mx-2" />
                  )}
                </div>
              ))}
            </nav>
            <button 
              onClick={async () => {
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login';
              }}
              className="text-sm font-medium text-gray-500 hover:text-gray-900 dark:hover:text-gray-200 transition-colors"
            >
              Sign Out
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto p-6">
        {currentStep === 'UPLOAD' && <StepUpload />}
        {currentStep === 'EDA' && <StepEDA />}
        {currentStep === 'MODEL' && <StepModelConfig />}
        {currentStep === 'TRAIN' && <StepTrain />}
        {currentStep === 'RESULTS' && <StepResults />}
      </main>
    </div>
  );
}
