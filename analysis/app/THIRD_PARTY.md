# Third-party components and licenses

The MIT license in `LICENSE` applies only to original ExperiAnalysis code. It does not replace licenses for vendored WebR, R, DuckDB, fonts, data, or packages fetched by the browser runtime. Preserve upstream notices in their original form.

`runtime-manifest.json` is the authoritative inventory for the runtime build. Each component record should state its exact version, upstream source or download URL, and declared license; each shipped file must have a project-relative path and SHA-256. Include a version-specific source archive or release URL so recipients can locate the exact source used. Do not use a floating `latest` URL as the only source record.

## Principal runtime components

| Component | Upstream license | Source reference |
|---|---|---|
| WebR JavaScript runtime code | MIT unless an individual source file says otherwise | [WebR source repository](https://github.com/r-wasm/webr) · [release downloads](https://github.com/r-wasm/webr/releases) |
| WebR binary distribution and included GPL components | GNU GPL v3 for the distributed WebR binaries, as stated in the vendored WebR notice | Preserve [`vendor/webr/LICENSE`](vendor/webr/LICENSE) · [WebR source repository](https://github.com/r-wasm/webr) |
| R runtime and R's bundled packages | R is GNU GPL version 2 and version 3; bundled packages may have their own licenses | [R source and licenses](https://www.r-project.org/Licenses/) · [WebR release downloads](https://github.com/r-wasm/webr/releases) |
| DuckDB WebAssembly client | MIT | [DuckDB WASM source repository](https://github.com/duckdb/duckdb-wasm) |
| `limma` 3.68.5 | GPL-2 or later | [Versioned source archive](https://bioc-release.r-universe.dev/src/contrib/limma_3.68.5.tar.gz) · [Bioconductor package page](https://bioconductor.org/packages/limma/) |
| `edgeR` 4.10.7 | GPL-2 or later | [Versioned source archive](https://bioc-release.r-universe.dev/src/contrib/edgeR_4.10.7.tar.gz) · [Bioconductor package page](https://bioconductor.org/packages/edgeR/) |
| `statmod` 1.5.2 | GPL-2 or GPL-3 | [Versioned source archive](https://cran.r-project.org/src/contrib/statmod_1.5.2.tar.gz) · [CRAN package page](https://CRAN.R-project.org/package=statmod) |
| `locfit` 1.5-9.12 | GPL-2 or later | [Versioned source archive](https://cran.r-project.org/src/contrib/locfit_1.5-9.12.tar.gz) · [CRAN package page](https://CRAN.R-project.org/package=locfit) |
| `jsonlite` 2.0.0 | MIT + file LICENSE | [Versioned source archive](https://cran.r-project.org/src/contrib/jsonlite_2.0.0.tar.gz) · [CRAN package page](https://CRAN.R-project.org/package=jsonlite) |

The exact package versions, version-specific download URLs, license strings, and hashes must match the runtime manifest and the included upstream notices. This table is an index to the principal components, not a substitute for component-specific license files.

The vendored WebR distribution notice also lists licenses for software incorporated into its build, including PCRE2 (BSD), XZ/liblzma (public domain), libgfortran (GPL-2/GPL-3), Dragonegg (GPL-2), LLVM Flang (Apache-2.0), jsTree and xterm.js (MIT), and Noto fonts (SIL Open Font License). Keep the complete upstream notice with the runtime and check it for each refreshed WebR release.

## Related software references

The runtime is pinned to WebR 0.6.0 / R 4.6.0 and DuckDB-Wasm 1.32.0. `lattice` 0.23-1 (GPL >=2; https://cran.r-project.org/src/contrib/lattice_0.23-1.tar.gz) is also included as a declared locfit dependency.

`locfit` 1.5-9.12 was built from its unchanged official numerical sources in the pinned WebR build image `ghcr.io/r-wasm/webr@sha256:3fbf3dc3537c5b31bca94dd797dc25364693b18d71b1d0975f318fbfd6269d86`. The project build script explicitly selects the Emscripten C compiler to address upstream r-wasm/rwasm issue 62. This changes toolchain selection only. Build provenance, source archive and binary hash are retained; its native and browser computations are checked before acceptance.

AMICA, AlphaPeptStats, and DIA-NN are independent tools listed as background references in the README. They are not bundled dependencies unless separately named in the runtime manifest.

## DuckDB browser ESM bundle

`scripts/bundle_duckdb.mjs` bundles the official browser entry from `@duckdb/duckdb-wasm` 1.32.0 for local Parquet support. The exact npm dependency graph is pinned in [`scripts/duckdb-bundle/package-lock.json`](scripts/duckdb-bundle/package-lock.json); the generated [`vendor/duckdb/NOTICE-apache-arrow.txt`](vendor/duckdb/NOTICE-apache-arrow.txt) contains the license texts and source references for code detected in the bundle. The existing `vendor/duckdb/LICENSE` remains with DuckDB's own distribution.

| Bundled component | Version | Declared license | Version-specific source |
|---|---:|---|---|
| `@duckdb/duckdb-wasm` | 1.32.0 | MIT | [npm package](https://www.npmjs.com/package/@duckdb/duckdb-wasm/v/1.32.0) · [source](https://github.com/duckdb/duckdb-wasm/tree/v1.32.0) |
| `apache-arrow` | 17.0.0 | Apache-2.0 | [npm package](https://www.npmjs.com/package/apache-arrow/v/17.0.0) · [source](https://github.com/apache/arrow/tree/apache-arrow-17.0.0/js) |
| `flatbuffers` | 24.12.23 | Apache-2.0 | [npm package](https://www.npmjs.com/package/flatbuffers/v/24.12.23) · [source](https://github.com/google/flatbuffers/tree/v24.12.23) |
| `tslib` | 2.8.1 | 0BSD | [npm package](https://www.npmjs.com/package/tslib/v/2.8.1) · [source](https://github.com/microsoft/tslib/tree/2.8.1) |

The build-only `esbuild` 0.28.2 package is MIT licensed ([versioned npm package](https://www.npmjs.com/package/esbuild/v/0.28.2)); it is installed under the ignored `dev/bundle` prefix and is not shipped in the browser runtime.
# Optional native helper dependencies (0.2)

The local helper installs DuckDB Python 1.4.3 (MIT) from PyPI into `.venv`; it is not added to the browser runtime manifest. Native analysis uses the shared `statistics.R` with the installed R, limma, edgeR and jsonlite versions recorded in each result. Optional MinProb uses imputeLCMD 2.1 (GPL-2), with its declared CRAN/Bioconductor dependencies; KNN uses the installed `impute` package. Ranked enrichment uses the installed `fgsea` package. These packages retain their upstream licenses and are not copied into the public site or result ZIP. `.venv` and `.runtime` are excluded from Git. Install using official CRAN/Bioconductor repositories and record package versions rather than substituting methods when a package is unavailable.

Upstream sources: https://pypi.org/project/duckdb/1.4.3/ ; https://cran.r-project.org/package=imputeLCMD ; https://bioconductor.org/packages/impute/ ; https://bioconductor.org/packages/fgsea/ .
