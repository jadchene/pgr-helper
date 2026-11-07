import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CatalogStore } from '../src/main/store';
import { categories, categoryLabels, type CatalogEntry, type CatalogSnapshot, type Category } from '../src/shared/types';

const project = resolve(import.meta.dirname, '..');
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/detail-navigation'));
const data = resolve(process.env.PGR_DETAIL_DATA || join(project, `test-results/detail-data-${Date.now()}`));
const snapshotPath = process.env.PGR_DETAIL_SNAPSHOT ? resolve(process.env.PGR_DETAIL_SNAPSHOT) : '';
const focusOnly = process.env.PGR_DETAIL_SCOPE === 'focus';
const execute = promisify(execFile);
const checks: Record<string, unknown>[] = [];
const rendererErrors: string[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(), passed: false, dataDirectory: data, snapshotPath, checks, rendererErrors,
  sourceMode: '已审计固定源表生成的完整快照；仅为导航测试清空所有 image 字段，不进行真实网络同步或图片验证',
  scope: focusOnly ? '仅键盘进入与删除后焦点边界' : '八分类与完整详情导航',
};
let app: ElectronApplication | undefined;
let page: Page;

/** 每项只记录完成的可见界面断言，失败时保存当前现场。 */
const passed = (name: string, details: Record<string, unknown> = {}): void => {
  checks.push({ name, passed: true, ...details });
  console.log(`通过：${name}`);
};

/** 精确匹配资料中的名称，不让标点成为正则表达式。 */
const exact = (value: string): RegExp => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** 切换侧栏后只定位可见列表，隐藏的保留状态不算返回成功。 */
const navigate = async (category: Category): Promise<void> => {
  await page.locator('.category-nav button').filter({ has: page.locator('span', { hasText: exact(categoryLabels[category]) }) }).click();
  await page.locator('.catalog-page:visible').waitFor();
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  assert((await page.locator('.catalog-page:visible h1').innerText()).startsWith(categoryLabels[category]));
};

/** 读取列表可见状态，用实际渲染结果核验返回后的恢复。 */
const listState = async () => page.locator('.catalog-page:visible').evaluate(element => ({
  ids: [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].map(item => item.dataset.entryId),
  heading: element.querySelector('h1')?.textContent?.trim(),
  search: element.querySelector<HTMLInputElement>('.catalog-toolbar input')?.value,
  order: element.querySelector('.catalog-order')?.textContent?.trim(),
  filters: element.querySelector('.filter-summary')?.textContent?.trim() || '',
  filterCount: element.querySelector('.filter-count')?.textContent?.trim() || '',
  pagination: element.querySelector('.pagination-bar')?.textContent?.trim(),
  currentPage: element.querySelector('.n-pagination-item--active')?.textContent?.trim(),
  scrollTop: element.querySelector('.catalog-scroll')?.scrollTop || 0,
}));

/** 返回既有列表并核对条件、页码、顺序与滚动位置。 */
const backToList = async (before?: Awaited<ReturnType<typeof listState>>): Promise<void> => {
  await page.locator('.detail-page').getByRole('button', { name: '返回列表', exact: true }).click();
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  await page.locator('.catalog-page:visible').waitFor();
  if (before) {
    await page.waitForFunction(scrollTop => {
      const catalog = [...document.querySelectorAll<HTMLElement>('.catalog-page')].find(element => element.offsetWidth > 0);
      return Math.abs((catalog?.querySelector('.catalog-scroll')?.scrollTop || 0) - scrollTop) <= 2;
    }, before.scrollTop, { polling: 50 });
    const after = await listState();
    assert(Math.abs(after.scrollTop - before.scrollTop) <= 2, '返回后列表滚动位置改变');
    assert.deepEqual({ ...after, scrollTop: 0 }, { ...before, scrollTop: 0 });
  }
};

/** 验证资料在内容区独立展示，侧栏仍可操作且不再创建抽屉。 */
const expectDetail = async (entry: Pick<CatalogEntry, 'name'>): Promise<void> => {
  await page.locator('.detail-page:visible .detail-hero h1').filter({ hasText: exact(entry.name) }).waitFor();
  assert.equal(await page.locator('.catalog-page:visible').count(), 0, '详情应替换列表的可见内容');
  assert.equal(await page.locator('.n-drawer:visible').count(), 0, '不应再打开抽屉');
  assert(await page.locator('.category-nav').isVisible(), '侧栏在详情中不可见');
  const rects = await page.evaluate(() => [document.querySelector('.main-content'), document.querySelector('.detail-page')].map(element => {
    const rect = element!.getBoundingClientRect();
    return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
  }));
  assert(rects[1].left >= rects[0].left && rects[1].right <= rects[0].right + 1, '详情越出内容区');
};

/** 从可见列表点击指定条目，避免命中仍保留的隐藏列表。 */
const openEntry = async (entry: CatalogEntry): Promise<void> => {
  await page.locator(`.catalog-page:visible [data-entry-id="${entry.id}"] h2`).click();
  await expectDetail(entry);
};

/** 分组后的详情只展示当前技能，滚动验证需先选择真实最长正文。 */
const selectLongestSkill = async (entry: CatalogEntry): Promise<void> => {
  const metadata = entry.sections.filter(section => section.skill).sort((a, b) => b.body.length - a.body.length)[0]?.skill;
  if (!metadata) return;
  await page.locator(`.skill-group-tabs [data-skill-group="${metadata.groupId}"]`).click();
  await page.locator(`.skill-family-list [data-skill-family="${metadata.familyId}"]`).click();
  const variant = page.locator(`.skill-variants [data-skill-id="${metadata.id}"]`);
  if (await variant.count()) await variant.click();
};

/** 用 Electron 保存当前窗口绘制结果，不依赖隐藏窗口动画完成。 */
const capture = async (name: string): Promise<void> => {
  // 隐藏窗口可能保留旧合成帧；仅展示测试窗口且不抢焦点，再等待实际绘制。
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.waitForTimeout(300);
  const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
};

/** 有界等待退出，超时时只终止本次测试的进程树。 */
const waitExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (value: boolean): void => { clearTimeout(timer); child.removeListener('exit', onExit); done(value); };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};

/** 直接关闭自己的测试实例，避免未保存表单阻止自动清理。 */
const cleanup = async (): Promise<void> => {
  if (!app) return;
  const child = app.process();
  void app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (!(await waitExit(child, 3000))) {
    if (process.platform === 'win32') {
      await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => {
        if (child.exitCode === null && child.signalCode === null) throw error;
      });
    } else child.kill('SIGKILL');
    assert(await waitExit(child, 3000), '测试进程未退出');
  }
  report.process = { pid: child.pid, exited: true, exitCode: child.exitCode };
};

await mkdir(evidence, { recursive: true });
try {
  assert(snapshotPath, '请设置 PGR_DETAIL_SNAPSHOT，指向已审计完整资料快照');
  const snapshot = JSON.parse(await readFile(snapshotPath, 'utf8')) as CatalogSnapshot;
  assert.equal(snapshot.entries.length, 1799, '本回归要求已核验的 1799 条固定快照');
  snapshot.entries = snapshot.entries.map(entry => ({ ...entry, image: '' }));
  await mkdir(data, { recursive: true });
  assert.equal((await readdir(data)).length, 0, '只允许使用空测试目录，拒绝覆盖已有资料');
  const store = new CatalogStore(data);
  try {
    store.applySnapshot(snapshot, '详情导航专用固定表快照（图片已清空）');
    store.saveSettings({ ...store.getSettings(), theme: 'light', fontFamily: '', viewMode: 'grid', checkOnStartup: false });
  } finally { store.close(); }
  report.source = { revision: snapshot.revision, version: snapshot.version, total: snapshot.entries.length, tables: Object.keys(snapshot.fingerprints).length };
  const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]));
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === 'string')), PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PGR_DEV_URL;
  app = await electron.launch({ args: [project], cwd: project, env, timeout: 30_000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => rendererErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
  });
  await page.locator('.catalog-page:visible .entry-card').first().waitFor();

  if (focusOnly) {
    const firstEntry = byId.get((await listState()).ids[0]!)!;
    await page.getByRole('button', { name: '查看排序依据', exact: true }).click();
    await page.locator('.order-help:visible').waitFor();
    for (let index = 0; index < 20; index++) {
      await page.keyboard.press('Tab');
      if (await page.evaluate(id => (document.activeElement as HTMLElement | null)?.dataset.entryId === id, firstEntry.id)) break;
    }
    assert(await page.evaluate(id => (document.activeElement as HTMLElement | null)?.dataset.entryId === id, firstEntry.id), 'Tab 未到达第一张卡片');
    assert(await page.locator('.order-help').isVisible(), '进入详情之前排序说明已自行关闭，无法覆盖残留浮层边界');
    await page.keyboard.press('Enter');
    await expectDetail(firstEntry);
    await page.locator('.order-help').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('.n-base-select-menu:visible').count(), 0);
    await capture('普通机体详情页面');
    await page.keyboard.press('Escape');
    await page.locator('.catalog-page:visible').waitFor();
    await page.locator('.detail-page').waitFor({ state: 'hidden' });
    assert(await page.evaluate(id => (document.activeElement as HTMLElement | null)?.dataset.entryId === id, firstEntry.id), '返回后焦点没有恢复到原卡片');
    await page.keyboard.press('Enter');
    await expectDetail(firstEntry);
    await page.keyboard.press('Control+k');
    await page.locator('.catalog-page:visible').waitFor();
    await page.locator('.detail-page').waitFor({ state: 'hidden' });
    assert(await page.evaluate(() => document.activeElement === document.querySelector('.catalog-search input')));
    passed('排序说明打开时键盘进入详情不残留浮层，Escape 与 Ctrl+K 正确恢复列表焦点');

    await openEntry(firstEntry);
    await page.locator('.detail-page').getByRole('button', { name: '移至回收站', exact: true }).click();
    await page.locator('.n-dialog').getByRole('button', { name: '移至回收站', exact: true }).click();
    await page.locator('.n-dialog').waitFor({ state: 'hidden' });
    await page.locator('.detail-page').waitFor({ state: 'hidden' });
    await page.locator('.catalog-page:visible').waitFor();
    await page.waitForFunction(() => document.activeElement === document.querySelector('.catalog-search input'));
    assert(await page.evaluate(async id => (await window.desktop.getState()).entries.find(entry => entry.id === id)?.hidden, firstEntry.id));
    await capture('删除后列表与搜索焦点');
    passed('删除确认框退场后焦点回到列表搜索框');
    // 此处只补拍最终构建的窄窗口，不重复八分类与编辑流程。
    const longEntry = snapshot.entries.filter(entry => entry.category === 'character' && entry.id !== firstEntry.id).sort((a, b) => b.sections.reduce((sum, section) => sum + section.body.length, 0) - a.sections.reduce((sum, section) => sum + section.body.length, 0))[0];
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0];
      window.setSize(1000, 680);
      window.showInactive();
    });
    await page.getByPlaceholder('搜索名称、别名或关键词').fill(longEntry.name);
    await openEntry(longEntry);
    await selectLongestSkill(longEntry);
    const scroll = await page.locator('.detail-scroll').boundingBox();
    assert(scroll);
    await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + scroll.height / 2);
    await page.mouse.wheel(0, 1400);
    await page.waitForFunction(() => (document.querySelector('.detail-scroll')?.scrollTop || 0) > 500);
    await capture('最小窗口长正文滚动后');
    report.minimumWindowReplay = await page.evaluate(() => ({ width: innerWidth, height: innerHeight, scrollTop: document.querySelector('.detail-scroll')?.scrollTop }));
    await backToList();
  } else {
  const firstEntry = byId.get((await listState()).ids[0]!)!;
  await openEntry(firstEntry);
  await page.locator('.detail-page').getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.locator('.editor-modal').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.editor-modal').waitFor({ state: 'hidden' });
  await expectDetail(firstEntry);
  await page.locator('.detail-page').getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.locator('.n-dialog').waitFor();
  await page.keyboard.press('Escape');
  await page.locator('.n-dialog').waitFor({ state: 'hidden' });
  await expectDetail(firstEntry);
  assert.equal(await page.evaluate(async id => (await window.desktop.getState()).entries.find(entry => entry.id === id)?.hidden, firstEntry.id), false);
  await backToList();
  passed('编辑器与删除确认框按 Escape 取消时保留详情');

  for (const category of categories) {
    await navigate(category);
    for (const mode of ['卡片视图', '列表视图']) {
      await page.getByRole('button', { name: mode, exact: true }).click();
      await page.locator(`.catalog-page:visible ${mode === '卡片视图' ? '.entry-card' : '.entry-row'}`).first().waitFor();
      const before = await listState();
      const entry = byId.get(before.ids[0]!)!;
      await openEntry(entry);
      await backToList(before);
    }
    passed(`${categoryLabels[category]}卡片和列表进入详情并返回原列表`);
  }

  await navigate('stage');
  await page.getByRole('button', { name: '卡片视图', exact: true }).click();
  await page.getByPlaceholder('搜索名称、别名或关键词').fill('arena-');
  await page.locator('.catalog-order .n-select').click();
  await page.locator('.n-base-select-option:visible').filter({ hasText: /^名称顺序$/ }).click();
  await page.locator('[data-facet="gameplay"] .n-select').click();
  await page.locator('.n-base-select-option:visible').filter({ hasText: /^纷争战区$/ }).click();
  await page.getByRole('button', { name: '应用筛选', exact: true }).click();
  await page.locator('.catalog-page:visible .n-pagination-item').filter({ hasText: /^2$/ }).click();
  await page.waitForFunction(() => document.querySelector('.n-pagination-item--active')?.textContent?.trim() === '2');
  const scroller = await page.locator('.catalog-page:visible .catalog-scroll').boundingBox();
  assert(scroller);
  await page.mouse.move(scroller.x + scroller.width / 2, scroller.y + scroller.height / 2);
  await page.mouse.wheel(0, 350);
  await page.waitForFunction(() => (document.querySelector('.catalog-scroll')?.scrollTop || 0) > 100);
  const visibleId = await page.locator('.catalog-page:visible .catalog-scroll').evaluate(element => {
    const bounds = element.getBoundingClientRect();
    return [...element.querySelectorAll<HTMLElement>('[data-entry-id]')].find(item => {
      const rect = item.getBoundingClientRect();
      return rect.top >= bounds.top + 2 && rect.bottom <= bounds.bottom - 2;
    })?.dataset.entryId;
  });
  assert(visibleId, '滚动后没有完整可见的条目');
  const remembered = await listState();
  assert.equal(remembered.currentPage, '2');
  assert.equal(remembered.filterCount, '1');
  assert(remembered.pagination?.includes(`共 ${snapshot.entries.filter(entry => entry.category === 'stage' && entry.catalog?.facets.gameplay?.includes('纷争战区')).length} 条`));
  await openEntry(byId.get(visibleId)!);
  await backToList(remembered);
  passed('返回保留搜索、名称排序、已应用筛选、第 2 页及滚动位置', { state: remembered });

  const origin = snapshot.entries.find(entry => entry.category === 'character' && entry.relatedIds.some(id => byId.get(id)?.category === 'weapon'))!;
  assert(origin, '固定快照缺少机体与武器的关联样本');
  const related = byId.get(origin.relatedIds.find(id => byId.get(id)?.category === 'weapon')!)!;
  await navigate('character');
  await page.getByPlaceholder('搜索名称、别名或关键词').fill(origin.name);
  const originList = await listState();
  await openEntry(origin);
  await page.locator('.detail-page .related-list button').filter({ has: page.locator('strong', { hasText: exact(related.name) }) }).click();
  await expectDetail(related);
  await page.locator('.detail-page').getByRole('button', { name: '编辑资料', exact: true }).click();
  await page.getByPlaceholder('例如：露西亚·深红囚影').fill(`${related.name}·取消验证`);
  await page.locator('.editor-modal').getByRole('button', { name: '取消', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.editor-modal').waitFor({ state: 'hidden' });
  await expectDetail(related);
  assert.equal(await page.evaluate(async id => (await window.desktop.getState()).entries.find(entry => entry.id === id)?.name, related.id), related.name);
  await page.locator('.detail-page').getByRole('button', { name: '编辑资料', exact: true }).click();
  const changedName = `${related.name}·导航验证`;
  await page.getByPlaceholder('例如：露西亚·深红囚影').fill(changedName);
  await page.locator('.editor-modal').getByRole('button', { name: '保存资料', exact: true }).click();
  await page.locator('.editor-modal').waitFor({ state: 'hidden' });
  await expectDetail({ name: changedName });
  const saved = await page.evaluate(async id => (await window.desktop.getState()).entries.find(entry => entry.id === id), related.id);
  assert.equal(saved?.name, changedName);
  assert.deepEqual(saved?.catalog, related.catalog);
  await page.locator('.detail-page').getByRole('button', { name: '恢复源内容', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '恢复源内容', exact: true }).click();
  await expectDetail(related);
  await backToList(originList);
  passed('跨分类关联详情编辑取消、保存、恢复源内容后仍返回最初机体列表', { origin: origin.id, related: related.id });

  await openEntry(origin);
  await navigate('character');
  await openEntry(origin);
  await navigate('weapon');
  const weaponId = (await listState()).ids[0]!;
  await openEntry(byId.get(weaponId)!);
  await page.locator('.utility-nav').getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  await page.locator('.main-content h1').filter({ hasText: /^设置$/ }).waitFor();
  passed('点击当前分类、其他分类与设置侧栏均退出详情');

  await navigate('dictionary');
  const removed = byId.get((await listState()).ids[0]!)!;
  await openEntry(removed);
  await page.locator('.detail-page').getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.locator('.catalog-page:visible').waitFor();
  await page.waitForFunction(async id => (await window.desktop.getState()).entries.find(entry => entry.id === id)?.hidden, removed.id);
  await page.locator('.utility-nav').getByRole('button', { name: /回收站/ }).click();
  await openEntry(removed);
  assert((await page.locator('.detail-page .detail-alert').innerText()).includes('回收站'));
  await page.locator('.detail-page').getByRole('button', { name: '恢复资料', exact: true }).click();
  await page.waitForFunction(async id => !(await window.desktop.getState()).entries.find(entry => entry.id === id)?.hidden, removed.id);
  if (await page.locator('.detail-page:visible').count()) await backToList();
  await page.locator('.catalog-page:visible').getByText('回收站是空的', { exact: true }).waitFor();
  await navigate('dictionary');
  await page.getByPlaceholder('搜索名称、别名或关键词').fill(removed.name);
  await openEntry(removed);
  assert.equal(await page.locator('.detail-page .detail-alert').count(), 0);
  await backToList();
  passed('详情删除后回到列表，回收站详情可恢复并重新查看', { id: removed.id });

  const longEntry = snapshot.entries.filter(entry => entry.category === 'character').sort((a, b) => b.sections.reduce((sum, section) => sum + section.body.length, 0) - a.sections.reduce((sum, section) => sum + section.body.length, 0))[0];
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.setSize(1000, 680);
    window.showInactive();
  });
  await navigate('character');
  await page.getByPlaceholder('搜索名称、别名或关键词').fill(longEntry.name);
  await openEntry(longEntry);
  await selectLongestSkill(longEntry);
  const detailBounds = await page.locator('.detail-scroll').boundingBox();
  assert(detailBounds);
  await page.mouse.move(detailBounds.x + detailBounds.width / 2, detailBounds.y + detailBounds.height / 2);
  await page.mouse.wheel(0, 1400);
  await page.waitForFunction(() => (document.querySelector('.detail-scroll')?.scrollTop || 0) > 500);
  const geometry = await page.evaluate(() => {
    const back = document.querySelector('.detail-back')!.getBoundingClientRect();
    const scroll = document.querySelector('.detail-scroll')!;
    const toolbar = document.querySelector('.detail-toolbar')!;
    return { width: innerWidth, height: innerHeight, back: { top: back.top, bottom: back.bottom, left: back.left, right: back.right }, scrollTop: scroll.scrollTop, scrollHeight: scroll.scrollHeight, clientHeight: scroll.clientHeight, toolbarWidth: toolbar.clientWidth, toolbarScrollWidth: toolbar.scrollWidth, pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth };
  });
  assert(Math.abs(geometry.width - 1000) <= 3 && Math.abs(geometry.height - 680) <= 3);
  assert(geometry.back.top >= 0 && geometry.back.bottom <= geometry.height && geometry.back.left >= 0 && geometry.back.right <= geometry.width, '返回按钮被裁切');
  assert(geometry.scrollHeight > geometry.clientHeight && geometry.scrollTop > 500);
  assert(geometry.toolbarScrollWidth <= geometry.toolbarWidth + 1 && geometry.pageScrollWidth <= geometry.pageWidth + 1, '最小窗口横向溢出');
  await capture('最小窗口长详情与返回按钮');
  await backToList();
  assert.equal(await page.getByPlaceholder('搜索名称、别名或关键词').inputValue(), longEntry.name);
  passed('1000×680 长详情独立滚动，返回按钮和操作区保持可见', { id: longEntry.id, geometry });
  }
  assert.deepEqual(rendererErrors, []);
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  if (app) await capture('详情导航验证失败').catch(error => { report.captureFailure = String(error); });
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { report.cleanupFailure = String(error); report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'detail-navigation.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, evidence }));
}
