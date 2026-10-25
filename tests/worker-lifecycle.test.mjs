import assert from 'node:assert/strict';
import { test } from 'node:test';
import { awaitWorkerResult, startWorkerRun, cancelActiveWorkers, isWorkerRunCurrent } from '../src/lib/workerHelper.ts';

test('cancelling a run releases a caller waiting on a terminated worker', async () => {
  const generation = startWorkerRun();
  const pending = awaitWorkerResult(new Promise(() => {}), generation);
  cancelActiveWorkers();
  await assert.rejects(pending, error => error.name === 'AbortError');
  assert.equal(isWorkerRunCurrent(generation), false);
});
test('a superseded run cannot await or accept a result as current', async () => {
  const previous = startWorkerRun();
  const current = startWorkerRun();
  await assert.rejects(awaitWorkerResult(Promise.resolve('stale'), previous), error => error.name === 'AbortError');
  assert.equal(await awaitWorkerResult(Promise.resolve('current'), current), 'current');
  cancelActiveWorkers();
});
