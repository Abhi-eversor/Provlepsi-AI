import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import http from 'node:http';
import { test } from 'node:test';
import ts from 'typescript';
import { chromium } from 'playwright';

// Standalone browser regression check: no server, credentials, or personal profile.
// Install the browser once with `npx playwright install chromium`, or select an
// installed channel through PLAYWRIGHT_CHANNEL (for example, chrome).
test('browser project storage is isolated and deletion removes only owned data', { timeout: 60_000 }, async () => {
 const source = await readFile(new URL('../src/lib/storage.ts', import.meta.url), 'utf8');
 const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
 const idb = await readFile(new URL('../node_modules/idb/build/index.js', import.meta.url), 'utf8');
 const server = http.createServer((req, res) => {
  if (req.url === '/storage.js' || req.url === '/idb.js') {
   res.setHeader('Content-Type', 'text/javascript'); res.end(req.url === '/storage.js' ? compiled : idb);
  } else { res.setHeader('Content-Type', 'text/html'); res.end('<script type="importmap">{"imports":{"idb":"/idb.js"}}</script>'); }
 });
 let browser;
 try {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const result=await page.evaluate(async()=>{
   const {storage,accountStateKey,modelStoragePrefix}=await import('/storage.js');
   const assert=(pass,message)=>{if(!pass)throw new Error(message); checks.push(message);}; const checks=[];
   await storage.clearAccount('1');
   assert(!(await indexedDB.databases()).some(db=>db.name==='tensorflowjs'),'Cleanup before first model save does not create a broken TensorFlow DB');
   const p1=crypto.randomUUID(),p2=crypto.randomUUID();
   await storage.saveRawDataset('1',p1,'a.csv','x\n1');
   await storage.saveRawDataset('1',p2,'b.csv','x\n2');
   await storage.saveRawDataset('2',p1,'c.csv','x\n3');
   await storage.saveCleanedData('1',p1,'processed');
   assert((await storage.getRawDataset('1',p1)).filename==='a.csv','Account 1 reads its own project');
   assert((await storage.getRawDataset('2',p1)).filename==='c.csv','Same project UUID is separately scoped per account');
   assert(await storage.getRawDataset('2',p2)===undefined,'Account 2 cannot resolve account 1 project');
   const seedDB=await new Promise((resolve,reject)=>{const req=indexedDB.open('tensorflowjs',1);req.onupgradeneeded=()=>{req.result.createObjectStore('models_store',{keyPath:'modelPath'});req.result.createObjectStore('model_info_store',{keyPath:'modelPath'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});
   const keys=[modelStoragePrefix('1',p1)+'run/lstm',modelStoragePrefix('1',p2)+'run/gru',modelStoragePrefix('2',p1)+'run/transformer','legacy-lstm'];
   const tx=seedDB.transaction(['models_store','model_info_store'],'readwrite');
   for(const name of ['models_store','model_info_store'])for(const key of keys)tx.objectStore(name).put({modelPath:key});
   await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});seedDB.close();
   const modelKeys=async()=>{const db=await new Promise((resolve,reject)=>{const req=indexedDB.open('tensorflowjs');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});try{return await new Promise((resolve,reject)=>{const req=db.transaction('model_info_store').objectStore('model_info_store').getAllKeys();req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}finally{db.close();}};
   await storage.deleteProject('1',p1);
   assert(await storage.getRawDataset('1',p1)===undefined&&await storage.getCleanedData('1',p1)===undefined,'Project deletion awaits raw and processed data removal');
   assert((await modelKeys()).length===3&&!(await modelKeys()).includes(keys[0]),'Project deletion removes only that project neural weights');
   localStorage.setItem(accountStateKey('1'),'one');localStorage.setItem(accountStateKey('2'),'two');
   await storage.clearAccount('1');
   assert(await storage.getRawDataset('1',p2)===undefined&&(await storage.getRawDataset('2',p1)).filename==='c.csv','Signout cleanup preserves another account dataset');
   assert(localStorage.getItem(accountStateKey('1'))===null&&localStorage.getItem(accountStateKey('2'))==='two','Signout cleanup removes only its account state');
   assert((await modelKeys()).length===2&&(await modelKeys()).includes(keys[2]),'Signout cleanup preserves another account neural weights and legacy data');
   localStorage.setItem('automl-studio-state','legacy');
   assert(await storage.hasLegacyData(),'Legacy data is detected without adoption');
   await storage.clearLegacyData();
   assert(!await storage.hasLegacyData()&&localStorage.getItem('automl-studio-state')===null,'Explicit legacy deletion clears unscoped state and weights');
   assert((await modelKeys()).length===1&&(await modelKeys())[0]===keys[2],'Legacy deletion preserves current scoped neural weights');
   const failureProject=crypto.randomUUID();
   await storage.saveRawDataset('3',failureProject,'retry.csv','x\n4');
   const originalDelete=IDBObjectStore.prototype.delete;
   let deletionFailed=false;
   try {
    IDBObjectStore.prototype.delete=function(key){ const request=originalDelete.call(this,key); this.transaction.abort(); return request; };
    await storage.deleteProject('3',failureProject);
   } catch { deletionFailed=true; }
   finally { IDBObjectStore.prototype.delete=originalDelete; }
   assert(deletionFailed&&(await storage.getRawDataset('3',failureProject)).filename==='retry.csv','Aborted deletion reports failure and preserves data for retry');
   return {passed:checks.length,checks};
  });
  assert.equal(result.passed, 13);
  await page.waitForTimeout(50);
  assert.deepEqual(errors, [], 'Storage operations must not produce unhandled rejections');
 } finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
 }
});
