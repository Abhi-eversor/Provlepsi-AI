import { openDB, wrap, type DBSchema, type IDBPDatabase } from 'idb';

interface ProjectDB extends DBSchema {
  datasets: {
    key: string;
    value: { id: string; accountId: string; projectId: string; rawContent: string; filename: string; timestamp: number };
    indexes: { accountId: string };
  };
  cleaned_data: {
    key: string;
    value: { id: string; accountId: string; projectId: string; content: string; timestamp: number };
    indexes: { accountId: string };
  };
}

let dbPromise: Promise<IDBPDatabase<ProjectDB>> | null = null;
export const accountStateKey = (accountId: string) => `provlepsi-state-v2:${accountId}`;
export const projectKey = (accountId: string, projectId: string) => {
  if (!/^[1-9]\d*$/.test(accountId) || !/^[a-f\d-]{36}$/i.test(projectId)) throw new Error('Invalid account or project identifier.');
  return `${accountId}:${projectId}`;
};
export const modelStoragePrefix = (accountId: string, projectId?: string) => {
  if (!/^[1-9]\d*$/.test(accountId)) throw new Error('Invalid account identifier.');
  if (projectId) projectKey(accountId, projectId);
  return `provlepsi/${accountId}/${projectId ? `${projectId}/` : ''}`;
};

export const getDB = () => {
  if (!dbPromise) {
    dbPromise = openDB<ProjectDB>('provlepsi-projects-v2', 1, {
      upgrade(db) {
        for (const name of ['datasets', 'cleaned_data'] as const) {
          db.createObjectStore(name, { keyPath: 'id' }).createIndex('accountId', 'accountId');
        }
      },
    }).catch(error => { dbPromise = null; throw error; });
  }
  return dbPromise;
};

// TF.js 4.x stores artifacts and metadata separately. Delete only owned paths,
// in one awaited transaction; never delete another account's database.
async function existingModelDB(): Promise<IDBPDatabase | null> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('tensorflowjs');
    let creating = false;
    request.onupgradeneeded = () => {
      // Do not create a version-1 DB without the stores TF.js needs. Use the
      // native transaction: wrapping an intentionally aborted upgrade creates
      // an unrelated rejected idb transaction.done promise.
      creating = true;
      request.transaction!.abort();
    };
    request.onsuccess = () => resolve(wrap(request.result));
    request.onerror = () => {
      if (creating && request.error?.name === 'AbortError') resolve(null);
      else reject(request.error ?? new Error('Could not inspect saved neural models.'));
    };
  });
}
async function deleteModelPaths(prefix: string) {
  const db = await existingModelDB();
  if (!db) return;
  try {
    const names = ['models_store', 'model_info_store'].filter(name => db.objectStoreNames.contains(name));
    if (!names.length) return;
    const tx = db.transaction(names, 'readwrite');
    await Promise.all([...names.map(async name => {
      const store = tx.objectStore(name);
      let cursor = await store.openCursor();
      while (cursor) {
        if (typeof cursor.key === 'string' && cursor.key.startsWith(prefix)) await cursor.delete();
        cursor = await cursor.continue();
      }
    }), tx.done]);
  } finally { db.close(); }
}

export const storage = {
  async saveRawDataset(accountId: string, projectId: string, filename: string, rawContent: string) {
    const db = await getDB();
    await db.put('datasets', { id: projectKey(accountId, projectId), accountId, projectId, filename, rawContent, timestamp: Date.now() });
  },
  async getRawDataset(accountId: string, projectId: string) {
    return (await getDB()).get('datasets', projectKey(accountId, projectId));
  },
  async saveCleanedData(accountId: string, projectId: string, content: string) {
    await (await getDB()).put('cleaned_data', { id: projectKey(accountId, projectId), accountId, projectId, content, timestamp: Date.now() });
  },
  async getCleanedData(accountId: string, projectId: string) {
    return (await getDB()).get('cleaned_data', projectKey(accountId, projectId));
  },
  async deleteProject(accountId: string, projectId: string) {
    const id = projectKey(accountId, projectId);
    const db = await getDB();
    const tx = db.transaction(['datasets', 'cleaned_data'], 'readwrite');
    // Start operations after all rejection handlers are attached. A synchronous
    // failure in a later request must not leave earlier requests unhandled.
    await Promise.all([
      Promise.resolve().then(() => tx.objectStore('datasets').delete(id)),
      Promise.resolve().then(() => tx.objectStore('cleaned_data').delete(id)),
      tx.done,
    ]);
    await deleteModelPaths(modelStoragePrefix(accountId, projectId));
  },
  async clearAccount(accountId: string) {
    modelStoragePrefix(accountId);
    const db = await getDB();
    const tx = db.transaction(['datasets', 'cleaned_data'], 'readwrite');
    await Promise.all([...(['datasets', 'cleaned_data'] as const).map(async name => {
      let cursor = await tx.objectStore(name).index('accountId').openCursor(accountId);
      while (cursor) { await cursor.delete(); cursor = await cursor.continue(); }
    }), tx.done]);
    await deleteModelPaths(modelStoragePrefix(accountId));
    localStorage.removeItem(accountStateKey(accountId));
  },
  async hasLegacyData() {
    if (localStorage.getItem('automl-studio-state')) return true;
    if (typeof indexedDB.databases === 'function' && (await indexedDB.databases()).some(db => db.name === 'automl-studio-db')) return true;
    const db = await existingModelDB();
    if (!db) return false;
    try {
      if (!db.objectStoreNames.contains('model_info_store')) return false;
      return (await db.getAllKeys('model_info_store')).some(key => typeof key === 'string' && !key.startsWith('provlepsi/'));
    } finally { db.close(); }
  },
  async clearLegacyData() {
    await new Promise<void>((resolve, reject) => {
      const request = indexedDB.deleteDatabase('automl-studio-db');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Close other application tabs before deleting legacy data.'));
    });
    const db = await existingModelDB();
    if (!db) { localStorage.removeItem('automl-studio-state'); return; }
    try {
      const names = ['models_store', 'model_info_store'].filter(name => db.objectStoreNames.contains(name));
      if (names.length) {
        const tx = db.transaction(names, 'readwrite');
        await Promise.all([...names.map(async name => {
          let cursor = await tx.objectStore(name).openCursor();
          while (cursor) {
            if (typeof cursor.key === 'string' && !cursor.key.startsWith('provlepsi/')) await cursor.delete();
            cursor = await cursor.continue();
          }
        }), tx.done]);
      }
    } finally { db.close(); }
    localStorage.removeItem('automl-studio-state');
  },
};
