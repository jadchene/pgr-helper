import { _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CatalogStore } from '../src/main/store';
import { buildGuideFixture, loadGuideSnapshot } from '../tests/helpers/guide-fixture';

const project = resolve(import.meta.dirname, '..');
const phase = process.env.PGR_GUIDE_POPOVER_PHASE || 'after';
const data = resolve(process.env.PGR_GUIDE_POPOVER_DATA || join(project, `test-results/guide-popovers-${Date.now()}`));
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/guide-popovers', phase));
const repository = process.env.PGR_DATA_REPOSITORY || '';
const execute = promisify(execFile);
const cases: Record<string, unknown>[] = [];
const errors: string[] = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), phase, passed: false, dataDirectory: data, cases, errors, sourceMode: '固定真实61表的生产加载器快照，图片置空；不访问用户数据，不做远程同步。' };
let app: ElectronApplication | undefined;
let page!: Page;
let guideId = '';

/** 等待菜单短过渡，避免把退出动画误判为仍展开。 */
const settle = async (): Promise<void> => { await page.waitForTimeout(450); };
/** 读取可见菜单及锚点的真实矩形。 */
const state = async (select?: Locator) => {
  const anchor = select && await select.count() ? await select.boundingBox() : null;
  return page.evaluate(anchor => ({
    anchor,
    viewport: { width: innerWidth, height: innerHeight },
    editorScroll: document.querySelector('.guide-editor-content')?.scrollTop || 0,
    menus: [...document.querySelectorAll('.n-base-select-menu')].filter(element => {
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
    }).map(element => {
      const rect = element.getBoundingClientRect();
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, text: element.textContent?.trim(), scrollTop: Math.max(element.scrollTop, ...[...element.querySelectorAll('*')].map(child => child.scrollTop)) };
    }),
  }), anchor);
};
/** 截取实际可见的桌面窗口。 */
const capture = async (name: string): Promise<void> => {
  if (!app) return;
  const png = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
};
/** 菜单必须紧贴当前字段并位于视口内。 */
const attached = (current: Awaited<ReturnType<typeof state>>): void => {
  assert.equal(current.menus.length, 1);
  assert(current.anchor);
  const menu = current.menus[0];
  const anchor = current.anchor;
  assert(Math.min(Math.abs(menu.y - anchor.y - anchor.height), Math.abs(menu.y + menu.height - anchor.y)) <= 14, '菜单与字段上下边界脱离');
  assert(Math.abs(menu.x - anchor.x) <= 14, '菜单横向脱离字段');
  assert(menu.y >= -1 && menu.y + menu.height <= current.viewport.height + 1, '菜单超出窗口');
};
/** 先通过返回确认放弃前一个用例草稿，再打开独立编辑场景。 */
const edit = async (tab: string): Promise<void> => {
  if (await page.locator('.guides-page[data-guide-mode="edit"]').count()) {
    await page.locator('.guide-editor-toolbar').getByRole('button', { name: /^返回(?:列表|攻略)$/ }).click();
    await settle();
    const discard = page.locator('.n-dialog').getByRole('button', { name: '放弃修改', exact: true });
    if (await discard.count()) await discard.click();
    await page.locator('.guides-page[data-guide-mode="edit"]').waitFor({ state: 'hidden' });
  }
  await page.reload();
  await page.locator('.guide-nav').getByRole('button', { name: /副本攻略/ }).click();
  await page.locator(`[data-guide-id="${guideId}"]`).click();
  await page.getByRole('button', { name: '编辑攻略', exact: true }).click();
  await page.locator('.guide-editor-tabs').getByRole('button', { name: tab, exact: true }).click();
  await settle();
};
/** 避免多选标签关闭按钮，实际点击输入控件左上留白。 */
const open = async (select: Locator): Promise<void> => {
  if ((await state()).menus.length) {
    await page.locator('.guide-editor-toolbar').click({ position: { x: 190, y: 4 } });
    await settle();
  }
  await select.scrollIntoViewIfNeeded();
  await select.click({ position: { x: 5, y: 5 } });
  await settle();
  assert.equal((await state(select)).menus.length, 1, '点击输入框未展开单个菜单');
};
/** 逐项保留修复前失败，不因首个复现中止其余覆盖。 */
const check = async (name: string, action: () => Promise<unknown>): Promise<void> => {
  const item: Record<string, unknown> = { name, passed: false };
  try { item.details = await action(); item.passed = true; }
  catch (error) { item.failure = error instanceof Error ? error.message : String(error); item.state = await state().catch(() => null); }
  cases.push(item);
  if (!item.passed || /搜索|多选|滚动|切换/.test(name)) await capture(`${String(cases.length).padStart(2, '0')}-${name}`).catch(error => { item.captureFailure = String(error); });
  console.log(`${item.passed ? '通过' : '失败'}：${name}${item.failure ? `；${item.failure}` : ''}`);
  if ((await state()).menus.length && await page.locator('.guide-editor-toolbar').count()) await page.locator('.guide-editor-toolbar').click({ position: { x: 190, y: 4 } });
  await settle();
};
/** 验证同字段标题及输入框上方空白，定位独立于原生label或修复后div。 */
const dismissField = async (name: string, select: Locator): Promise<void> => {
  for (const position of ['标题', '空白'] as const) await check(`${name}-${position}收起`, async () => {
    const field = select.locator('..');
    await field.evaluate(element => element.scrollIntoView({ block: 'start' }));
    await open(select);
    const before = await state(select);
    attached(before);
    const a = await select.boundingBox();
    const f = await field.boundingBox();
    assert(a && f);
    const point = { x: position === '标题' ? f.x + 10 : a.x + a.width - 10, y: position === '标题' ? f.y + 6 : a.y - 3 };
    const target = await page.evaluate(point => {
      const element = document.elementFromPoint(point.x, point.y);
      return { tag: element?.tagName, text: element?.textContent?.trim().slice(0, 70), menu: !!element?.closest('.n-base-select-menu'), select: !!element?.closest('.n-select') };
    }, point);
    assert(!target.menu && !target.select, '测试点击点被菜单或控件覆盖，未命中标题/空白');
    await page.mouse.click(point.x, point.y);
    await settle();
    const after = await state(select);
    assert.equal(after.menus.length, 0, `点击${position}后菜单仍存在`);
    return { target, before, after };
  });
};
/** 等待自己的测试进程退出。 */
const waitExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (value: boolean): void => { clearTimeout(timer); child.removeListener('exit', onExit); done(value); };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};
/** 仅关闭本脚本的Electron进程树。 */
const cleanup = async (): Promise<void> => {
  if (!app) return;
  const child = app.process();
  void app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (!(await waitExit(child, 2500))) {
    if (process.platform === 'win32') await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => { if (child.exitCode === null && child.signalCode === null) throw error; });
    else child.kill('SIGKILL');
    assert(await waitExit(child, 2500), '测试进程未退出');
  }
  report.process = { pid: child.pid, exited: true, exitCode: child.exitCode };
};

await mkdir(evidence, { recursive: true });
try {
  assert(repository, '请设置 PGR_DATA_REPOSITORY');
  await mkdir(data, { recursive: true });
  assert.equal((await readdir(data)).length, 0, '拒绝覆盖非空资料目录');
  const snapshot = await loadGuideSnapshot(repository);
  snapshot.entries = snapshot.entries.map(entry => ({ ...entry, image: '' }));
  const fixture = buildGuideFixture(snapshot.entries);
  const store = new CatalogStore(data);
  try {
    store.applySnapshot(snapshot, '攻略下拉交互验证专用固定表');
    store.saveSettings({ ...store.getSettings(), theme: 'light', fontFamily: '', checkOnStartup: false });
    guideId = store.saveGuide(fixture, null).id;
  } finally { store.close(); }
  report.source = { revision: snapshot.revision, entries: snapshot.entries.length, tables: Object.keys(snapshot.fingerprints).length };
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')), PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
  delete env.PGR_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [project], cwd: project, env, timeout: 30_000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(6000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.setSize(1340, 900); window.showInactive(); });
  await page.locator('.guide-nav').waitFor();
  const original = await page.evaluate(() => window.desktop.getState());
  const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]));

  await edit('基本信息');
  await dismissField('基本-适用副本', page.locator('.guide-basic-form .n-select').first());
  await dismissField('基本-完成状态', page.locator('.guide-form-row .n-select'));
  await edit('队伍配置');
  for (const name of ['首发机体', '队长机体', '队伍效应', '配置机体', '进化品级与阶段', '机体站位', '配置武器', '武器共鸣1', '武器共鸣2', '武器共鸣3', '武器谐振阶段', '谐振绑定意识', '配置辅助机', '辅助机品级', '辅助机主动技能', '辅助机被动技能']) {
    await dismissField(`队伍-${name}`, page.locator(`.n-select[aria-label="${name}"]`));
  }
  await edit('操作流程');
  await dismissField('流程-节点类型', page.locator('.n-select[aria-label="节点类型"]'));
  await page.locator('.flow-node-card[data-flow-type="skill"]').first().click();
  await dismissField('流程-技能操作', page.locator('.n-select[aria-label="技能操作"]'));
  await page.locator('.flow-node-card[data-flow-type="switch"]').first().click();
  await dismissField('流程-切换目标', page.locator('.n-select[aria-label="切换目标机体"]'));

  await check('机体搜索选择与选项内部滚轮', async () => {
    await edit('队伍配置');
    const select = page.locator('.n-select[aria-label="配置机体"]');
    await open(select);
    const before = await state(select);
    const rect = before.menus[0];
    await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
    await page.mouse.wheel(0, 300);
    await settle();
    const scrolled = await state(select);
    assert.equal(scrolled.menus.length, 1, '内部滚动不应关闭选项');
    assert(scrolled.menus[0].scrollTop > 0, '选项未实际滚动');
    const name = byId.get(fixture.team.members[0].characterId)!.name;
    await select.locator('input').fill(name);
    await page.locator('.n-base-select-option:visible').filter({ hasText: name }).first().click();
    await settle();
    assert.equal((await state(select)).menus.length, 0);
    assert((await select.innerText()).includes(name));
    return { before, scrolled, selected: name };
  });
  await check('多选副本选中取消搜索和标签移除', async () => {
    await edit('基本信息');
    const select = page.locator('.guide-basic-form .n-select').first();
    const name = byId.get(fixture.stageIds[0])!.name;
    await open(select);
    await select.locator('input').fill(name);
    const option = page.locator('.n-base-select-option:visible.n-base-select-option--selected').first();
    const initial = await select.locator('.n-tag:visible').count();
    await option.click();
    await settle();
    assert.equal((await state(select)).menus.length, 1, '多选点击选项应保留菜单');
    assert.equal(await select.locator('.n-tag:visible').count(), initial - 1);
    await page.locator('.n-base-select-option:visible').filter({ hasText: name }).first().click();
    await settle();
    assert.equal((await state(select)).menus.length, 1);
    assert.equal(await select.locator('.n-tag:visible').count(), initial);
    await select.locator('input').fill('');
    await select.locator('.n-tag:visible .n-base-close').first().click();
    await settle();
    assert.equal(await select.locator('.n-tag:visible').count(), initial - 1);
    assert.equal((await state(select)).menus.length, 1);
    return { initial, after: await state(select) };
  });
  await check('辅助机被动多选内部选择保留菜单', async () => {
    await edit('队伍配置');
    const select = page.locator('.n-select[aria-label="辅助机被动技能"]');
    await open(select);
    const initial = await select.locator('.n-tag:visible').count();
    const option = page.locator('.n-base-select-option:visible.n-base-select-option--selected').first();
    const name = await option.innerText();
    await option.click();
    await settle();
    assert.equal((await state(select)).menus.length, 1);
    assert.equal(await select.locator('.n-tag:visible').count(), initial - 1);
    await page.locator('.n-base-select-option:visible').filter({ hasText: name }).first().click();
    await settle();
    assert.equal((await state(select)).menus.length, 1);
    assert.equal(await select.locator('.n-tag:visible').count(), initial);
    return { initial, after: await state(select) };
  });
  await edit('队伍配置');
  for (const name of ['第1组意识套装', '第2组意识套装', '上位共鸣六次快捷', '下位共鸣六次快捷', '上位第1种共鸣', '下位第1种共鸣']) await check(`${name}-展开及公共空白收起`, async () => {
    const select = page.locator(`.n-select[aria-label="${name}"]`);
    await open(select);
    const before = await state(select);
    attached(before);
    await page.locator('.guide-editor-toolbar').click({ position: { x: 190, y: 4 } });
    await settle();
    assert.equal((await state(select)).menus.length, 0);
    return { before, after: await state(select) };
  });
  await check('切换队伍成员及流程节点清除旧菜单', async () => {
    await edit('队伍配置');
    await open(page.locator('.n-select[aria-label="首发机体"]'));
    await page.locator('.guide-team-member-tabs [data-position="red"]').click();
    await settle();
    assert.equal((await state()).menus.length, 0);
    await edit('操作流程');
    await open(page.locator('.n-select[aria-label="节点类型"]'));
    await page.locator('.flow-node-card[data-flow-type="skill"]').first().click();
    await settle();
    assert.equal((await state()).menus.length, 0);
    await open(page.locator('.n-select[aria-label="新增动作类型"]'));
    const before = await state(page.locator('.n-select[aria-label="新增动作类型"]'));
    attached(before);
    await page.locator('.guide-editor-tabs').getByRole('button', { name: '基本信息', exact: true }).click();
    await settle();
    assert.equal((await state()).menus.length, 0);
    return { before, after: await state() };
  });
  await check('父编辑区域滚动离开锚点关闭菜单', async () => {
    await edit('队伍配置');
    const select = page.locator('.n-select[aria-label="首发机体"]');
    await open(select);
    const before = await state(select);
    const box = await page.locator('.guide-editor-content').boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width - 3, box.y + 30);
    await page.mouse.wheel(0, 700);
    await settle();
    const after = await state(select);
    assert(after.editorScroll > before.editorScroll, '父区域未实际滚动');
    assert.equal(after.menus.length, 0, '锚点离开后留下菜单');
    return { before, after };
  });
  await check('切换攻略页签及侧栏无残留菜单', async () => {
    await edit('基本信息');
    await open(page.locator('.guide-basic-form .n-select').first());
    await page.locator('.guide-editor-tabs').getByRole('button', { name: '队伍配置', exact: true }).click();
    await settle();
    assert.equal((await state()).menus.length, 0);
    await open(page.locator('.n-select[aria-label="首发机体"]'));
    await page.locator('.category-nav').getByRole('button', { name: /^机体/ }).click();
    await settle();
    assert.equal((await state()).menus.length, 0);
    await page.locator('.catalog-page').waitFor();
    return state();
  });
  await check('最小窗口流程菜单定位及滚动收起', async () => {
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 680));
    await edit('操作流程');
    const select = page.locator('.n-select[aria-label="节点类型"]');
    await open(select);
    const before = await state(select);
    attached(before);
    const box = await page.locator('.guide-editor-content').boundingBox();
    assert(box);
    await page.mouse.move(box.x + box.width - 3, box.y + 30);
    await page.mouse.wheel(0, 450);
    await settle();
    const after = await state(select);
    assert(after.editorScroll !== before.editorScroll, '父区域未实际滚动');
    assert.equal(after.menus.length, 0);
    return { before, after };
  });
  await check('最小窗口基本字段整行与深色菜单收起', async () => {
    await edit('基本信息');
    const row = await page.locator('.guide-form-row').boundingBox();
    const status = await page.locator('.guide-form-row .n-select').boundingBox();
    assert(row && status && Math.abs(row.width - status.width) <= 2, '最小窗口的完成状态应占满整行');
    await page.evaluate(async () => {
      const current = await window.desktop.getState();
      await window.desktop.saveSettings({ ...current.settings, theme: 'dark' });
    });
    await edit('基本信息');
    const select = page.locator('.guide-basic-form .n-select').first();
    await open(select);
    const before = await state(select);
    attached(before);
    const field = await select.locator('..').boundingBox();
    assert(field);
    await page.mouse.click(field.x + 10, field.y + 6);
    await settle();
    assert.equal((await state(select)).menus.length, 0);
    return { row, status, before, after: await state(select) };
  });
  const after = await page.evaluate(() => window.desktop.getState());
  assert.deepEqual(after.guides, original.guides, '下拉测试未保存编辑，不应改动持久化攻略');
  assert.deepEqual(errors, []);
  report.passed = cases.every(item => item.passed);
  if (!report.passed) process.exitCode = 1;
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  process.exitCode = 1;
  await capture('执行异常').catch(() => {});
} finally {
  try { await cleanup(); } catch (error) { report.cleanupFailure = String(error); report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'guide-popovers.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, cases: cases.length, failed: cases.filter(item => !item.passed).length, evidence }));
}
