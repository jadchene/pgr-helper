# Contributing

Use Windows with Node.js 24 or later. Install dependencies with `npm ci`, prepare Electron with `npm run setup`, and start the app with `npm run dev`.

## Changes

Open an issue for a bug or a substantial feature before starting a large change. Include expected behavior and reproduction steps. Keep pull requests focused and update both READMEs when user-visible behavior changes.

Use TypeScript, Vue, and the existing components. Keep source-data relationships in the adapters and validation layer rather than hard-coding character or equipment names in the UI. Do not include personal databases, backups, downloaded catalogs, credentials, or image caches in a contribution.

## Validation

```powershell
npm test
npm run build
```

Some source-adapter tests require an independent checkout of `myssal/PGR_Data`. Set `PGR_DATA_REPOSITORY` to that checkout to enable them. Without it, the test runner reports these tests as skipped. This repository is a test fixture only; the app itself always synchronizes remotely.

Guide and preset business tests can also use a previously synchronized normalized catalog cache:

```powershell
$env:PGR_TEST_CATALOG = (Resolve-Path 'data/source-cache/<commit>/catalog-v1.json').Path
npx vitest run tests/guides-store.test.ts tests/guide-validation.test.ts tests/presets.test.ts
```

This does not replace raw-source adapter coverage.

After building, `npm run test:desktop` exercises startup and synchronization behavior with controlled network fixtures. `npm run pack` followed by `npm run test:packaged` checks an isolated copy of the Windows app. Development-window checks (`test:dev`, `test:dev:window`) need port 5178 to be free.

Additional scripts under `scripts/` include interactive UI checks and sample-data tools. Close other app instances before desktop checks. Several checks intentionally use and may modify the default project `data/`; back it up before running them. `scripts/seed-demo.ts` creates illustrative presets and guides from already-synced data. Screenshots contain illustrative configurations, not gameplay advice.

Evidence defaults to ignored `test-results/` directories. Set `PGR_EVIDENCE_DIR` to choose another output directory. `scripts/capture-readme.ts` captures README screenshots from the default catalog and existing demo guides, and restores the original theme afterward.

## Scope

The supported desktop target is Windows. The project provides reference browsing and guide recording; account access, game automation, and live server schedules are outside its current scope.

The MIT license covers project code, not upstream game data or artwork. Keep source attribution when changing data adapters or screenshots.
