> Historical snapshot from October 13, 2026. See [the current repair report](../../AUDIT_REPORT.md) for the current implementation and verification.

# Pre-publication audit: Provlepsi-AI

**Audit date:** 2026-10-13 (Asia/Calcutta). **Validation environment:** Windows, Node.js 24.12.0, npm 11.7.0 and production Chrome. The audit covers the application directory containing `package.json`, currently named `time-series-autoML-main`.

## 1. Publication-readiness assessment

**Conditionally suitable for publication as an experimental source repository; not production-ready.** Source, configuration, setup documentation, the database schema and third-party notices are now present. The final clean dependency installation, TypeScript check, lint, seven focused authentication tests and production build passed. A repeated production browser smoke check exercised all nine model routes on a 60-row synthetic CSV; actual PNG/CSV export and sign-out checks also passed. Publication still requires an ownership/licensing decision and a decision on the remaining dependency advisories described below.

The implemented architecture remains intact: Next.js/React pages and authentication routes, Neon account storage, Zustand/localStorage state, IndexedDB datasets/models, Comlink workers, Pyodide scientific Python and TensorFlow.js. Existing algorithms and research implementations were preserved. No model performance results or development history were fabricated.

At intake, the proposed source set contained **41 files totaling 495,502 bytes**, excluding installed dependencies and generated outputs. The largest was `package-lock.json` at 362,085 bytes. No oversized source files, exact duplicate publication files or nested Git repositories were detected. There was no project Git history to preserve, and none was manufactured. Five unused starter SVGs and the existing favicon were retained and attributed.

No commit, push, GitHub repository creation or remote modification was performed. Temporary snapshots, audit outputs, synthetic fixtures and an ignore-check Git directory were kept outside the application. That temporary Git metadata was used to enumerate publication candidates without initializing or staging the project itself.

## 2. Issues to address before publication

### Source ownership and license

Confirm the right to publish and license the original source, including any copied contributions. No project `LICENSE` was added. Apache License 2.0 is the recommended source license **only after the owner confirms those rights**; third-party material retains its own licenses. The old README MIT badge was removed because it did not establish a license grant. See [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) and the [official Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.html).

### Remaining dependency advisories and the CI gate

The initial npm audit reported **18 affected dependency nodes: 3 critical, 12 high and 3 moderate**. Compatible updates and dependency cleanup reduced the October 13 result to **8 affected nodes: 0 critical, 5 high and 3 moderate**. These totals include propagated dependency findings; they are not eight independent vulnerabilities.

| Remaining chain | npm counts | Scope and unresolved issue |
| --- | --- | --- |
| `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces` | 5 high nodes | Development/lint tooling. Deeply nested brace patterns can exhaust the stack. The advisory lists no patched `braces` version at the audit date. [Braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm). |
| `@tensorflow/tfjs` → `argparse` → `sprintf-js` | 3 moderate nodes | Production dependency graph. Unbounded precision formatting can cause denial of service. Dependency presence alone does not establish reachability through this application's UI. [sprintf-js advisory](https://github.com/advisories/GHSA-hp3w-g68c-fv3c). |

`npm audit --audit-level=high` **fails with exit code 1**, and the retained GitHub workflow uses that full audit gate. `npm audit --omit=dev --audit-level=high` **passes with exit code 0**, but still reports the three moderate nodes. Omitting development dependencies does not clear the full repository audit or make the workflow pass.

npm's force-remediation proposals include incompatible downgrades to `eslint-config-next` 14.2.35 and TensorFlow.js 2.1.0. Those were not applied. Resolve the remaining chains when a compatible fix is available, or explicitly approve the documented unresolved risk and the resulting failing audit gate before publication. The gate was not silently disabled and no unsupported overrides were introduced.

## 3. Improvements that can wait for a subsequent development cycle

These concerns are disclosed in the README and interface, rather than addressed through an architectural rewrite:

- Wire the saved missing-value/outlier controls into a validated preprocessing pipeline. Current training ignores those choices and uses its own built-in filling.
- Use consistent chronological holdouts/backtests, fit scaling on training data, label metrics by their evaluation method and seed experiments where supported. ARIMA/boosting currently use training-fit metrics; deep scaling includes holdout observations.
- Repair and validate the experimental Transformer representation. Its single-feature normalization collapses input variation and yields input-independent predictions; it remains preserved research code.
- Correct the results/history/export timeline for datasets longer than the 100-row preview. Training uses a retained tail of up to 500 Python rows or 300 deep-model rows.
- Replace deep-model comma/line splitting with proper CSV extraction, validate short/nonfinite inputs and parameter ranges, and consider an explicit forecast-horizon contract.
- Add cancellation, worker/proxy/model disposal, model reload metadata, storage quota handling and browser/device compatibility coverage.
- Isolate browser state by account and provide a clear local-data deletion action before using the application on shared browsers or deploying it as a multiuser service.
- Harden authentication request validation, error handling and abuse protection; add rate limiting and account verification/recovery where required for deployment.
- Exercise real Neon signup/login/logout and database errors, add model-correctness and end-to-end coverage, and run Linux CI/CodeQL before making production assurances.

## 4. Files changed, added, retained and excluded

**Nineteen original files changed, seven files added, zero source files deleted.** No major algorithm or application architecture was replaced.

### Changed original files

| File | Reason |
| --- | --- |
| `.github/workflows/pr-checks.yml` | Add first-push/manual checks, Node 24, route type generation and authentication tests; retain the full security audit gate. |
| `.gitignore` | Exclude private environment/npm configuration, keys, editor/Python caches and generated outputs; allow only the blank environment template. |
| `ADDING_MODELS.md` | Replace outdated helpers/signatures and unsupported dependency-loading examples with actual UI/worker/result/parameter integration steps. |
| `README.md` | Accurate project identity, features, setup, architecture, privacy, evaluation methods, verification scope and research limits; remove unsupported MIT claim. |
| `package-lock.json` | Lock compatible security updates and dependency cleanup; retain reproducible npm resolution. |
| `package.json` | Node minimum, typecheck/test commands, Next.js/config version floors and removal of unused/deprecated or duplicate dependencies. |
| `src/app/api/auth/login/route.ts` | Obtain an explicitly configured database client at request time. |
| `src/app/api/auth/me/route.ts` | Obtain the configured database client after session verification. |
| `src/app/api/auth/signup/route.ts` | Validate session configuration before account insertion and obtain the database client lazily. |
| `src/app/layout.tsx` | Replace Create Next App metadata with accurate project metadata. |
| `src/components/StepEDA.tsx` | Disclose inactive preprocessing controls and use the shared, typed Plotly browser bundle for PNG export. |
| `src/components/StepModelConfig.tsx` | Explain split-slider applicability and the known experimental Transformer defect. |
| `src/components/StepResults.tsx` | Disclose differing metrics and partial history; use the shared Plotly browser bundle for PNG export. |
| `src/components/StepTrain.tsx` | Fix two `prefer-const` lint errors while preserving numeric extraction and model routing. |
| `src/components/StepUpload.tsx` | Accurate dataset/account privacy wording and click-to-upload behavior. |
| `src/lib/auth.ts` | Remove the known fallback signing key; reject absent/weak/padded secrets, constrain HS256 and validate identity/time claims. |
| `src/lib/db.ts` | Remove the dummy database URL; require explicit configuration only when a database operation is requested. |
| `src/store/useStore.ts` | Allow null for undefined/nonfinite preview statistics and correlations. |
| `src/workers/pyodide.worker.ts` | Use pandas JSON serialization for preview statistics so constant/single-row data produces valid JSON. |

### Added files

| File | Reason |
| --- | --- |
| `.env.example` | Blank server configuration template and random-secret generation instructions; no actual credentials. |
| `.nvmrc` | Select Node.js 24 for development and CI. |
| `AUDIT_REPORT.md` | Record this publication audit, actual validation, unresolved issues and proposed commit contents. |
| `THIRD_PARTY_NOTICES.md` | Verified starter-asset attribution and dependency/runtime/font licensing inventory. |
| `db/schema.sql` | Supply the users schema required by the existing authentication routes. |
| `src/types/plotly-dist.d.ts` | Type the Plotly browser-bundle entry used by React charts and image export. |
| `tests/auth.test.mjs` | Seven focused authentication/configuration regression tests without database/network calls. |

### Dependency changes and retained material

- Next.js **16.2.11 → 16.4.0**, with matching `eslint-config-next` 16.4.0 and compatible lockfile security updates. The initial audit included critical Next.js findings, including [Windows server remote-code execution](https://github.com/advisories/GHSA-p293-qw3h-jr36); the final npm audit reports no critical nodes.
- Removed unused npm `pyodide`; the actual browser runtime remains the versioned CDN Pyodide 0.25.0. Removed deprecated stub `@types/bcryptjs`; Bcryptjs already supplies types.
- Removed duplicate `plotly.js-dist-min` 3.7.0, whose bundled MapLibre GL 4.7.1 was affected by the [MapLibre sanitizer advisory](https://github.com/advisories/GHSA-jrc7-96c5-q579). The application now declares `plotly.js` 4.1.2, already used by React Plotly, and imports the same `plotly.js/dist/plotly` browser bundle for image export.
- The first attempt to import the Plotly package root failed production compilation with three module-resolution errors. That integration was corrected to the browser distribution and a typed ambient module; the final production build passed. No `@ts-expect-error` suppression is needed for these export imports.
- All five unused starter SVGs, the favicon, unused research/helper methods and existing model implementations were retained. Six assets were verified against the official Next.js starter: five SVGs match after whitespace trimming and the favicon matches byte for byte. Their upstream notices are preserved in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).
- `.github/dependabot.yml` and CodeQL were reviewed and retained. `AGENTS.md` contains generic Next.js agent guidance, with no detected internal-only content; it was retained.

## 5. Verification results

Results distinguish executed checks from pending or unexecuted work. Package installation and checks used the committed lockfile without real database credentials.

| Check | Result | Evidence / scope |
| --- | --- | --- |
| Final clean `npm ci` | **PASSED** | 623 packages installed from the final lockfile. Audit findings remain as listed above. |
| `npm run typecheck` | **PASSED** | Next.js route types generated, then `tsc --noEmit`; passed after the corrected Plotly bundle import. |
| `npm run lint` | **PASSED with 1 warning** | No errors. Existing `@next/next/no-location-assign-relative-destination` warning at `Wizard.tsx:48` retained; changing navigation was outside necessary cleanup. |
| `npm test` | **PASSED: 7 tests** | Final clean-install run covered JWT secret validation, session lifetime/claims/algorithm/signature/expiry and missing database configuration. No account-route or live database integration is covered. |
| `npm run build` | **PASSED** | Next.js 16.4.0 Turbopack production build; all application routes generated. |
| Production Chrome model smoke | **PASSED, repeated on final build** | 60 synthetic rows; all nine models returned finite RMSE/MAE and exactly ten finite forecasts. No model failed, timed out or remained unexecuted; no browser errors were observed. This is integration evidence, not accuracy or performance evidence. |
| Final-build PNG/CSV/sign-out smoke | **PASSED** | Actual EDA and results Save Graph Image buttons produced files with valid PNG signatures after chart initialization. CSV download and sign-out passed; no console/page errors. |
| Preview JSON fixtures in host CPython | **PASSED: 6 fixtures** | Checked pandas serialization edge cases; host CPython is not the same runtime as browser Pyodide. |
| `npm audit --audit-level=high` | **FAILED: exit 1** | 8 affected nodes: 5 high, 3 moderate, 0 critical; this full audit gate also remains in CI. |
| `npm audit --omit=dev --audit-level=high` | **PASSED threshold: exit 0** | Still reports 3 moderate production-graph nodes; not a vulnerability-free result. |
| Real Neon signup/login/logout/schema integration | **UNEXECUTED** | No real database credentials were supplied. Browser smoke used a temporary local test session, not a complete account-registration flow. |
| Linux GitHub Actions and CodeQL execution | **UNEXECUTED** | Workflow files reviewed locally; no repository publication or remote run was performed. |
| Other browsers, backend/GPU coverage, large-data tests and performance benchmarks | **UNEXECUTED** | No compatibility, speed or benchmark claims inferred from the synthetic smoke. |
| Staged diff / initial commit | **UNEXECUTED** | No project repository was initialized or staged; the proposed manifest is supplied below. |

An earlier results-PNG automation attempt timed out because it clicked before the result chart initialized. Waiting for actual chart readiness made the final check pass; no source change was needed for that timing correction. The earlier Plotly package-root build failure is recorded in section 4 and was resolved before the successful final build.

## 6. Sensitive-file and generated-output exclusion verification

No actual credentials, private environment file, personal dataset or personal identifier was detected in the proposed source contents. The only environment file proposed for publication is the blank `.env.example`. The known JWT fallback key and dummy database URL were removed. Test identities are placeholders, and temporary audit sessions/fixtures do not enter the manifest.

Ignore behavior was verified for 18 representative private/generated paths, including `.npmrc`, using temporary Git metadata outside the project and the project as its work tree; the blank `.env.example` is allowed. Publication candidates were enumerated with `git ls-files --others --exclude-standard`; the proposed set below includes this report. No `.git`, `node_modules`, `.next`, private environment configuration or local audit output is included.

| Excluded category | Relevant patterns / examples |
| --- | --- |
| Private configuration | `.env*`, with only `!.env.example` allowed; `.npmrc`. No project `.npmrc` exists. |
| Installed dependencies | `/node_modules`, PnP/Yarn local outputs. |
| Next.js/build outputs | `/.next/`, `/out/`, `/build`, `/dist/`, `next-env.d.ts`, `*.tsbuildinfo`. |
| Test/cache outputs | `/coverage`, `/.cache/`, Python bytecode/caches, notebook checkpoints. |
| Local environments/editors | `venv/`, `.venv/`, `env/`, `.vscode/`, `.idea/`, `.history/`, Vercel local state. |
| Logs, temporary outputs and keys | `*.log`, debug logs, `/tmp/`, `/temp/`, `*.pem`, `*.key`, `*.p12`, `*.pfx`. |

`node_modules`, `.next`, generated `next-env.d.ts` and `tsconfig.tsbuildinfo` are the actual ignored entries present after validation. They were not deleted merely to make the directory appear clean. After writing this report, the publication list was re-enumerated and compared with original-file SHA-256 hashes: 48 candidates, 19 originals changed, seven additions and zero deletions. The embedded manifest matches that list, and the documentation's relative file links resolve. Once the user initializes the project repository, the staged paths and contents still require the final review in section 8.

### Complete proposed initial-commit manifest: 48 files

```text
.env.example
.github/dependabot.yml
.github/workflows/codeql.yml
.github/workflows/pr-checks.yml
.gitignore
.nvmrc
ADDING_MODELS.md
AGENTS.md
AUDIT_REPORT.md
README.md
THIRD_PARTY_NOTICES.md
db/schema.sql
eslint.config.mjs
next.config.ts
package-lock.json
package.json
postcss.config.mjs
public/file.svg
public/globe.svg
public/next.svg
public/vercel.svg
public/window.svg
src/app/api/auth/login/route.ts
src/app/api/auth/logout/route.ts
src/app/api/auth/me/route.ts
src/app/api/auth/signup/route.ts
src/app/favicon.ico
src/app/globals.css
src/app/layout.tsx
src/app/login/page.tsx
src/app/page.tsx
src/components/StepEDA.tsx
src/components/StepModelConfig.tsx
src/components/StepResults.tsx
src/components/StepTrain.tsx
src/components/StepUpload.tsx
src/components/Wizard.tsx
src/lib/auth.ts
src/lib/db.ts
src/lib/storage.ts
src/lib/workerHelper.ts
src/proxy.ts
src/store/useStore.ts
src/types/plotly-dist.d.ts
src/workers/pyodide.worker.ts
src/workers/tfjs.worker.ts
tests/auth.test.mjs
tsconfig.json
```

## 7. Unresolved licensing, attribution and reproducibility concerns

The original-source copyright/license decision remains open. The verified starter notice resolves attribution for those six assets, but does not establish ownership of every original contribution. Dependencies and served browser assets remain separately licensed; [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md) inventories the actual versions and primary upstream references without asserting blanket compatibility.

Publishing this source set is distinct from distributing a compiled application or rehosting third-party runtime files. Deployment/binary distribution needs the notices and source-availability obligations applicable to the exact Plotly bundle, Pyodide/scientific packages, fonts and optional native dependencies. No source license should claim those components as original project work.

The npm lockfile and documented Node version support repeatable installation, but setup still requires network access, a Neon database initialized with `db/schema.sql`, a private random JWT secret and browser capabilities. Pyodide 0.25.0 packages are fetched from jsDelivr; Next.js downloads Google fonts during compilation. The application is not offline/self-contained. Deep training is not seeded, so identical source and data do not guarantee identical forecasts. Real database reproducibility, other browsers and Linux CI remain unverified.

## 8. Reviewing and creating one initial commit after approval

Use the **directory containing `package.json` as the Git repository root**. In the supplied archive this is `time-series-autoML-main`, inside `Provlepsi AI`. Publishing that directory as the repository named Provlepsi-AI makes the root README and `.github/workflows` discoverable without flattening or moving existing work.

The commands below are for the user after resolving/approving the outstanding issues. They have **not** been executed against a project repository. Replace the example location with the actual application directory:

```powershell
Set-Location 'path\to\Provlepsi-AI'
npm ci
npm run typecheck
npm run lint
npm test
npm run build
npm audit --audit-level=high
npm audit --omit=dev --audit-level=high
```

The full audit currently fails for the documented high development findings. Inspect every command's result and address or explicitly approve those findings before proceeding; the production-only threshold does not clear the full gate.

Initialize and stage only when the user approves the proposed initial import:

```powershell
git init -b main
git add -- .
git status --short
git diff --cached --stat
git diff --cached --name-status
git diff --cached --check
git diff --cached
```

Compare the staged paths with the 48-file manifest and inspect contents, especially the blank environment template, lockfile registry URLs and third-party notices. This additional staged-path check should produce no matches:

```powershell
$stagedPrivateOrGenerated = git ls-files | Where-Object {
    $_ -match '(^|/)(node_modules|\.next|out|build|dist|coverage|\.venv|venv|env|__pycache__|\.vscode|\.idea)(/|$)' -or
    ($_ -match '(^|/)\.env' -and $_ -ne '.env.example') -or
    $_ -match '(^|/)(\.npmrc|next-env\.d\.ts)$' -or
    $_ -match '\.(tsbuildinfo|log|pem|key|p12|pfx|pyc|pyo)$'
}
if ($stagedPrivateOrGenerated) {
    $stagedPrivateOrGenerated
    throw 'Private or generated paths are staged. Review the index before committing.'
}
```

After the user approves the staged result and outstanding publication decisions, create **one** initial commit:

```powershell
git commit -m "Initial import of Provlepsi-AI"
git status --short
git log -1 --oneline
```

No artificial history or extra import commits are needed. Remote configuration, GitHub repository creation and pushing are outside this audit and are not included in these commands.

