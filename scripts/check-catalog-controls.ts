import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CatalogStore } from '../src/main/store';
import { defaultSourceProfile } from '../src/main/schemas';
import { loadCatalogSnapshot, myssalTablePaths } from '../src/main/sources';
import { categories, categoryLabels, type CatalogEntry, type Category } from '../src/shared/types';
import { catalogQueryConfig, compareCatalogEntries, facetValues } from '../src/renderer/catalog-query';
import { readMyssalHttpFixture } from '../tests/helpers/myssal-http-fixture';

const project = resolve(import.meta.dirname, '..');
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/catalog-controls'));
const data = resolve(process.env.PGR_CATALOG_DATA || join(project, `test-results/catalog-data-${Date.now()}`));
const repository = process.env.PGR_DATA_REPOSITORY;
const boundaryOnly = process.env.PGR_CATALOG_SCOPE === 'boundaries';
const runFile = promisify(execFile);
const checks: Record<string, unknown>[] = [];
const errors: string[] = [];
const report: Record<string, unknown> = {
  runAt: new Date().toISOString(), passed: false, dataDirectory: data,
  sourceMode: '真实固定 Git 表构成的 HTTP fixture；本次未验证真实网络同步',
  scope: boundaryOnly ? '仅剩余窗口与保存边界；不代表重新执行全部分类' : '全部分类与边界',
  checks, rendererErrors: errors,
};
let app: ElectronApplication | undefined;
let page: Page;
let originalEntries: CatalogEntry[] = [];
const facetKeys: Record<Category, string> = {
  character: 'element', memory: 'purpose', weapon: 'weaponType', resonance: 'resonanceType',
  pet: 'element', stage: 'gameplay', weather: 'affixType', dictionary: 'dictionaryType',
};

/** 等待界面处理完当前操作；隐藏窗口可能暂停动画帧，使用短暂任务队列等待。 */
const settle = async (): Promise<void> => {
  await page.waitForTimeout(40);
};

/** 在报告与终端保留每项已经完成的真实界面断言。 */
const passed = (name: string, details: Record<string, unknown> = {}): void => {
  checks.push({ name, passed: true, ...details });
  console.log(name);
};

/** 对文本构建精确匹配表达式，不让资料中的标点改变选择范围。 */
const exact = (value: string): RegExp => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** 通过真实导航切换分类，同时等待上一分类的条件和弹层清除。 */
const navigate = async (category: Category): Promise<void> => {
  await page.locator('.category-nav button').filter({ has: page.locator('span', { hasText: exact(categoryLabels[category]) }) }).click();
  await page.locator('.catalog-page .page-heading h1').filter({ hasText: categoryLabels[category] }).waitFor();
  await settle();
  assert.equal(await page.locator('.filter-panel:visible').count(), 0);
};

/** 直接读取渲染出的条目标识、名称与可见计数，不访问 Vue 组件内部状态。 */
const visibleResult = async () => page.evaluate(() => {
  const articles = [...document.querySelectorAll<HTMLElement>('.entry-card, .entry-row')];
  const count = document.querySelector('.pagination-bar > span')?.textContent?.match(/共\s*([\d,]+)\s*条/);
  return {
    ids: articles.map(element => element.dataset.entryId),
    names: articles.map(element => element.querySelector('h2')?.textContent?.trim()),
    count: count ? Number(count[1].replaceAll(',', '')) : 0,
  };
});

/** 验证当前页的实际顺序、全部匹配数及显示名称。 */
const expectResult = async (items: CatalogEntry[], pageNumber = 1): Promise<void> => {
  const shown = items.slice((pageNumber - 1) * 24, pageNumber * 24);
  const expected = { ids: shown.map(item => item.id), names: shown.map(item => item.name), count: items.length };
  await page.waitForFunction(value => {
    const ids = [...document.querySelectorAll<HTMLElement>('.entry-card, .entry-row')].map(element => element.dataset.entryId);
    const count = document.querySelector('.pagination-bar > span')?.textContent?.match(/共\s*([\d,]+)\s*条/);
    return JSON.stringify(ids) === JSON.stringify(value.ids) && Number(count?.[1].replaceAll(',', '') || 0) === value.count;
  }, expected, { timeout: 15_000, polling: 50 });
  assert.deepEqual(await visibleResult(), expected);
};

/** 打开筛选面板，并校验当前分类独有的字段名称和顺序。 */
const openFilters = async (category: Category): Promise<void> => {
  await page.locator('.catalog-toolbar').getByRole('button', { name: /^筛选/ }).click();
  await page.locator('.filter-panel').waitFor({ state: 'visible' });
  const fields = await page.locator('.filter-panel [data-facet]:not([data-facet="status"])').evaluateAll(elements => elements.map(element => ({
    key: element.getAttribute('data-facet'),
    label: element.querySelector(':scope > span')?.textContent?.trim(),
  })));
  assert.deepEqual(fields, catalogQueryConfig[category].filters);
};

/** 在可搜索下拉框中通过用户操作选择明确存在的筛选值。 */
const chooseFacet = async (key: string, value: string): Promise<void> => {
  const select = page.locator(`.filter-panel [data-facet="${key}"] .n-select`);
  await select.click();
  await select.locator('input').fill(value);
  await page.locator('.n-base-select-option:visible').filter({ hasText: exact(value) }).click();
  await settle();
};

/** 点击面板外部，关闭草稿但不触发应用。 */
const dismissFilters = async (): Promise<void> => {
  await page.locator('.catalog-page .page-heading h1').click();
  await page.locator('.filter-panel').waitFor({ state: 'hidden' });
  await settle();
};

/** 选择确有子集的实际条件，优先覆盖当前页中具备多值的条目。 */
const chooseSubset = (items: CatalogEntry[], key: string) => {
  const candidates = [...new Set(items.flatMap(item => facetValues(item, key)))].filter(value => value !== '未提供').map(value => {
    const matches = items.filter(item => facetValues(item, key).includes(value)).sort(compareCatalogEntries);
    return { value, matches, multi: matches.slice(0, 24).filter(item => facetValues(item, key).length > 1).map(item => item.id) };
  }).filter(candidate => candidate.matches.length > 0 && candidate.matches.length < items.length);
  candidates.sort((a, b) => Number(!!b.multi.length) - Number(!!a.multi.length) || b.matches.length - a.matches.length || a.value.localeCompare(b.value, 'zh-CN'));
  assert(candidates.length > 0, `真实资料没有可测试的 ${key} 子集`);
  return candidates[0];
};

/** 通过排序菜单切换名称顺序，验证筛选结果本身保持一致。 */
const nameOrder = async (items: CatalogEntry[]): Promise<void> => {
  await page.locator('.catalog-order .n-select').click();
  await page.locator('.n-base-select-option:visible').filter({ hasText: /^名称顺序$/ }).click();
  await expectResult([...items].sort((a, b) => compareCatalogEntries(a, b, 'name')));
};

/** 有界等待本脚本的 Electron 主进程退出，不留下事件监听或计时器。 */
const waitForExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (exited: boolean): void => {
      clearTimeout(timer);
      child.removeListener('exit', onExit);
      done(exited);
    };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};

/** 直接退出测试实例，必要时仅终止它的进程树；不依赖未保存表单确认。 */
const stopTestApp = async (): Promise<void> => {
  if (!app) return;
  const child = app.process();
  void app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (!(await waitForExit(child, 3000))) {
    if (process.platform === 'win32') {
      const taskkill = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      await runFile(taskkill, ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => {
        if (child.exitCode === null && child.signalCode === null) throw error;
      });
    } else child.kill('SIGKILL');
    assert(await waitForExit(child, 3000), `测试进程 ${child.pid} 未退出`);
  }
  report.process = { pid: child.pid, exited: true, exitCode: child.exitCode, signal: child.signalCode };
};

await mkdir(evidence, { recursive: true });
try {
  assert(repository, '请设置 PGR_DATA_REPOSITORY，指向已审计的完整 Myssal Git 仓库');
  await mkdir(data, { recursive: true });
  assert.equal((await readdir(data)).length, 0, '测试只允许使用空目录，拒绝覆盖已有资料');
  const fixture = await readMyssalHttpFixture(repository);
  const originalFetch = globalThis.fetch;
  let snapshot;
  try {
    globalThis.fetch = fixture.fetch;
    snapshot = await loadCatalogSnapshot(defaultSourceProfile, new AbortController().signal, () => {}, { cacheDirectory: join(data, 'source-cache') });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(myssalTablePaths.length, 57);
  assert.equal(Object.keys(snapshot.fingerprints).length, 57);
  originalEntries = snapshot.entries;
  await writeFile(join(data, 'fixture-snapshot.json'), JSON.stringify(snapshot, null, 2));
  const store = new CatalogStore(data);
  try {
    store.applySnapshot(snapshot, '真实固定国服表 HTTP fixture（非实际联网）');
    store.saveSettings({ ...store.getSettings(), theme: 'light', fontFamily: '', viewMode: 'grid', checkOnStartup: false });
    report.source = {
      repository, revision: snapshot.revision, version: snapshot.version,
      total: snapshot.entries.length, sourceTableCount: Object.keys(snapshot.fingerprints).length,
      categoryCounts: Object.fromEntries(categories.map(category => [category, snapshot.entries.filter(item => item.category === category).length])),
      fingerprints: snapshot.fingerprints, fixtureRequests: fixture.requests,
      currentVersion: store.getState().currentVersion,
    };
  } finally {
    store.close();
  }
  const env: Record<string, string> = {
    ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')),
    PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PGR_DEV_URL;
  app = await electron.launch({ args: [project], cwd: project, env, timeout: 30_000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(15_000);
  // 仅测试实例关闭后台节流，避免隐藏窗口的动画与 ResizeObserver 停滞。
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
  page.on('pageerror', error => errors.push(error.message));
  await page.locator('.entry-card').first().waitFor();
  const initial = await page.evaluate(() => window.desktop.getState());
  assert.equal(initial.entries.length, snapshot.entries.length);
  assert.equal(initial.currentVersion?.revision, snapshot.revision);
  assert.equal(initial.settings.fontFamily, '');
  passed('完整固定源表经真实适配器写入隔离 SQLite，界面从默认字体与完整版本启动', { sourceTableCount: 57, total: initial.entries.length });

  const stages = originalEntries.filter(item => item.category === 'stage').sort(compareCatalogEntries);
  if (!boundaryOnly) {
    for (const category of categories) {
      await navigate(category);
      const items = originalEntries.filter(item => item.category === category).sort(compareCatalogEntries);
      await expectResult(items);
      assert.equal(await page.locator('.filter-summary').count(), 0);
      assert((await page.locator('.catalog-order').innerText()).includes(catalogQueryConfig[category].orderLabel));
      await openFilters(category);
      const key = facetKeys[category];
      const subset = chooseSubset(items, key);
      await chooseFacet(key, subset.value);
      await expectResult(items);
      await dismissFilters();
      await openFilters(category);
      await page.locator(`.filter-panel [data-facet="${key}"] .n-base-selection-placeholder`).waitFor({ state: 'visible' });
      await chooseFacet(key, subset.value);
      await page.getByRole('button', { name: '应用筛选', exact: true }).click();
      await expectResult(subset.matches);
      assert.equal(await page.locator('.filter-summary > span').innerText(), `找到 ${subset.matches.length.toLocaleString()} 条资料`);
      const grid = await visibleResult();
      for (const id of subset.multi) assert(grid.ids.includes(id));
      await page.getByRole('button', { name: '列表视图', exact: true }).click();
      await page.locator('.entry-row').first().waitFor();
      await expectResult(subset.matches);
      assert.deepEqual(await visibleResult(), grid);
      await page.getByRole('button', { name: '卡片视图', exact: true }).click();
      await page.locator('.entry-card').first().waitFor();
      await expectResult(subset.matches);
      await openFilters(category);
      await page.locator('.filter-actions').getByRole('button', { name: '清空', exact: true }).click();
      await settle();
      await expectResult(subset.matches);
      await dismissFilters();
      await expectResult(subset.matches);
      await page.screenshot({ path: join(evidence, `${category}-已应用专属筛选.png`), animations: 'disabled' });
      await nameOrder(subset.matches);
      passed(`${categoryLabels[category]}：默认排序、专属标签、草稿应用与丢弃、清空待应用、名称排序、卡片列表一致`, {
        category, facet: key, selected: subset.value, total: items.length, filtered: subset.matches.length,
        multiValueVisibleIds: subset.multi, sourceFirstPage: items.slice(0, 24).map(item => item.id),
      });
    }

    await navigate('character');
    await expectResult(originalEntries.filter(item => item.category === 'character').sort(compareCatalogEntries));
    assert.equal(await page.locator('.filter-summary').count(), 0);
    passed('离开已筛选且按名称排序的分类后，返回分类恢复默认顺序并清空条件');

    await navigate('stage');
    await page.locator('.n-pagination-item').filter({ hasText: /^2$/ }).click();
    await expectResult(stages, 2);
    const stageSubset = chooseSubset(stages, 'gameplay');
    await openFilters('stage');
    await chooseFacet('gameplay', stageSubset.value);
    await page.getByRole('button', { name: '应用筛选', exact: true }).click();
    await expectResult(stageSubset.matches);
    assert.equal((await page.locator('.n-pagination-item--active').innerText()).trim(), '1');
    passed('在第二页应用筛选后返回第一页，并保留完整匹配计数');
  }

  await navigate('stage');
  if (await page.getByRole('button', { name: '清除条件', exact: true }).count()) {
    await page.getByRole('button', { name: '清除条件', exact: true }).click();
  }
  const multiFacet = chooseSubset(stages, 'effect');
  assert(multiFacet.multi.length > 0, '固定样本应有多效应战区条目');
  await openFilters('stage');
  await chooseFacet('effect', multiFacet.value);
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await expectResult(multiFacet.matches);
  assert((await visibleResult()).ids.some(id => multiFacet.multi.includes(id!)));
  passed('多值效应按单个条件命中真实战区，未要求整段拼接文本完全相等', { selected: multiFacet.value, visibleMultiValueIds: multiFacet.multi });

  // 最小窗口边界以短暂可见且不抢焦点的真实窗口核验，结束后统一退出。
  report.minimumWindowVisible = await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.showInactive();
    window.setSize(1000, 680);
    return window.isVisible();
  });
  assert.equal(report.minimumWindowVisible, true);
  // Windows 缩放可能把 DIP 尺寸换算为相邻像素；边界检查使用实际视口。
  await page.waitForFunction(() => Math.abs(innerWidth - 1000) <= 3 && Math.abs(innerHeight - 680) <= 3, undefined, { polling: 50 });
  await openFilters('stage');
  await page.screenshot({ path: join(evidence, '1000x680-长筛选面板.png'), animations: 'disabled' });
  /** 收集实际窗口和筛选面板尺寸，失败时也写入报告。 */
  const measureGeometry = () => page.evaluate(() => {
    const toolbar = document.querySelector<HTMLElement>('.catalog-toolbar')!;
    const actions = document.querySelector<HTMLElement>('.filter-actions')!;
    const fields = document.querySelector<HTMLElement>('.filter-fields')!;
    const a = actions.getBoundingClientRect();
    const t = toolbar.getBoundingClientRect();
    const panel = document.querySelector<HTMLElement>('.filter-panel')!.getBoundingClientRect();
    return {
      viewport: [innerWidth, innerHeight], toolbarScrollWidth: toolbar.scrollWidth, toolbarClientWidth: toolbar.clientWidth,
      pageScrollWidth: document.documentElement.scrollWidth,
      toolbarChildrenInside: [...toolbar.children].every(element => { const r = element.getBoundingClientRect(); return r.left >= t.left - 1 && r.right <= t.right + 1; }),
      actions: { left: a.left, right: a.right, top: a.top, bottom: a.bottom },
      panel: { left: panel.left, right: panel.right, top: panel.top, bottom: panel.bottom },
      scrollableFields: fields.scrollHeight > fields.clientHeight,
    };
  });
  const geometry = await measureGeometry();
  report.minimumWindow = geometry;
  assert(geometry.pageScrollWidth <= geometry.viewport[0], '最小窗口页面横向溢出');
  assert(geometry.toolbarScrollWidth <= geometry.toolbarClientWidth + 1 && geometry.toolbarChildrenInside, '最小窗口工具栏横向溢出');
  assert(geometry.actions.left >= 0 && geometry.actions.right <= geometry.viewport[0] && geometry.actions.top >= 0 && geometry.actions.bottom <= geometry.viewport[1], '最小窗口筛选底部按钮超出可视范围');
  assert(geometry.scrollableFields, '副本长筛选面板应限制高度并允许内部滚动');
  await page.getByRole('button', { name: '应用筛选', exact: true }).click({ trial: true });
  passed('1000×680 最小窗口长筛选面板底部可操作，工具栏无横向溢出', geometry);
  await dismissFilters();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1340, 900));

  await navigate('character');
  const target = originalEntries.filter(item => item.category === 'character').sort(compareCatalogEntries)[0];
  await page.locator(`[data-entry-id="${target.id}"]`).getByRole('button', { name: '编辑资料', exact: true }).click();
  const changedName = `${target.name}·目录验证`;
  await page.getByPlaceholder('例如：露西亚·深红囚影').fill(changedName);
  await page.getByRole('button', { name: '保存资料', exact: true }).click();
  await page.getByText('资料已保存。', { exact: true }).waitFor();
  const after = await page.evaluate(() => window.desktop.getState());
  const edited = after.entries.find(item => item.id === target.id)!;
  assert.equal(edited.name, changedName);
  assert.equal(edited.modified, true);
  assert.deepEqual(edited.catalog, target.catalog);
  await page.keyboard.press('Escape');
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  await page.locator('.catalog-page').waitFor({ state: 'visible' });
  await expectResult(after.entries.filter(item => item.category === 'character').sort(compareCatalogEntries));
  await page.screenshot({ path: join(evidence, '编辑名称后保留目录信息.png'), animations: 'disabled' });
  passed('真实编辑名称保存后，排序元组与专属筛选信息完整保留', { id: edited.id, name: edited.name, catalog: edited.catalog });
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  if (page!) await page.screenshot({ path: join(evidence, boundaryOnly ? '目录边界验证失败.png' : '目录验证失败.png'), animations: 'disabled', timeout: 5000 }).catch(() => {});
  process.exitCode = 1;
} finally {
  try {
    await stopTestApp();
  } catch (error) {
    report.passed = false;
    report.cleanupFailure = String(error);
    process.exitCode = 1;
  } finally {
    const reportFile = join(evidence, boundaryOnly ? 'catalog-controls-boundaries.json' : 'catalog-controls.json');
    await writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(JSON.stringify({ passed: report.passed, checks: checks.length, report: reportFile, dataDirectory: data }));
  }
}
