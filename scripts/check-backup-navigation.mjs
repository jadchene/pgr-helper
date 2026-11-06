import { _electron as electron } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const appDirectory = resolve(process.env.PGR_BACKUP_APP || project);
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/evidence'));
const data = resolve(process.env.PGR_BACKUP_DATA || join(project, `test-results/backup-navigation-${Date.now()}`));
const expectLocked = process.env.PGR_BACKUP_EXPECT_LOCKED === '1';
const result = { runAt: new Date().toISOString(), passed: false, dataDirectory: data, expectedEditorAvailable: !expectLocked };
await mkdir(evidence, { recursive: true });
await mkdir(data, { recursive: true });
const env = { ...process.env, PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PGR_DEV_URL;
let app;

try {
  app = await electron.launch({
    args: [appDirectory], cwd: project, env, timeout: 30_000,
    ...(process.env.PGR_ELECTRON_EXECUTABLE ? { executablePath: process.env.PGR_ELECTRON_EXECUTABLE } : {}),
  });
  result.processId = app.process().pid;
  const page = await app.firstWindow();
  await page.getByRole('heading', { name: '首次同步基础资料', exact: true }).waitFor({ timeout: 30_000 });
  assert.equal((await page.evaluate(() => window.desktop.getState())).currentVersion, null);
  const backup = join(data, `navigation-backup-${Date.now()}.json`);

  // 仅延迟原生文件选择结果，备份写盘和资料保存仍走真实应用接口。
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = () => new Promise((complete) => {
      globalThis.__releaseNavigationBackup = () => complete({ canceled: false, filePath: path });
    });
  }, backup);
  await page.locator('.utility-nav').getByRole('button', { name: '设置', exact: true }).click();
  await page.getByRole('button', { name: '导出备份', exact: true }).click();
  assert(await app.evaluate(() => typeof globalThis.__releaseNavigationBackup === 'function'));
  await page.locator('.category-nav').getByRole('button', { name: /^机体/ }).click();
  assert.equal(await page.locator('.settings-page').count(), 0);
  await app.evaluate(() => globalThis.__releaseNavigationBackup());
  await page.getByText('备份已导出。', { exact: true }).waitFor();
  assert.equal(JSON.parse(await readFile(backup, 'utf8')).format, 'pgr-helper-backup');

  // 离开设置页后必须能释放全局操作锁，并继续保存实际条目。
  await page.getByRole('button', { name: '新增资料', exact: true }).click();
  result.editorAvailableAfterExport = await page.locator('.editor-modal').waitFor({ timeout: 2000 }).then(() => true).catch(() => false);
  assert.equal(result.editorAvailableAfterExport, !expectLocked);
  if (result.editorAvailableAfterExport) {
    const name = `备份切页回归机体-${Date.now()}`;
    await page.getByPlaceholder('例如：露西亚·深红囚影').fill(name);
    await page.getByRole('button', { name: '保存资料', exact: true }).click();
    await page.waitForFunction(async (value) => (await window.desktop.getState()).entries.some((entry) => entry.name === value), name);
    const state = await page.evaluate(() => window.desktop.getState());
    result.savedEntry = state.entries.find((entry) => entry.name === name).id;
  }
  result.passed = true;
} catch (error) {
  result.failure = String(error);
  throw error;
} finally {
  await writeFile(join(evidence, expectLocked ? 'backup-navigation-before.json' : 'backup-navigation.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  if (app) {
    // 旧缺陷会阻止正常关闭；失败时仅结束本脚本启动的独立测试进程。
    if (expectLocked || !result.passed) app.process().kill();
    else await app.close();
  }
}
