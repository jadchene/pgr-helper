import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { cp, mkdir, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const source = join(project, 'release/win-unpacked');
const destination = resolve(process.env.PGR_PACKAGED_TEST_DIR || join(project, `test-results/packaged-${Date.now()}`));
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/evidence'));
await mkdir(destination, { recursive: true });
await mkdir(evidence, { recursive: true });
await cp(source, destination, { recursive: true, filter: (path) => !path.startsWith(join(source, 'data')) });
const env = { ...process.env, PGR_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
let app;
let page;
const errors = [];
/** 使用 Electron 原生截图保持测试窗口隐藏，避免 DevTools 截图等待后台合成帧。 */
const captureHiddenWindow = async (path) => {
  if (!app) return;
  let timer;
  try {
    const encoded = await Promise.race([
      app.evaluate(async ({ BrowserWindow }) => {
        const screenshot = await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
        if (screenshot.isEmpty()) throw new Error('成品截图为空');
        return screenshot.toPNG().toString('base64');
      }),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('隐藏成品截图超时')), 15_000); }),
    ]);
    await writeFile(path, Buffer.from(encoded, 'base64'));
  } finally { clearTimeout(timer); }
};
try {
  app = await electron.launch({ executablePath: join(destination, '战双助手.exe'), args: [], cwd: destination, env, timeout: 30_000 });
  page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  // 仅对隐藏测试实例关闭后台节流，保持截图时的渲染状态。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  page.on('pageerror', (error) => errors.push(error.message));
  await page.getByRole('heading', { name: '首次同步基础资料', exact: true }).waitFor();
  const state = await page.evaluate(() => window.desktop.getState());
  assert.equal(state.appVersion, '0.1.0');
  assert.equal(state.entries.length, 0);
  assert.deepEqual(state.guides, []);
  assert.equal(await page.title(), '战双助手');
  assert.equal(state.currentVersion, null);
  assert.deepEqual(state.versions, []);
  assert.equal(state.settings.checkOnStartup, false);
  assert.equal(state.settings.fontFamily, '');
  assert(state.settings.sources.every(source => source.transport === 'github' && !Object.hasOwn(source, 'directory')));
  assert.equal((await page.evaluate(() => window.desktop.getSyncProgress())).busy, false);
  assert.equal(resolve(state.dataDirectory), join(destination, 'data'));
  assert.equal(await app.evaluate(({ app }) => app.isPackaged), true);
  const fonts = await page.evaluate(() => window.desktop.listSystemFonts());
  assert(fonts.length > 0);
  assert(fonts.every(font => typeof font.family === 'string' && !!font.family && typeof font.label === 'string' && !!font.label));
  const webPreferences = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences());
  assert.equal(webPreferences.nodeIntegration, false);
  assert.equal(webPreferences.contextIsolation, true);
  assert.equal(webPreferences.sandbox, true);
  assert.equal(await page.evaluate(() => typeof window.require), 'undefined');
  assert((await stat(join(state.dataDirectory, 'pgr.sqlite'))).isFile());
  const refusal = await page.evaluate(async () => { try { await window.desktop.openExternal('file:///C:/Windows/system.ini'); return false; } catch { return true; } });
  assert(refusal);
  assert.equal(errors.length, 0);
  await captureHiddenWindow(join(evidence, '06-Windows成品启动.png'));
  await writeFile(join(evidence, 'packaged-smoke.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), executable: join(destination, '战双助手.exe'), sourceDirectory: source, appVersion: state.appVersion, entries: state.entries.length, dataDirectory: state.dataDirectory, isPackaged: true, rendererIsolated: true, invalidExternalUrlRejected: true, systemFontCount: fonts.length, systemFontExample: fonts.find(font => font.family === 'Microsoft YaHei') || fonts[0], errors }, null, 2));
  console.log(`Windows 成品独立启动通过：空资料库等待用户手动同步，SQLite 位于程序目录，渲染进程隔离有效，实际枚举 ${fonts.length} 个系统字体。`);
} catch (error) {
  await captureHiddenWindow(join(evidence, 'packaged-smoke-failure.png')).catch(() => {});
  await writeFile(join(evidence, 'packaged-smoke-failure.json'), JSON.stringify({ verifiedAt: new Date().toISOString(), passed: false, failure: String(error), errors }, null, 2));
  throw error;
} finally {
  await app?.close();
}
