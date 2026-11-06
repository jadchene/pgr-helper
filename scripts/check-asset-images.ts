import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CatalogStore } from '../src/main/store';
import { defaultSourceProfile } from '../src/main/schemas';
import { loadCatalogSnapshot } from '../src/main/sources';
import { attachAssetImages } from '../src/main/sources/assets';
import { categories, categoryLabels, type Category, type CatalogEntry } from '../src/shared/types';
import { readMyssalHttpFixture } from '../tests/helpers/myssal-http-fixture';

const project = resolve(import.meta.dirname, '..');
const data = join(project, `test-results/asset-images-${Date.now()}`);
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(data, 'evidence'));
const execute = promisify(execFile);
const checks: Record<string, unknown>[] = [];
const errors: string[] = [];
const report: Record<string, unknown> = { runAt: new Date().toISOString(), passed: false, data, checks, errors, sourceMode: '真实固定 Myssal 表的 HTTP fixture；图片提交和 PNG 使用真实远程网络' };
let app: ElectronApplication | undefined;
let page: Page;
let entries = new Map<string, CatalogEntry>();
let indexedFiles = new Set<string>();

/** 保存用户可观察的检查结果。 */
const passed = (name: string, detail: Record<string, unknown> = {}) => { checks.push({ check: name, ...detail }); console.log(name); };
/** 只等待本测试拥有的子进程。 */
const waitExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (result: boolean) => { clearTimeout(timer); child.removeListener('exit', onExit); done(result); };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};
/** 有界退出，仅在必要时清理本测试 Electron 进程树。 */
const close = async () => {
  if (!app) return;
  const child = app.process();
  void app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (!(await waitExit(child, 2500))) {
    if (process.platform === 'win32') await execute(join(process.env.SystemRoot || 'C:/Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 });
    else child.kill('SIGKILL');
    assert(await waitExit(child, 2500));
  }
  report.process = { pid: child.pid, exited: true };
};
/** 截取实际 Electron 绘制结果。 */
const capture = async (name: string) => {
  const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
};
/** 切换到分类并等待至少一张真实图片解码。 */
const navigate = async (category: Category) => {
  await page.locator('.category-nav').getByRole('button', { name: new RegExp(`^${categoryLabels[category]}`) }).click();
  await page.waitForFunction(() => [...document.querySelectorAll<HTMLImageElement>('.entry-card .source-artwork img')].some(image => image.complete && image.naturalWidth > 0), undefined, { timeout: 45_000 });
};
/** 等待首屏实际可见的全部图片；索引存在的图片必须下载并解码成功。 */
const settleVisibleImages = async () => {
  const ids = await page.locator('.entry-card').evaluateAll(cards => cards.filter(card => {
    const rect = card.querySelector('.entry-artwork')!.getBoundingClientRect();
    return rect.bottom > 280 && rect.top < innerHeight - 80;
  }).map(card => (card as HTMLElement).dataset.entryId!));
  const visible = ids.map(id => entries.get(id)!);
  const results = await Promise.all(visible.map(async entry => ({ id: entry.id, image: entry.image, result: entry.image ? await page.evaluate(url => window.desktop.resolveAssetImage(url), entry.image) : null })));
  for (const item of results) {
    const file = item.image.split('/').slice(6).join('/');
    assert.equal(!!item.result, indexedFiles.has(file), `可见条目图片加载与已核验索引不符：${item.id}`);
  }
  const expected = results.filter(item => item.result).map(item => item.id);
  await page.waitForFunction(ids => ids.every(id => {
    const image = document.querySelector<HTMLImageElement>(`[data-entry-id="${id}"] img`);
    return image?.complete && image.naturalWidth > 0;
  }), expected);
  return { visible: ids.length, loaded: expected.length };
};

await mkdir(data, { recursive: true });
await mkdir(evidence, { recursive: true });
try {
  assert(process.env.PGR_DATA_REPOSITORY, '需要 PGR_DATA_REPOSITORY 指向只读审计原始表仓库');
  assert(process.env.PGR_ASSET_INDEX, '需要 PGR_ASSET_INDEX 指向已核验所需目录的图片索引');
  const index = JSON.parse(await readFile(process.env.PGR_ASSET_INDEX, 'utf8')) as { revision: string; tree: { type: string; path: string }[] };
  indexedFiles = new Set(index.tree.filter(item => item.type === 'blob').map(item => item.path));
  const fixture = await readMyssalHttpFixture(process.env.PGR_DATA_REPOSITORY);
  const realFetch = globalThis.fetch;
  let snapshot;
  try {
    globalThis.fetch = fixture.fetch;
    snapshot = await loadCatalogSnapshot(defaultSourceProfile, new AbortController().signal);
  } finally { globalThis.fetch = realFetch; }
  snapshot = await attachAssetImages({ ...snapshot, warnings: [] }, new AbortController().signal, join(data, 'source-cache'));
  assert(snapshot.imageSource, '真实远程图片提交检查必须成功');
  assert.equal(snapshot.imageSource.revision, index.revision, '图片提交变化后请重新审计目录');
  entries = new Map(snapshot.entries.map(entry => [entry.id, entry]));
  report.coverage = categories.map(category => {
    const items = snapshot.entries.filter(entry => entry.category === category);
    return { category, total: items.length, matched: items.filter(entry => indexedFiles.has(entry.image.split('/').slice(6).join('/'))).length, noPath: items.filter(entry => !entry.image).length };
  });
  report.imageSource = snapshot.imageSource;
  await writeFile(join(evidence, 'snapshot.json'), JSON.stringify(snapshot));
  const store = new CatalogStore(data);
  try {
    store.applySnapshot(snapshot, '真实图片回归专用资料');
    store.saveSettings({ ...store.getSettings(), theme: 'light', checkOnStartup: false });
  } finally { store.close(); }
  passed('真实远程图片版本已固定', { revision: snapshot.imageSource.revision, entries: snapshot.entries.length });
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PGR_DEV_URL;
  app = await electron.launch({ args: [project], cwd: project, env, timeout: 30_000 });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  page.setDefaultTimeout(10_000);
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.showInactive(); });
  await navigate('character');
  const firstVisible = await settleVisibleImages();
  await page.waitForFunction(() => document.querySelectorAll('.entry-card .source-artwork img').length >= 4, undefined, { timeout: 45_000 });
  const firstImages = await page.locator('.entry-card .source-artwork img').evaluateAll(images => images.map(image => ({ name: (image as HTMLImageElement).alt, width: (image as HTMLImageElement).naturalWidth })));
  assert(firstImages.some(image => image.width > 0));
  const cachedCount = (await readdir(join(data, 'image-cache'))).filter(name => name.endsWith('.json')).length;
  assert(cachedCount <= 24, '浏览一页不应下载全库图片');
  passed('首屏显示真实图片且只按需缓存', { cachedCount, firstImages, ...firstVisible });
  await capture('characters');
  for (const category of categories.filter(category => category !== 'character')) {
    await navigate(category);
    const visible = await settleVisibleImages();
    const image = await page.locator('.entry-card .source-artwork img').first().evaluate(element => ({ name: (element as HTMLImageElement).alt, width: (element as HTMLImageElement).naturalWidth, fit: getComputedStyle(element).objectFit, background: getComputedStyle(element.parentElement!).backgroundColor }));
    assert(image.width > 0);
    assert.equal(image.fit, 'contain');
    passed(`${categoryLabels[category]}真实图片显示`, { ...image, ...visible });
    if (['weather', 'stage', 'dictionary'].includes(category)) await capture(category);
  }
  const missing = snapshot.entries.find(entry => entry.category === 'character' && entry.name.includes('莱亚'));
  if (missing) {
    assert.equal(await page.evaluate(url => window.desktop.resolveAssetImage(url), missing.image), null);
    await navigate('character');
    const card = page.locator(`[data-entry-id="${missing.id}"]`);
    await card.waitFor();
    assert.equal(await card.locator('.entry-artwork img').count(), 0);
    assert.equal(await card.locator('.entry-artwork svg').count(), 1);
    passed('当前缺图机体保留占位', { id: missing.id, name: missing.name });
  }
  await page.getByRole('button', { name: '同步中心', exact: true }).click();
  await page.getByText('基础资料图片', { exact: true }).waitFor();
  assert((await page.locator('.settings-page').innerText()).includes(snapshot.imageSource.version));
  passed('同步中心显示独立图片来源和已启用版本');
  await capture('source');
  const known = snapshot.entries.find(entry => entry.name === firstImages.find(image => image.width > 0)?.name)!;
  assert(known?.image);
  const original = await page.evaluate(url => window.desktop.resolveAssetImage(url), known.image);
  await app.evaluate(() => {
    const scope = globalThis as typeof globalThis & { imageOfflineRequests?: number };
    scope.imageOfflineRequests = 0;
    globalThis.fetch = async () => { scope.imageOfflineRequests!++; throw new Error('离线验证'); };
  });
  const offline = await page.evaluate(url => window.desktop.resolveAssetImage(url), known.image);
  assert.equal(offline, original);
  assert.equal(await app.evaluate(() => (globalThis as typeof globalThis & { imageOfflineRequests?: number }).imageOfflineRequests), 0);
  await navigate('character');
  await page.waitForFunction(name => [...document.querySelectorAll<HTMLImageElement>('.entry-card img')].some(image => image.alt === name && image.naturalWidth > 0), known.name);
  passed('断网后从磁盘缓存读取并显示图片', { name: known.name });
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) { report.failure = String(error); process.exitCode = 1; console.error(error); }
finally {
  try { await close(); } catch (error) { report.cleanupFailure = String(error); process.exitCode = 1; report.passed = false; }
  await writeFile(join(evidence, 'asset-images.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, evidence, failure: report.failure }));
}
