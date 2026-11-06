import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CatalogStore } from '../src/main/store';
import type { CatalogSnapshot } from '../src/shared/types';

const project = resolve(import.meta.dirname, '..');
const phase = process.env.PGR_FILTER_PHASE || 'regression';
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/filter-popovers', phase));
const data = resolve(process.env.PGR_FILTER_DATA || join(project, `test-results/filter-popovers-data-${Date.now()}`));
const snapshotPath = process.env.PGR_FILTER_SNAPSHOT ? resolve(process.env.PGR_FILTER_SNAPSHOT) : '';
const execute = promisify(execFile);
const cases: Record<string, unknown>[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(), phase, passed: false, dataDirectory: data, snapshotPath,
  sourceMode: '已审计固定 Git 表生成的完整 HTTP fixture 快照；未进行真实网络同步', cases,
};
let app: ElectronApplication | undefined;
let page: Page;

/** 等待下拉菜单的短过渡完成，不依赖隐藏窗口的动画帧回调。 */
const settle = () => page.waitForTimeout(450);

/** 记录实际菜单和锚点矩形，定位器不依赖字段容器使用 label 还是 div。 */
const state = async (key = 'gameplay') => page.evaluate(fieldKey => {
  const field = document.querySelector(`[data-facet="${fieldKey}"]`);
  const [anchor, fields] = [field?.querySelector('.n-select'), document.querySelector('.filter-fields')].map(element => {
    if (!element) return null;
    const r = element.getBoundingClientRect();
    return { x: r.x, y: r.y, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height };
  });
  return {
    viewport: [innerWidth, innerHeight], fieldTag: field?.tagName, anchor, fields,
    panelVisible: [...document.querySelectorAll('.filter-panel')].some(element => {
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }),
    scrollTop: document.querySelector('.filter-fields')?.scrollTop || 0,
    menus: [...document.querySelectorAll('.n-base-select-menu')].filter(element => {
      const r = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return r.width > 0 && r.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }).map(menu => {
      const r = menu.getBoundingClientRect();
      return {
        rect: { x: r.x, y: r.y, top: r.top, bottom: r.bottom, left: r.left, right: r.right, width: r.width, height: r.height },
        text: menu.textContent?.trim(), scrollTop: Math.max(menu.scrollTop, ...[...menu.querySelectorAll('*')].map(element => element.scrollTop)),
      };
    }),
  };
}, key);

/** 用 Electron 截取当前测试窗口，保存菜单定位的真实绘制结果。 */
const capture = async (name: string): Promise<void> => {
  if (!app) return;
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
};

/** 每项从全新的副本筛选面板开始，避免前一项失败污染下一项。 */
const reset = async (): Promise<void> => {
  await page.locator('.category-nav').getByRole('button', { name: /^机体/ }).click();
  await page.locator('.category-nav').getByRole('button', { name: /^副本/ }).click();
  await page.locator('.catalog-toolbar').getByRole('button', { name: /^筛选/ }).click();
  await page.locator('.filter-panel').waitFor({ state: 'visible' });
  await settle();
};

/** 打开一个实际字段的下拉，不写入 Vue 内部状态。 */
const open = async (key: string): Promise<void> => {
  const select = page.locator(`[data-facet="${key}"] .n-select`);
  await select.scrollIntoViewIfNeeded();
  await select.click();
  await settle();
  assert.equal((await state(key)).menus.length, 1, `打开 ${key} 后应只有一个菜单`);
};

/** 要求菜单在视口内并贴近它自己的输入框，允许自动向上展开。 */
const attached = (current: Awaited<ReturnType<typeof state>>): void => {
  assert.equal(current.menus.length, 1);
  assert(current.anchor && current.menus[0].rect);
  const anchor = current.anchor;
  const menu = current.menus[0].rect;
  const gap = Math.min(Math.abs(menu.top - anchor.bottom), Math.abs(menu.bottom - anchor.top));
  assert(gap <= 14, `菜单离锚点 ${gap.toFixed(1)}px，疑似掉到窗口底部`);
  assert(Math.abs(menu.left - anchor.left) <= 14, '菜单横向脱离当前字段');
  assert(menu.top >= -1 && menu.bottom <= current.viewport[1] + 1, '菜单超出窗口上下边界');
};

/** 逐项记录失败并继续骨干矩阵，before 报告允许保留多个独立复现。 */
const check = async (name: string, action: () => Promise<Record<string, unknown>>, key = 'gameplay'): Promise<void> => {
  const item: Record<string, unknown> = { name, passed: false };
  try {
    await reset();
    Object.assign(item, await action());
    item.passed = true;
  } catch (error) {
    item.failure = error instanceof Error ? error.message : String(error);
    item.state = await state(key).catch(() => null);
  }
  cases.push(item);
  await capture(`${String(cases.length).padStart(2, '0')}-${name}`).catch(error => { item.captureFailure = String(error); });
  console.log(`${item.passed ? '通过' : '失败'}：${name}${item.failure ? `；${item.failure}` : ''}`);
};

/** 有界等待本测试主进程退出。 */
const waitExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (value: boolean): void => { clearTimeout(timer); child.removeListener('exit', onExit); done(value); };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};

/** 关闭自己的 Electron 实例，必要时只清理本测试进程树。 */
const cleanup = async (): Promise<void> => {
  if (!app) return;
  const child = app.process();
  void app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (!(await waitExit(child, 2500))) {
    if (process.platform === 'win32') {
      await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => {
        if (child.exitCode === null && child.signalCode === null) throw error;
      });
    } else child.kill('SIGKILL');
    assert(await waitExit(child, 2500), '测试进程未能退出');
  }
  report.process = { pid: child.pid, exited: true, exitCode: child.exitCode };
};

await mkdir(evidence, { recursive: true });
try {
  assert(snapshotPath, '请设置 PGR_FILTER_SNAPSHOT，指向已审计固定源表生成的完整 fixture-snapshot.json');
  await mkdir(data, { recursive: true });
  assert.equal((await readdir(data)).length, 0, '拒绝使用非空数据目录');
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as CatalogSnapshot;
  const store = new CatalogStore(data);
  try {
    store.applySnapshot(snapshot, '筛选菜单回归专用固定表快照');
    store.saveSettings({ ...store.getSettings(), theme: 'light', fontFamily: '', checkOnStartup: false });
  } finally { store.close(); }
  report.source = { revision: snapshot.revision, version: snapshot.version, total: snapshot.entries.length, tables: Object.keys(snapshot.fingerprints).length };
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PGR_DEV_URL;
  app = await electron.launch({ args: [project], cwd: project, env, timeout: 30_000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.setSize(1000, 680);
    window.showInactive();
  });
  await page.locator('.entry-card').first().waitFor();

  await check('点击当前字段标题关闭子菜单', async () => {
    await open('gameplay');
    const before = await state();
    const field = await page.locator('[data-facet="gameplay"]').boundingBox();
    assert(field);
    await page.mouse.click(field.x + 12, field.y + 6);
    await settle();
    const after = await state();
    assert(after.panelVisible, '父筛选面板应保留');
    assert.equal(after.menus.length, 0, '点击字段标题后子菜单仍然存在');
    return { before, after };
  });
  await check('点击筛选面板标题关闭子菜单', async () => {
    await open('gameplay');
    await page.locator('.filter-panel > strong').click();
    await settle();
    const after = await state();
    assert(after.panelVisible);
    assert.equal(after.menus.length, 0);
    return { after };
  });
  await check('点击前一字段输入框上方空白关闭子菜单', async () => {
    await open('mode');
    const anchor = await page.locator('[data-facet="gameplay"] .n-select').boundingBox();
    assert(anchor);
    await page.mouse.click(anchor.x + anchor.width - 10, anchor.y - 3);
    await settle();
    const after = await state();
    assert(after.panelVisible);
    assert.equal(after.menus.length, 0, '空白点击打开或留下了另一字段菜单');
    await open('gameplay');
    const reopened = await state();
    attached(reopened);
    return { after, reopened };
  });
  await check('顺序切换字段只保留当前菜单', async () => {
    await open('gameplay');
    // 紧邻字段被前一菜单覆盖；选择其下方未遮挡的输入框，避免自动滚动干扰用例。
    await open('boss');
    const after = await state('boss');
    attached(after);
    assert(after.menus[0].text && !after.menus[0].text.includes('纷争战区'));
    return { after };
  }, 'boss');
  await check('滚动父筛选区域不留下失去锚点的子菜单', async () => {
    await open('gameplay');
    const fields = await page.locator('.filter-fields').boundingBox();
    assert(fields);
    await page.mouse.move(fields.x + 2, fields.y + 4);
    await page.mouse.wheel(0, 550);
    await settle();
    const after = await state();
    assert(after.scrollTop > 0, '滚轮没有实际滚动父区域');
    assert.equal(after.menus.length, 0, '字段离开视口后仍留下孤儿菜单');
    assert(after.panelVisible);
    return { after };
  });
  await check('关闭父筛选面板同时移除子菜单', async () => {
    await open('gameplay');
    await page.locator('.catalog-page .page-heading h1').click();
    await settle();
    const after = await state();
    assert.equal(after.panelVisible, false);
    assert.equal(after.menus.length, 0);
    return { after };
  });
  await check('切换分类同时移除父子菜单', async () => {
    await open('gameplay');
    await page.locator('.category-nav').getByRole('button', { name: /^机体/ }).click();
    await settle();
    const after = await state();
    assert.equal(after.panelVisible, false);
    assert.equal(after.menus.length, 0);
    return { after };
  });
  await check('顶部字段菜单紧贴锚点', async () => {
    await open('gameplay');
    const after = await state();
    attached(after);
    return { after };
  });
  await check('底部字段菜单向上展开且不掉到底部', async () => {
    await open('configStatus');
    const after = await state('configStatus');
    attached(after);
    return { after };
  }, 'configStatus');
  await check('窗口尺寸改变后没有孤儿菜单', async () => {
    await open('configStatus');
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1180, 780));
    await settle();
    const after = await state('configStatus');
    if (after.menus.length) {
      assert(after.panelVisible, '父面板关闭后菜单仍在');
      attached(after);
    }
    return { after };
  }, 'configStatus');
  await check('下拉菜单内部滚轮不误关闭菜单', async () => {
    await open('boss');
    const before = await state('boss');
    const menu = before.menus[0].rect;
    await page.mouse.move(menu.left + menu.width / 2, menu.top + menu.height / 2);
    await page.mouse.wheel(0, 300);
    await settle();
    const after = await state('boss');
    assert.equal(after.menus.length, 1, '滚动选项时菜单被意外关闭');
    assert(after.menus[0].scrollTop > before.menus[0].scrollTop || after.menus[0].text !== before.menus[0].text, '滚轮没有实际滚动选项');
    return { before, after };
  }, 'boss');
  await check('搜索选择与显式应用草稿正常', async () => {
    const before = await page.locator('.pagination-bar > span').innerText();
    await open('boss');
    await page.locator('[data-facet="boss"] input').fill('拉弥亚');
    await page.locator('.n-base-select-option:visible').filter({ hasText: /^拉弥亚$/ }).click();
    await settle();
    assert.equal(await page.locator('.pagination-bar > span').innerText(), before, '未应用的选择改变了资料列表');
    assert((await state('boss')).panelVisible);
    await page.getByRole('button', { name: '应用筛选', exact: true }).click();
    await settle();
    const expected = snapshot.entries.filter(item => item.category === 'stage' && item.catalog?.facets.boss?.includes('拉弥亚')).length;
    assert(expected > 0);
    assert((await page.locator('.pagination-bar > span').innerText()).includes(`共 ${expected} 条`));
    assert.equal(await page.locator('.entry-card').count(), Math.min(expected, 24));
    return { expected, after: await state('boss') };
  }, 'boss');
  report.passed = cases.every(item => item.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { report.cleanupFailure = String(error); report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'filter-popovers.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: cases.length, failed: cases.filter(item => !item.passed).length, evidence }));
}
