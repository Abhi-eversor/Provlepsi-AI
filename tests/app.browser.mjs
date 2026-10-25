// Production integration smoke: real workers/storage/charts, synthetic identity only.
// Run npm run build first. This deliberately does not claim live Neon authentication coverage.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { SignJWT } from 'jose';

const listener = createServer();
await new Promise(resolve => listener.listen(0, '127.0.0.1', resolve));
const port = listener.address().port;
await new Promise(resolve => listener.close(resolve));
const origin = `http://127.0.0.1:${port}`;
const secret = randomBytes(32).toString('hex');
const environment = { ...process.env, JWT_SECRET: secret, APP_ORIGIN: origin };
delete environment.DATABASE_URL;
delete environment.AUTH_TEST_DATABASE_URL;
const server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', String(port)], { env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let serverOutput = '';
server.stdout.on('data', chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-8000); });
server.stderr.on('data', chunk => { serverOutput = (serverOutput + chunk.toString()).slice(-8000); });
let browser;
const temporaryRoot = await realpath(tmpdir());
const outputDirectory = await mkdtemp(join(temporaryRoot, 'provlepsi-browser-'));
const checks = [];
const errors = [];
let stage = 'startup';
let modelCount = 0;
try {
  let ready = false;
  for (let attempt = 0; attempt < 240; attempt++) {
    if (server.exitCode !== null) throw new Error(`Production server exited: ${serverOutput}`);
    try { if ((await fetch(`${origin}/login`, { signal: AbortSignal.timeout(1000) })).ok) { ready = true; break; } } catch { /* startup */ }
    await delay(250);
  }
  assert.ok(ready, `Production server did not start: ${serverOutput}`);
  process.stdout.write('Production server ready\n');
  assert.equal((await fetch(origin, { redirect: 'manual' })).status, 307);
  assert.equal((await fetch(`${origin}/api/auth/me`)).status, 401);
  assert.equal((await fetch(`${origin}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://foreign.example.invalid' }, body: '{}' })).status, 403);
  checks.push('Anonymous routing and cross-origin mutation rejection');
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ acceptDownloads: true });
  context.setDefaultTimeout(30000);
  context.setDefaultNavigationTimeout(60000);
  const page = await context.newPage();
  const observe = page => {
    page.on('pageerror', error => { errors.push({ stage, message: error.message, stack: error.stack }); process.stderr.write(`Browser error during ${stage}: ${error.stack ?? error.message}\n`); });
    page.on('console', message => { if (message.type() === 'error') errors.push({ stage, message: message.text(), location: message.location() }); });
  };
  observe(page);
  let accountId = 1;
  let holdNextIdentity = false;
  let releaseHeldIdentity;
  let heldIdentityStarted;
  await page.route('**/api/auth/me', async route => {
    const responseAccount = accountId;
    if (holdNextIdentity) {
      holdNextIdentity = false;
      await new Promise(resolve => { releaseHeldIdentity = resolve; heldIdentityStarted?.(); });
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: responseAccount, name: `Synthetic account ${responseAccount}`, email: `account${responseAccount}@example.invalid` } }) });
  });
  const token = await new SignJWT({ userId: 1, email: 'account1@example.invalid' }).setProtectedHeader({ alg: 'HS256' }).setIssuedAt().setExpirationTime('7d').sign(new TextEncoder().encode(secret));
  await context.addCookies([{ name: 'session', value: token, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(origin);
  await page.getByRole('heading', { name: 'Upload your Dataset' }).waitFor();
  process.stdout.write('Synthetic account ready\n');
  stage = 'identity response ordering';
  const identityHeld = new Promise(resolve => { heldIdentityStarted = resolve; });
  holdNextIdentity = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await identityHeld;
  accountId = 2;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.getByText('Signed in as Synthetic account 2.', { exact: false }).waitFor();
  releaseHeldIdentity();
  await delay(250);
  assert.ok(await page.getByText('Signed in as Synthetic account 2.', { exact: false }).isVisible());
  accountId = 1;
  const identityPage = await context.newPage();
  await identityPage.route('**/__test/blank', route => route.fulfill({ contentType: 'text/html', body: '<title>Synthetic identity notifier</title>' }));
  await identityPage.goto(`${origin}/__test/blank`);
  await identityPage.evaluate(() => {
    localStorage.setItem('provlepsi-session-event-v2', JSON.stringify({ phase: 'identity-change', sender: 'synthetic-login-tab', id: crypto.randomUUID() }));
    localStorage.removeItem('provlepsi-session-event-v2');
  });
  await page.getByText('Signed in as Synthetic account 1.', { exact: false }).waitFor();
  await identityPage.close();
  await page.bringToFront();
  checks.push('Stale account lookup cannot overwrite a newer identity; cross-tab login invalidates the active identity');
  if (!process.env.BROWSER_IDENTITY_ONLY) {
  stage = 'CSV parsing and preprocessing';
  const rows = ['note,value,constant'];
  for (let i = 0; i < 620; i++) rows.push(`"quoted, field ${i}",${i === 330 ? '' : i === 400 ? 1000 : 10 + i / 20 + Math.sin(i / 8)},1`);
  await page.locator('input[type=file]').setInputFiles({ name: 'synthetic.csv', mimeType: 'text/csv', buffer: Buffer.from(rows.join('\n')) });
  await page.getByRole('heading', { name: 'Preprocessing Strategies' }).waitFor({ timeout: 180000 });
  process.stdout.write('CSV uploaded and parsed\n');
  const selects = page.locator('select');
  await selects.nth(0).selectOption('value');
  await selects.nth(1).selectOption('mean');
  await selects.nth(2).selectOption('clip');
  await page.getByRole('button', { name: 'Preview preprocessing' }).click();
  await page.getByText('First 12 prepared training observations', { exact: false }).waitFor({ timeout: 60000 });
  process.stdout.write('Preprocessing preview ready\n');
  await page.waitForFunction(() => Boolean(document.querySelector('.js-plotly-plot')?._fullLayout));
  const edaDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Graph Image', exact: true }).click();
  const edaPng = await edaDownload;
  await edaPng.saveAs(join(outputDirectory, 'eda.png'));
  assert.equal((await readFile(join(outputDirectory, 'eda.png'))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  checks.push('Quoted CSV pandas parsing, applied preprocessing preview, actual EDA PNG');
  process.stdout.write('EDA PNG downloaded\n');
  stage = 'strict CSV fixtures';
  const pythonWorkerURL = page.workers()[0]?.url();
  assert.ok(pythonWorkerURL, 'Python worker is running');
  const comlinkModule = await readFile(new URL('../node_modules/comlink/dist/esm/comlink.mjs', import.meta.url), 'utf8');
  await page.route('**/__test/comlink.mjs', route => route.fulfill({ contentType: 'text/javascript', body: comlinkModule }));
  const csvFixtures = await page.evaluate(async workerURL => {
    const Comlink = await import('/__test/comlink.mjs');
    const worker = new Worker(workerURL);
    const api = Comlink.wrap(worker);
    try {
      return await Promise.race([(async () => {
        let rejected = 0;
        for (const csv of ['time,value\n0,1,2\n1,2,3', 'time,value\n0\n1,2', 'time,value\n"unfinished,1', 'value,value\n1,2']) {
          try { await api.getPreview(csv); } catch { rejected++; }
        }
        for (const csv of ['value\n12oops', 'value\ninf']) {
          try { await api.parseDataset(csv, 'value'); } catch { rejected++; }
        }
        const valid = await api.parseDataset('\ufeffnote,value\n"quoted, comma",1\n"two\nlines",2', 'value');
        return { rejected, values: valid.target, rows: valid.sourceRowCount };
      })(), new Promise((_, reject) => setTimeout(() => reject(new Error('CSV worker fixtures timed out.')), 120000))]);
    } finally { api[Comlink.releaseProxy](); worker.terminate(); }
  }, pythonWorkerURL);
  assert.deepEqual(csvFixtures, { rejected: 6, values: [1, 2], rows: 2 });
  checks.push('Real Pyodide strict CSV fixtures: row widths, quotes, duplicate headers, malformed/infinite targets, BOM and multiline fields');
  stage = 'model training';
  await page.getByRole('button', { name: /Continue/ }).click();
  await page.getByRole('heading', { name: 'Model Selection' }).waitFor();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByRole('spinbutton', { name: 'Neural training epochs' }).fill('1');
  await page.getByRole('spinbutton', { name: 'Lag/window length' }).fill('5');
  await page.getByRole('spinbutton', { name: 'Future forecast steps' }).fill('7');
  await page.getByRole('button', { name: 'Start Training', exact: true }).click();
  const deadline = Date.now() + 300000;
  while (Date.now() < deadline) {
    const state = await page.evaluate(() => {
      const json = localStorage.getItem('provlepsi-state-v2:1');
      return json ? JSON.parse(json).project : null;
    });
    const count = Object.keys(state?.modelResults ?? {}).length;
    if (count !== modelCount) { modelCount = count; process.stdout.write(`Models completed: ${count}/9\n`); }
    const finished = await page.getByRole('button', { name: 'View Results & Forecast', exact: true }).isEnabled();
    if (finished) break;
    if (await page.getByRole('button', { name: 'Run Again', exact: true }).isVisible()) throw new Error(`Model run finished without all results: ${await page.locator('main').innerText()}`);
    await delay(1000);
  }
  const state = await page.evaluate(() => JSON.parse(localStorage.getItem('provlepsi-state-v2:1')).project);
  assert.equal(Object.keys(state.modelResults).length, 9, `Expected all nine models: ${await page.locator('main').innerText()}`);
  for (const result of Object.values(state.modelResults)) {
    assert.equal(result.forecast.length, 7);
    assert.equal(result.forecast[0].index, 620);
    assert.equal(result.forecast.at(-1).index, 626);
    assert.equal(result.history[0].index, 320);
    assert.equal(result.history.at(-1).index, 619);
    assert.equal(result.evaluation.trainEnd, 559);
    assert.equal(result.evaluation.horizon, 60);
    assert.equal(result.metrics.n, 60);
    assert.ok(Number.isFinite(result.metrics.rmse) && Number.isFinite(result.baseline.rmse));
    assert.ok(result.forecast.every(point => Number.isFinite(point.value)));
    assert.ok(result.trainPreprocessing.filledValues >= 1);
    assert.ok(result.trainPreprocessing.clippedValues >= 1);
    assert.match(result.sourceSha256, /^[a-f0-9]{64}$/);
  }
  checks.push('All nine real worker models: common holdout, preprocessing, finite forecasts, source hash, 620-row alignment, nondefault settings');
  await page.getByRole('button', { name: 'View Results & Forecast', exact: true }).click();
  await page.getByRole('heading', { name: 'Forecast Results' }).waitFor();
  await page.waitForFunction(() => Boolean(document.querySelector('#results-plot-container .js-plotly-plot')?._fullLayout));
  for (const [button, filename] of [['Download Forecast (CSV)', 'forecast.csv'], ['Download Run Details (JSON)', 'run.json'], ['Save Graph Image', 'results.png']]) {
    const pending = page.waitForEvent('download');
    await page.getByRole('button', { name: button, exact: true }).click();
    await (await pending).saveAs(join(outputDirectory, filename));
  }
  assert.match(await readFile(join(outputDirectory, 'forecast.csv'), 'utf8'), /forecast,620,,/);
  assert.equal(JSON.parse(await readFile(join(outputDirectory, 'run.json'), 'utf8')).pipelineVersion, 2);
  assert.equal((await readFile(join(outputDirectory, 'results.png'))).subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  checks.push('Actual CSV, complete run JSON, and results PNG downloads');
  stage = 'reload results';
  await page.reload();
  await page.getByRole('heading', { name: 'Forecast Results' }).waitFor();
  checks.push('Account-scoped project reload');
  stage = 'cancel training';
  await page.getByRole('button', { name: '3. MODEL', exact: true }).click();
  await page.getByRole('button', { name: 'Start Training', exact: true }).click();
  await page.getByRole('heading', { name: 'Training Models' }).waitFor();
  await page.getByRole('button', { name: 'Cancel Training', exact: true }).click();
  await page.getByRole('heading', { name: 'Model Selection' }).waitFor();
  await delay(1000);
  assert.equal(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('provlepsi-state-v2:1')).project.modelResults).length), 0);
  checks.push('Training cancellation prevents stale results');
  stage = 'switch accounts';
  accountId = 2;
  await page.reload();
  await page.getByRole('heading', { name: 'Upload your Dataset' }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('provlepsi-state-v2:2')).project.datasetId), null);
  checks.push('Account switch does not adopt another account project');
  stage = 'cross-tab logout';
  accountId = 1;
  await page.reload();
  await page.getByRole('heading', { name: 'Model Selection' }).waitFor();
  const secondPage = await context.newPage();
  observe(secondPage);
  await secondPage.route('**/api/auth/me', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: { id: 1, name: 'Synthetic account 1', email: 'account1@example.invalid' } }) }));
  await secondPage.goto(origin);
  await secondPage.getByRole('heading', { name: 'Model Selection' }).waitFor();
  await secondPage.getByRole('button', { name: 'Start Training', exact: true }).click();
  await secondPage.getByRole('heading', { name: 'Training Models' }).waitFor();
  await page.getByRole('button', { name: 'Sign Out', exact: true }).click();
  await page.waitForURL('**/login');
  await secondPage.waitForURL('**/login');
  assert.equal(await page.evaluate(() => localStorage.getItem('provlepsi-state-v2:1')), null);
  const remaining = await page.evaluate(async () => {
    const db = await new Promise((resolve, reject) => { const request = indexedDB.open('provlepsi-projects-v2'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error); });
    try {
      return await new Promise((resolve, reject) => { const request = db.transaction('datasets').objectStore('datasets').getAll(); request.onsuccess = () => resolve(request.result.filter(row => row.accountId === '1').length); request.onerror = () => reject(request.error); });
    } finally { db.close(); }
  });
  assert.equal(remaining, 0);
  checks.push('Real logout endpoint, cross-tab training cancellation, and awaited owned dataset deletion');
  }
  assert.deepEqual(errors, [], 'Unexpected browser errors');
  process.stdout.write(JSON.stringify({ status: 'passed', checks, models: modelCount, note: 'Synthetic /me identity; real Neon signup/login is not exercised.' }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(JSON.stringify({ status: 'failed', checks, browserErrors: errors, message: error.message }, null, 2) + '\n');
  process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
  await new Promise(resolve => { if (server.exitCode !== null) resolve(); else { server.once('exit', resolve); setTimeout(resolve, 5000).unref(); } });
  const resolvedOutput = await realpath(outputDirectory);
  assert.equal(dirname(resolvedOutput), temporaryRoot, 'Download cleanup must stay directly inside the resolved temporary directory.');
  assert.ok(basename(resolvedOutput).startsWith('provlepsi-browser-'), 'Download cleanup must target the generated smoke-test directory.');
  await rm(resolvedOutput, { recursive: true, force: true });
}
