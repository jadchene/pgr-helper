import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { promisify } from 'node:util';

const project = resolve(import.meta.dirname, '..');
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/evidence'));
const data = resolve(process.env.PGR_SMOKE_DATA || join(project, `test-results/desktop-${Date.now()}`));
const networkFixture = join(project, 'scripts/fixtures/network-audit.cjs');
const syncTimeout = Number(process.env.PGR_REMOTE_SYNC_TIMEOUT_MS || 180_000);
await mkdir(evidence, { recursive: true });
await mkdir(data, { recursive: true });
const env = { ...process.env, PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PGR_DEV_URL;
const results = [];
const networkSessions = [];
let app;
let page;
const errors = [];
const runFile = promisify(execFile);

/** 只等待当前测试实例退出，超时后移除监听器。 */
const waitForExit = (child, milliseconds) => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(complete => {
    const finish = value => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      complete(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};

/** 失败时也绕过未保存保护退出，兜底只结束本脚本启动的进程树。 */
const stopTestApp = async () => {
  if (!app) return;
  const child = app.process();
  void app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (await waitForExit(child, 3000)) return;
  if (process.platform === 'win32') {
    await runFile(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => {
      if (child.exitCode === null && child.signalCode === null) throw error;
    });
  } else child.kill('SIGKILL');
  if (!(await waitForExit(child, 3000))) throw new Error(`测试进程 ${child.pid} 未能退出`);
};

/** 真实网络默认透传；离线模式只用于明确标注的失败与持久化回归。 */
const launch = async (mode = 'live', populated = false) => {
  app = await electron.launch({ args: ['-r', networkFixture, project], cwd: project, env: { ...env, PGR_TEST_NETWORK_MODE: mode }, timeout: 30_000 });
  app.process().stderr?.on('data', (chunk) => process.stderr.write(chunk));
  app.process().stdout?.on('data', (chunk) => process.stdout.write(chunk));
  page = await app.firstWindow();
  page.on('pageerror', (error) => errors.push(error.message));
  if (populated) await page.waitForSelector('.entry-card', { timeout: 30_000 });
  else await page.getByRole('heading', { name: '首次同步基础资料', exact: true }).waitFor({ timeout: 30_000 });
};
/** 保存测试结论供复查。 */
const passed = (name, details = {}) => {
  results.push({ name, passed: true, ...details });
  console.log(name);
};
/** 等待本地资料状态满足条件。 */
const state = () => page.evaluate(() => window.desktop.getState());
/** 读取主进程在应用初始化前安装的请求观测记录。 */
const requests = () => app.evaluate(() => globalThis.__pgrNetworkAudit.calls);
/** 切换测试故障模式，不替换来源数据或伪造成功响应。 */
const networkMode = (mode, phase) => app.evaluate((_electron, value) => { Object.assign(globalThis.__pgrNetworkAudit, value); }, { mode, phase });
/** 从用户可见的候选预览获取实际条目总数。 */
const candidateCount = async () => Number((await page.locator('.diff-stats > div strong').first().innerText()).replace(/[^0-9]/g, ''));

try {
  await launch();
  let current = await state();
  const initial = current;
  assert.deepEqual(current.entries, []);
  assert.equal(current.currentVersion, null);
  assert.deepEqual(current.versions, []);
  assert.equal(current.settings.checkOnStartup, false);
  assert(current.settings.sources.every(source => source.transport === 'github' && !Object.hasOwn(source, 'directory')));
  assert.deepEqual(await requests(), []);
  await page.screenshot({ path: join(evidence, '00-首次打开空库.png') });
  passed('首次空库进入手动同步，无自动资料请求');

  await networkMode('offline', 'first-sync-offline-injection');
  await page.getByRole('button', { name: '获取基础资料', exact: true }).click();
  await page.getByText(/离线故障注入/).first().waitFor({ timeout: 15_000 });
  await page.waitForFunction(async () => !(await window.desktop.getSyncProgress()).busy);
  assert.deepEqual(await state(), initial);
  passed('首次同步失败保持空库（离线故障注入）');

  await networkMode('pending', 'first-sync-cancel-injection');
  await page.getByRole('button', { name: '获取基础资料', exact: true }).click();
  await page.locator('.progress-panel').getByRole('button', { name: '取消', exact: true }).click();
  await page.waitForFunction(async () => !(await window.desktop.getSyncProgress()).busy);
  assert.deepEqual(await state(), initial);
  passed('首次同步取消不写入资料（等待请求故障注入）');

  await networkMode('live', 'first-live-remote-sync');
  await page.getByRole('button', { name: '获取基础资料', exact: true }).click();
  await page.getByRole('button', { name: '启用这个版本', exact: true }).waitFor({ timeout: syncTimeout });
  const firstTotal = await candidateCount();
  assert(firstTotal > 0);
  assert.deepEqual(await state(), initial);
  await page.screenshot({ path: join(evidence, '01-首次远程同步预览.png') });
  await page.getByRole('button', { name: '启用这个版本', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.getState()).currentVersion !== null);
  current = await state();
  assert.equal(current.currentVersion.count, firstTotal);
  assert.equal(current.entries.length, firstTotal);
  const minimums = { character: 50, memory: 60, weapon: 100, resonance: 100, pet: 20, stage: 100, weather: 50, dictionary: 25 };
  for (const [category, minimum] of Object.entries(minimums)) assert(current.entries.filter(entry => entry.category === category).length >= minimum, category + ' 分类数量异常');
  const live = (await requests()).filter(request => request.mode === 'live');
  assert(live.some(request => new URL(request.url).hostname === 'api.github.com' && request.status === 200));
  const raw = live.filter(request => new URL(request.url).hostname === 'raw.githubusercontent.com' && request.status === 200);
  assert(raw.length > 0 && raw.every(request => request.url.includes('/' + current.currentVersion.revision + '/cn/bytes/')));
  const firstCache = join(data, 'source-cache', current.currentVersion.revision, 'catalog-v1.json');
  assert((await stat(firstCache)).size > 0);
  passed('真实 GitHub 首次同步：预览前不入库，用户确认后启用', { entries: firstTotal, revision: current.currentVersion.revision, successfulTableRequests: raw.length, network: 'live-github' });
  await page.locator('.category-nav').getByRole('button', { name: /^机体/ }).click();
  await page.waitForSelector('.entry-card');
  await page.evaluate(async () => { const current = await window.desktop.getState(); await window.desktop.saveSettings({ ...current.settings, theme: 'light' }); });
  await page.reload();
  await page.waitForSelector('.entry-card');
  await page.screenshot({ path: join(evidence, '01-机体资料-浅色.png') });
  passed('已同步资料展示', { entries: current.entries.length, version: current.currentVersion.version });

  await page.getByPlaceholder('搜索名称、别名或关键词').fill('深红囚影');
  await page.getByRole('button', { name: '查看露西亚·深红囚影', exact: true }).click();
  await page.locator('.skill-group-tabs').getByRole('tab', { name: /特殊技能/ }).click();
  await page.locator('.skill-family-list [data-skill-family]').filter({ hasText: 'QTE技能' }).click();
  await page.locator('.skill-content').getByText('晖煌掠形', { exact: true }).waitFor();
  await page.locator('.detail-page:visible').waitFor();
  assert.equal(await page.locator('.catalog-page:visible').count(), 0);
  await page.screenshot({ path: join(evidence, '02-机体详情.png'), animations: 'disabled' });
  await page.locator('.detail-page').getByRole('button', { name: '返回列表', exact: true }).click();
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  await page.locator('.catalog-page:visible').waitFor();
  await page.getByPlaceholder('搜索名称、别名或关键词').clear();
  passed('搜索与完整技能详情');

  await page.getByRole('button', { name: '筛选', exact: true }).click();
  const beforeFilter = await page.locator('.pagination-bar').innerText();
  await page.locator('.filter-panel .n-select').first().click();
  await page.locator('.n-base-select-option').filter({ hasText: /^雷$/ }).click();
  assert.equal(await page.locator('.pagination-bar').innerText(), beforeFilter);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  assert((await page.locator('.entry-card').count()) < 24);
  assert((await page.locator('.entry-card .element-tag').allTextContents()).every((element) => element === '雷'));
  await page.getByRole('button', { name: '清除条件', exact: true }).click();
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await page.waitForSelector('.entry-row');
  await page.getByRole('button', { name: '卡片视图', exact: true }).click();
  await page.waitForSelector('.entry-card');
  passed('筛选待应用与卡片列表切换');

  await page.getByRole('button', { name: '新增资料', exact: true }).click();
  await page.getByPlaceholder('例如：露西亚·深红囚影').fill('验证用本地机体');
  await page.getByPlaceholder('用几句话描述这条资料').fill('通过真实界面创建，重启、同步和备份后应保留。');
  await app.evaluate(({ dialog }, image) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [image] }); }, join(project, 'resources/icon.png'));
  await page.getByRole('button', { name: '添加图片', exact: true }).click();
  await page.getByRole('button', { name: '更换图片', exact: true }).waitFor();
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.getState()).entries.some((entry) => entry.name === '验证用本地机体'));
  current = await state();
  const created = current.entries.find((entry) => entry.name === '验证用本地机体');
  assert.equal(created.origin, 'local');
  assert(created.image.startsWith('data:image/png;base64,'));
  await page.getByRole('button', { name: '编辑资料', exact: true }).last().click();
  await page.getByPlaceholder('例如：露西亚·深红囚影').fill('验证用本地机体·修订');
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.waitForFunction(async () => (await window.desktop.getState()).entries.some((entry) => entry.name === '验证用本地机体·修订'));
  await page.getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.waitForFunction(async (id) => (await window.desktop.getState()).entries.find((entry) => entry.id === id)?.hidden, created.id);
  await page.locator('.utility-nav').getByRole('button', { name: /回收站/ }).click();
  await page.getByRole('button', { name: '恢复资料', exact: true }).click();
  await page.waitForFunction(async (id) => !(await window.desktop.getState()).entries.find((entry) => entry.id === id)?.hidden, created.id);
  passed('真实界面新增、编辑、删除及回收站恢复');

  await page.evaluate(async () => {
    const current = await window.desktop.getState();
    const source = current.entries.find((entry) => entry.id === 'character:1021005');
    const { origin, modified, hidden, retired, updatedAt, ...entry } = source;
    entry.aliases = [...entry.aliases, '桌面验证别名'];
    await window.desktop.saveEntry(entry);
  });
  await page.locator('.utility-nav').getByRole('button', { name: '同步中心', exact: true }).click();
  await networkMode('live', 'second-live-remote-sync');
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByRole('button', { name: '启用这个版本', exact: true }).waitFor({ timeout: syncTimeout });
  const nextTotal = await candidateCount();
  await page.screenshot({ path: join(evidence, '03-同步预览.png') });
  const beforeVersion = (await state()).currentVersion.id;
  await page.getByRole('button', { name: '启用这个版本', exact: true }).click();
  await page.waitForFunction(async (version) => (await window.desktop.getState()).currentVersion.id !== version, beforeVersion);
  current = await state();
  assert.equal(current.currentVersion.count, nextTotal);
  assert(current.entries.find((entry) => entry.id === 'character:1021005').aliases.includes('桌面验证别名'));
  assert.equal(current.entries.find((entry) => entry.id === created.id).name, '验证用本地机体·修订');
  passed('再次检查真实远程来源并启用，保留本地修改');

  await page.locator('.utility-nav').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await page.screenshot({ path: join(evidence, '04-设置-深色.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 680));
  await page.screenshot({ path: join(evidence, '05-最小窗口.png') });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth));
  passed('深色主题与最小窗口布局');

  const backup = join(data, 'smoke-backup.json');
  await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, backup);
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  await page.getByText('备份已导出。', { exact: true }).waitFor();
  const saved = JSON.parse(await readFile(backup, 'utf8'));
  assert.equal(saved.localEntries.length, 1);
  await page.evaluate(async (id) => { await window.desktop.deleteEntry(id); const current = await window.desktop.getState(); await window.desktop.saveSettings({ ...current.settings, theme: 'light' }); }, created.id);
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false });
  }, backup);
  await page.getByRole('button', { name: '从备份恢复', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '选择备份文件', exact: true }).click();
  await page.getByText('备份已恢复。', { exact: true }).waitFor();
  current = await state();
  assert.equal(current.settings.theme, 'dark');
  assert.equal(current.entries.find((entry) => entry.id === created.id).hidden, false);
  passed('真实界面完整备份与恢复');
  const versionBeforeRestart = current.currentVersion.id;
  assert.equal(current.settings.checkOnStartup, false);
  const cacheFile = join(data, 'source-cache', current.currentVersion.revision, 'catalog-v1.json');
  const cacheBeforeRestart = await readFile(cacheFile, 'utf8');
  networkSessions.push({ name: 'live-and-injected-first-session', requests: await requests() });

  await app.close();
  await launch('offline', true);
  current = await state();
  assert.equal(current.settings.theme, 'dark');
  assert.equal(current.entries.find((entry) => entry.id === created.id).name, '验证用本地机体·修订');
  assert(current.entries.find((entry) => entry.id === 'character:1021005').aliases.includes('桌面验证别名'));
  assert.equal(current.currentVersion.id, versionBeforeRestart);
  assert.deepEqual(await requests(), []);
  assert.equal(await readFile(cacheFile, 'utf8'), cacheBeforeRestart);
  passed('离线注入下重启直接读取已有资料与缓存，无自动网络请求');
  const beforeFailedUpdate = await state();
  await page.locator('.utility-nav').getByRole('button', { name: '同步中心', exact: true }).click();
  await page.getByRole('button', { name: '检查更新', exact: true }).click();
  await page.getByText(/离线故障注入/).first().waitFor({ timeout: 15_000 });
  await page.waitForFunction(async () => !(await window.desktop.getSyncProgress()).busy);
  assert.deepEqual(await state(), beforeFailedUpdate);
  assert.equal(await readFile(cacheFile, 'utf8'), cacheBeforeRestart);
  passed('更新失败保留已同步版本、本地编辑和缓存（离线故障注入）');
  networkSessions.push({ name: 'offline-injected-restart', requests: await requests() });
  assert.equal(errors.length, 0, errors.join('\n'));
  passed('重启后资料、来源与设置持久化，无渲染异常');
  await writeFile(join(evidence, 'electron-smoke.json'), JSON.stringify({ runAt: new Date().toISOString(), dataDirectory: data, results, errors, networkSessions }, null, 2));
} catch (error) {
  if (page) await page.screenshot({ path: join(evidence, 'smoke-failure.png') }).catch(() => {});
  if (app) networkSessions.push({ name: 'failure-snapshot', requests: await requests().catch(() => []) });
  await writeFile(join(evidence, 'electron-smoke-failure.json'), JSON.stringify({ runAt: new Date().toISOString(), results, errors, networkSessions, failure: String(error) }, null, 2));
  throw error;
} finally {
  await stopTestApp();
}
