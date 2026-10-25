import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { broadcastSignOut, broadcastProjectDeletion, broadcastIdentityChange, isAccountSessionEvent, SESSION_EVENT_KEY } from '../src/lib/session-events.ts';

const originalStorage = globalThis.localStorage;
const originalChannel = globalThis.BroadcastChannel;
afterEach(() => {
  if (originalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = originalStorage;
  globalThis.BroadcastChannel = originalChannel;
});
test('cross-tab notifications carry scoped identity without retaining account metadata', () => {
  const values = new Map();
  const events = [];
  const messages = [];
  globalThis.localStorage = {
    setItem: (key, value) => { values.set(key, value); events.push(JSON.parse(value)); },
    removeItem: key => values.delete(key),
  };
  globalThis.BroadcastChannel = class {
    postMessage(message) { messages.push(message); }
    close() {}
  };
  broadcastSignOut('1', 'this-tab', 'signout-start');
  const projectId = crypto.randomUUID();
  broadcastProjectDeletion('2', projectId);
  broadcastIdentityChange();
  assert.equal(values.has(SESSION_EVENT_KEY), false);
  assert.equal(events.length, 3);
  assert.equal(messages[0].accountId, '1');
  assert.equal(messages[0].phase, 'signout-start');
  assert.equal(messages[1].accountId, '2');
  assert.equal(messages[1].projectId, projectId);
  assert.equal(messages[1].phase, 'project-delete');
  assert.equal(messages[2].phase, 'identity-change');
  assert.equal('accountId' in messages[2], false);
  assert.ok(messages.every(isAccountSessionEvent));
  assert.notEqual(messages[0].id, messages[1].id);
});
test('malformed cross-tab messages and unscoped project deletions are rejected', () => {
  assert.equal(isAccountSessionEvent(null), false);
  assert.equal(isAccountSessionEvent({ accountId: '0', sender: 'x', id: 'x', phase: 'signout-start' }), false);
  assert.equal(isAccountSessionEvent({ accountId: '1', sender: 'x', id: 'x', phase: 'project-delete' }), false);
  assert.equal(isAccountSessionEvent({ accountId: '1', sender: 'x', id: 'x', phase: 'unknown' }), false);
});
