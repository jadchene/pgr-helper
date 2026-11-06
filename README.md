# PGR Helper · 战双助手

English | [简体中文](README.zh-CN.md)

A desktop assistant for Punishing: Gray Raven. Current features include reference data browsing and editing, team configurations, and stage action flows, with data stored locally.

## Using the app

Open `战双助手.exe` in the Windows application directory. Keep the entire directory in a writable location: the database, settings, caches, and pre-restore backups are stored in the adjacent `data` directory. Move the whole directory when relocating the app.

The catalog is empty on first launch. The app opens the initial synchronization page, where you can fetch the catalog, review the preview, and activate the version. The first synchronization requires an internet connection. Once activated, the catalog is stored locally for offline browsing.

Select a category and search names or aliases. Each category has its own filters: character elements, classes, and enhancement skills; memory purposes and set sizes; weapon types and recommended characters; or stage modes, difficulty, and configuration status. Filters only change the list after you apply them. Click a card or list entry to open its detail page with skills, set effects, and related entries. The back-to-list button restores the original search, filters, sort order, page, and scroll position. Following related entries also returns to that original list.

Characters and companions default to descending source order. Weapons use explicitly recommended characters as an ordering reference; memories, resonances, stages, and weather use category-specific groups. Upstream provides no individual release dates, so these orders are approximate references. Open the information icon beside the sort selector for each category's basis, or switch to name order.

Character skills follow upstream categories, with Uniframe and Leap skills kept separate. Choose a category and skill to read its full description; multiple source versions remain selectable even when they share a name. Companions have active and passive groups. Elemental variants of an active skill share one entry with buttons for each variant's exact name, level, values, and effects. Grouping comes from source relationships and updates with synchronization. After upgrading the app, check for updates and activate the catalog to obtain the latest skill structure. Locally edited descriptions retain priority.

Add entries or edit existing ones from their details. Edits to upstream entries are stored separately and survive synchronization; “Restore source content” removes all local field edits for an entry. Deleted entries go to a recoverable recycle bin. Entries without artwork use a category icon, and local images can be attached in the editor.

## Stage guides

Open Stage Guides in the sidebar or create a linked guide from a stage detail page. A guide can apply to multiple stages and include a name, recorded time, expected battle duration, notes, and reference video URLs. Video links open in the system browser. Save unfinished work as a draft; marking it complete requires valid stages, a team, and an action flow. Guides can be edited, duplicated, moved to their recycle bin, and restored.

Configure blue, red, and yellow positions, with separate starting-member and captain choices. Character evolution stages are independent of initial catalog rank: SSS and SSS3 remain distinct, with their additional effects available for inspection. Companions have an actual rank, one active skill, and the passive slots allowed at that rank. Memory presets cover 4+2, 2+2+2, and six pieces. Upper and lower resonance rows are separate, with mixed counts or a shortcut for six identical resonances. Weapons have three resonance slots and source-defined harmonization stages with a bound memory set. Extra set counts come from source data. Team effects are selected from the configured members. The detail page presents a compact team overview, including both memory resonance rows.

Action flows have single-run and repeating modes. Add character switches, red/yellow/blue/special orbs, ultimate skills, dodges, normal attacks, and QTE nodes. Skills, dodges, and attacks default to a tap and can use a hold. Nodes support durations, notes, insertion, duplication, reordering, and removal. Parallel branches start alongside their parent action, run their own sequences, and join before the next main action; this can represent QTE calls during a held attack. A QTE node preserves an ordered sequence of multiple or repeated characters, but only permits off-field members. Validation includes later loop iterations and possible concurrent switches.

Use the overview tab to review the team and connected flow. Save with `Ctrl+Enter`; leaving or closing protects unsaved changes. Guides are stored independently, so catalog synchronization and rollback do not overwrite them. When upstream changes invalidate a selection, the original configuration stays available for correction. After upgrading, check for updates and activate the catalog to obtain current evolution and equipment options.

## Catalog synchronization

After the first synchronization, use the synchronization center to check for updates. Review added, changed, and removed entries before activating the candidate. Failed or canceled checks leave the current catalog intact and can be retried later.

Catalog data comes directly from the remote Chinese-server directory in [myssal/PGR_Data](https://github.com/myssal/PGR_Data). Access to the GitHub API and raw.githubusercontent.com is required. Only the necessary catalog files are downloaded; previously validated content at the same version can be reused from cache.

Catalog artwork comes from [undertheobservers/PGR_Assets](https://github.com/undertheobservers/PGR_Assets). Each update check independently checks the image version, which is activated after you confirm the preview. The application downloads images as they are viewed, stores them in `data/image-cache`, and never clones the entire image repository. Cached images remain available offline. The image source can lag behind catalog data; missing or failed images use category icons, and locally assigned images take priority. If an image version check fails, the last confirmed version is reused; without one, text synchronization remains available.

The last five catalog versions are retained for rollback. Local entries, edits, and recycle-bin state survive version changes.

Upstream data includes historical and candidate configurations. Stage entries do not establish the current weekly rotation or server availability. Some entries have no artwork field, so image coverage does not establish catalog completeness.

## Settings and backups

Settings provide light, dark, and system themes, plus a searchable list of installed fonts with an immediate preview and application across the interface. Font choices are saved automatically; choose the system default to reset, or refresh to retry a failed font listing. Settings also provide the data directory and backup export and restore. After the first synchronization, you can enable startup checks. They are disabled by default and only prepare a preview; they never activate a candidate automatically.

Backups include catalog versions, local entries, field edits, complete guides with teams and flows, recycle-bin state, embedded images, and settings. Restoring replaces the current contents after automatically exporting the previous state to `data/backups`. Backup files may include local paths and personal notes; store them according to your needs.

Remote image versions and URLs are included in backups, but downloaded images are excluded from JSON backups. Images can be downloaded again after restoring on another computer. Move the application's entire `data` directory to preserve the complete offline state.

Shortcuts: `Ctrl+K` to search, `Ctrl+N` to add an entry, `Ctrl+Enter` to save edits, and `Ctrl+W` to close the window. Unsaved edits trigger a confirmation.

## Development and local builds

Node.js 24 or later is required.

```powershell
npm ci
npm run setup
npm run dev
```

```powershell
npm test
npm run test:dev
npm run test:dev:window
npm run build
npm start
npm run pack
```

`pack` creates the runnable `release/win-unpacked` directory. Development data lives in the project's `data` directory. Restart the development process after main-process changes.

`test:dev` runs desktop UI checks with isolated data. Stop the development server first, as the checks use port 5178.

`test:dev:window` verifies native window visibility on Windows. It briefly opens and closes a test window and also requires port 5178 to be available.

For tests against complete source tables, set `PGR_DATA_REPOSITORY` to a separate `myssal/PGR_Data` Git audit checkout. Without it, `npm test` skips cases requiring the full dataset. After `npm run build`, `npm run test:guides` fills the team and flow through the desktop UI and checks persistence after restarting, using isolated test data. The audit checkout is only a development fixture; the app does not need a local repository to run or sync.

## Sources and license

The layout and theme are inspired by [CC Switch](https://github.com/farion1231/cc-switch); catalog cards and sectioned details support reference reading. Application code is [MIT licensed](LICENSE). Game data, names, and artwork belong to their respective rights holders; the application license does not alter their ownership.

The app provides reference maintenance and stage guide recording, with all configurations and action flows stored locally.
