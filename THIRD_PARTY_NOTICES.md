# Third-party notices

This document records verified third-party material and licensing considerations for Provlepsi-AI. It does not assign ownership of third-party work or replace the licenses shipped by its authors.

## Project source license

A license for the project's original source code is pending confirmation by the copyright owner. Apache License 2.0 is recommended if the owner has the necessary rights to license all original contributions. See the [official Apache License 2.0](https://www.apache.org/licenses/LICENSE-2.0.html).

That recommendation does not relicense dependencies, fonts, logos, or copied starter material. This inventory is not a blanket compatibility guarantee or a complete notice bundle for compiled distributions.

## Next.js starter material included in this repository

The following files were verified against the official Next.js `v16.2.11` Create Next App template:

- `public/file.svg`
- `public/globe.svg`
- `public/next.svg`
- `public/vercel.svg`
- `public/window.svg`
- `src/app/favicon.ico`

The SVG contents match the template after trimming surrounding whitespace; the favicon matches byte for byte. The SVG files are currently unreferenced by application code, while Next.js serves the favicon through its metadata convention. They are retained to avoid discarding existing assets during the publication audit.

Source: [Create Next App template](https://github.com/vercel/next.js/tree/v16.2.11/packages/create-next-app/templates/app/js). The following license text is reproduced from the [upstream license at v16.2.11](https://github.com/vercel/next.js/blob/v16.2.11/license.md). Retain this notice with the starter material. The presence of Next.js and Vercel logos does not imply endorsement or transfer trademark rights.

```text
The MIT License (MIT)

Copyright (c) 2025 Vercel, Inc.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## npm dependencies

The dependency implementations are installed with npm and are not vendored into this source repository. `package.json` declares direct dependencies and `package-lock.json` records the resolved versions. The following summary reflects the final lockfile and package license files inspected during the publication audit; the exact installed package license files remain authoritative. The application uses Next.js `16.4.0`. The original starter assets above retain their verified `v16.2.11` provenance.

| Direct dependency | License summary | Upstream |
| --- | --- | --- |
| `@neondatabase/serverless` | MIT | [Neon serverless driver](https://github.com/neondatabase/serverless) |
| `@tensorflow/tfjs`, `@tensorflow/tfjs-backend-webgl`, `@tensorflow/tfjs-backend-webgpu` | Apache-2.0; the transitive layers package also includes MIT material | [TensorFlow.js license](https://github.com/tensorflow/tfjs/blob/master/LICENSE) |
| `bcryptjs` | BSD-3-Clause | [bcrypt.js](https://github.com/dcodeIO/bcrypt.js) |
| `comlink` | Apache-2.0 | [Comlink license](https://github.com/GoogleChromeLabs/comlink/blob/main/LICENSE) |
| `idb` | ISC | [idb](https://github.com/jakearchibald/idb) |
| `jose` | MIT | [jose](https://github.com/panva/jose) |
| `lucide-react` | ISC, with MIT notices for icons derived from Feather | [Lucide license and Feather attribution](https://github.com/lucide-icons/lucide/blob/main/LICENSE) |
| `next` | MIT | [Next.js 16.4.0 license](https://github.com/vercel/next.js/blob/v16.4.0/license.md) |
| `plotly.js`, `react-plotly.js` | MIT, with notices for bundled third-party components | [Plotly.js 4.1.2](https://github.com/plotly/plotly.js/tree/v4.1.2), [React Plotly.js](https://github.com/plotly/react-plotly.js) |
| `react`, `react-dom` | MIT | [React license](https://github.com/facebook/react/blob/main/LICENSE) |
| `zustand` | MIT | [Zustand](https://github.com/pmndrs/zustand) |

Development dependencies also have their own licenses, including Apache-2.0 for TypeScript and MIT for ESLint and Tailwind CSS. Dependency license metadata alone does not capture every bundled component or distribution requirement. In particular:

- Next.js resolves optional Sharp `0.35.5` packages. Sharp itself is Apache-2.0, while its libvips binaries carry LGPL-3.0-or-later notices. The optional `@img/sharp-wasm32` package declares Apache-2.0, LGPL-3.0-or-later and MIT material; its `@emnapi/runtime` dependency is MIT. See [Sharp's licensing guidance](https://sharp.pixelplumbing.com/install/#licensing). Optional binaries installed locally depend on the operating system and architecture; they remain third-party packages rather than project source.
- Lightning CSS and axe-core carry MPL-2.0 licenses.
- The application uses `plotly.js` `4.1.2` for both React charts and PNG export. Its dependencies include MapLibre GL `6.11.2` under BSD-3-Clause. The [MapLibre upstream license](https://github.com/maplibre/maplibre-gl-js/blob/v6.11.2/LICENSE.txt) also preserves notices for earlier Mapbox GL and other included material. Plotly-related dependencies include attribution-licensed data. Preserve license comments and applicable notices for the actual browser bundle as well as any redistributed packages.

## Browser Python runtime and packages

The Python worker downloads Pyodide `0.25.0` from jsDelivr. It does not import the npm `pyodide` package; removing that unused npm dependency does not remove the browser runtime or its licensing obligations.

Pyodide is licensed under MPL-2.0. Its exact runtime source and license are available in the [Pyodide 0.25.0 source release](https://github.com/pyodide/pyodide/tree/0.25.0) and [license](https://github.com/pyodide/pyodide/blob/0.25.0/LICENSE). The worker loads pandas and, depending on the selected model, scikit-learn or statsmodels; these packages and their NumPy, SciPy, CPython and other runtime dependencies retain their separate licenses. The principal pandas, scikit-learn and statsmodels projects use BSD-style licenses; consult the license files in the exact Pyodide package release before redistributing them. Upstream references: [pandas](https://github.com/pandas-dev/pandas/blob/main/LICENSE), [scikit-learn](https://github.com/scikit-learn/scikit-learn/blob/main/COPYING), [statsmodels](https://github.com/statsmodels/statsmodels/blob/main/LICENSE.txt).

MPL-covered code can be combined with Apache-licensed code while retaining its own license obligations. Distributing MPL executable or minified JavaScript requires informing recipients how to obtain its corresponding MPL source. See [Mozilla's MPL FAQ](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), especially the guidance on Apache combination, minified JavaScript and client-side distribution. Changing the CDN URL or hosting these runtime files locally requires reviewing the notices and source availability for the exact files served.

## Fonts

`src/app/layout.tsx` uses `next/font/google` to obtain Geist and Geist Mono. Their font files are not checked into this source repository, but generated builds include downloaded font assets. The fonts are licensed under SIL Open Font License 1.1. See the [Geist project](https://github.com/vercel/geist-font) and [official OFL notice](https://github.com/vercel/geist-font/blob/main/OFL.txt). Preserve the applicable copyright and OFL notice when distributing font files; inspect the notice accompanying the exact downloaded version.

## Before distributing a deployment or packaged build

Review the actual npm bundle, browser Python packages, native binaries and fonts being distributed. Preserve their required copyright/license notices and meet source availability requirements where applicable. This source inventory and its links do not substitute for that review, and a license chosen for Provlepsi-AI's original source must not claim ownership of those components.
