'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useStore, type WizardStep } from '../store/useStore';
import { storage, accountStateKey } from '../lib/storage';
import { cancelActiveWorkers } from '../lib/workerHelper';
import { broadcastSignOut, broadcastProjectDeletion, getSessionClientId, isAccountSessionEvent, SESSION_CHANNEL, SESSION_EVENT_KEY } from '../lib/session-events';
import StepUpload from './StepUpload';
import StepEDA from './StepEDA';
import StepModelConfig from './StepModelConfig';
import StepTrain from './StepTrain';
import StepResults from './StepResults';

const steps: WizardStep[] = ['UPLOAD', 'EDA', 'MODEL', 'TRAIN', 'RESULTS'];
export default function Wizard() {
  const router = useRouter();
  const { currentStep, ready, accountId, datasetId, targetColumn, modelsToTrain, modelResults, persistenceError } = useStore();
  const [user, setUser] = useState<{ id: number; name: string } | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [legacy, setLegacy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const clientId = useRef(getSessionClientId());
  const endingSession = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let verifiedAccount: string | null = null;
    let sessionEnding = false;
    let identitySequence = 0;
    const received = new Set<string>();
    const validateIdentity = async () => {
      if (sessionEnding || endingSession.current) return;
      const sequence = ++identitySequence;
      try {
        const response = await fetch('/api/auth/me', { cache: 'no-store', signal: controller.signal });
        if (!active || sequence !== identitySequence || sessionEnding || endingSession.current) return;
        if (response.status === 401) {
          cancelActiveWorkers();
          useStore.getState().clearSession();
          router.replace('/login');
          return;
        }
        if (!response.ok) throw new Error('Could not verify your account. Please retry.');
        const data = await response.json();
        if (!Number.isSafeInteger(data.user?.id) || data.user.id <= 0) throw new Error('Invalid account response.');
        if (!active || sequence !== identitySequence || sessionEnding || endingSession.current) return;
        const id = String(data.user.id);
        verifiedAccount = id;
        if (useStore.getState().accountId !== id || !useStore.getState().ready) {
          cancelActiveWorkers();
          useStore.getState().clearSession();
          useStore.getState().initializeAccount(id);
        }
        setUser(data.user);
        setError('');
        const hasLegacy = await storage.hasLegacyData();
        if (active && sequence === identitySequence && !sessionEnding && !endingSession.current) setLegacy(hasLegacy);
      } catch (cause) {
        if (!active || sequence !== identitySequence || controller.signal.aborted || sessionEnding || endingSession.current) return;
        cancelActiveWorkers();
        useStore.getState().clearSession();
        setUser(null);
        setError(cause instanceof Error ? cause.message : 'Account verification failed.');
      }
    };
    void validateIdentity();
    const handleSessionEvent = (message: unknown) => {
      if (!isAccountSessionEvent(message) || message.sender === clientId.current || received.has(message.id)) return;
      received.add(message.id);
      if (message.phase === 'identity-change') {
        identitySequence++;
        cancelActiveWorkers();
        useStore.getState().clearSession();
        verifiedAccount = null;
        setUser(null);
        void validateIdentity();
        return;
      }
      if (message.accountId !== verifiedAccount) return;
      if (message.phase === 'project-delete') {
        if (useStore.getState().projectId !== message.projectId) return;
        cancelActiveWorkers();
        useStore.getState().reset();
        setError('The active project was deleted in another tab.');
        void storage.deleteProject(message.accountId, message.projectId!).catch(() => setError('Project cleanup failed. Close other tabs and retry deletion.'));
        return;
      }
      sessionEnding = true;
      endingSession.current = true;
      cancelActiveWorkers();
      useStore.getState().clearSession();
      setError('Sign-out started in another tab. Local work has stopped.');
      // A second pass after this tab stops its workers removes late artifacts.
      void storage.clearAccount(message.accountId).then(() => {
        if (active && message.phase === 'signout-complete') router.replace('/login');
      }).catch(() => setError('Close other tabs and retry local data deletion.'));
    };
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(SESSION_CHANNEL);
    if (channel) channel.onmessage = event => handleSessionEvent(event.data);
    const onFocus = () => { if (document.visibilityState === 'visible') void validateIdentity(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === SESSION_EVENT_KEY && event.newValue) {
        try { handleSessionEvent(JSON.parse(event.newValue)); } catch { /* Ignore malformed cross-tab notifications. */ }
        return;
      }
      const id = useStore.getState().accountId;
      if (id && event.key === accountStateKey(id) && event.newValue === null) {
        cancelActiveWorkers();
        useStore.getState().clearSession();
        void validateIdentity();
      }
    };
    window.addEventListener('focus', onFocus);
    window.addEventListener('storage', onStorage);
    return () => {
      active = false;
      identitySequence++;
      controller.abort();
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('storage', onStorage);
      channel?.close();
      cancelActiveWorkers();
      useStore.getState().clearSession();
    };
  }, [router, attempt]);

  const signOut = async () => {
    if (!user || busy) return;
    setBusy(true);
    setError('');
    endingSession.current = true;
    broadcastSignOut(String(user.id), clientId.current, 'signout-start');
    cancelActiveWorkers();
    useStore.getState().clearSession();
    try {
      // Clear before removing the session; failed deletion is visible and retryable.
      await storage.clearAccount(String(user.id));
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Sign-out could not be completed. Please retry.');
      broadcastSignOut(String(user.id), clientId.current, 'signout-complete');
      router.replace('/login');
      router.refresh();
    } catch (cause) {
      setError(`${cause instanceof Error ? cause.message : 'Local deletion failed.'} Sign-out was not completed. Retry Sign Out; other tabs may need to close.`);
    } finally { setBusy(false); }
  };
  const deleteCurrentProject = async () => {
    const state = useStore.getState();
    if (!state.accountId || !state.projectId || busy || !confirm('Permanently delete this project and its saved datasets, results, and neural weights?')) return;
    cancelActiveWorkers();
    broadcastProjectDeletion(state.accountId, state.projectId);
    if (state.currentStep === 'TRAIN') state.setStep('MODEL');
    setBusy(true);
    setError('');
    try { await storage.deleteProject(state.accountId, state.projectId); useStore.getState().reset(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Project deletion failed. Please retry.'); }
    finally { setBusy(false); }
  };
  const canNavigate = (step: WizardStep) => step === 'UPLOAD'
    || (step === 'EDA' && !!datasetId)
    || (step === 'MODEL' && !!datasetId && !!targetColumn)
    || (step === 'TRAIN' && currentStep === 'TRAIN' && !!modelsToTrain.length)
    || (step === 'RESULTS' && !!Object.keys(modelResults).length);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 transition-colors">
      <header className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 py-4 px-6 sticky top-0 z-10 shadow-sm">
        <div className="max-w-6xl mx-auto flex items-center justify-between gap-4">
          <h1 className="text-xl font-bold text-blue-600">Provlepsi-AI</h1>
          {ready && <nav className="hidden md:flex gap-2" aria-label="Project steps">
            {steps.map((step, index) => <button key={step} disabled={!canNavigate(step) || busy}
              onClick={() => { if (step !== currentStep) cancelActiveWorkers(); useStore.getState().setStep(step); }}
              className={`px-3 py-1 rounded-full text-xs font-semibold disabled:opacity-40 ${currentStep === step ? 'bg-blue-100 text-blue-700' : 'text-gray-500'}`}>
              {index + 1}. {step}
            </button>)}
          </nav>}
          <div className="flex items-center gap-3">
            {ready && datasetId && <button onClick={deleteCurrentProject} disabled={busy} className="text-xs text-red-600 disabled:opacity-50">Delete Project</button>}
            {user && <button onClick={signOut} disabled={busy} className="text-sm font-medium text-gray-600 dark:text-gray-300 disabled:opacity-50">{busy ? 'Clearing local data...' : 'Sign Out'}</button>}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto p-6">
        {error && <div role="alert" className="mb-4 rounded border border-red-300 bg-red-50 p-4 text-red-800">
          {error} {!user && <button className="underline ml-2" onClick={() => setAttempt(value => value + 1)}>Retry</button>}
        </div>}
        {persistenceError && <p role="alert" className="mb-4 text-amber-700">{persistenceError}</p>}
        {ready && legacy && <div className="mb-4 rounded border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          Older unscoped browser data exists. It has not been assigned to this account. Local storage is accessible to people using this browser profile.
          <button disabled={busy} className="ml-2 underline" onClick={async () => {
            if (!confirm('Permanently delete legacy unscoped datasets, state, and model weights from this browser?')) return;
            setBusy(true);
            try { await storage.clearLegacyData(); setLegacy(false); }
            catch { setError('Legacy data could not be deleted. Close other application tabs and retry.'); }
            finally { setBusy(false); }
          }}>Delete legacy data</button>
        </div>}
        {!ready && !error && <p className="py-12 text-center text-gray-500">Verifying account...</p>}
        {ready && accountId && !busy && <>
          <p className="mb-4 text-xs text-gray-500">Signed in as {user?.name}. Projects stay in this browser and are cleared on Sign Out.</p>
          {currentStep === 'UPLOAD' && <StepUpload />}
          {currentStep === 'EDA' && <StepEDA />}
          {currentStep === 'MODEL' && <StepModelConfig />}
          {currentStep === 'TRAIN' && <StepTrain />}
          {currentStep === 'RESULTS' && <StepResults />}
        </>}
      </main>
    </div>
  );
}
