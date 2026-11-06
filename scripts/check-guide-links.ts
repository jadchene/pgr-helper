import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { guidePetSkillLabel, guideResonanceLabel } from '../src/renderer/guide-team';

const project = resolve(import.meta.dirname, '..');
const data = process.env.PGR_GUIDE_DATA ? resolve(process.env.PGR_GUIDE_DATA) : '';
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/guide-links'));
const execute = promisify(execFile);
const checks: Record<string, unknown>[] = [];
const errors: string[] = [];
const report: Record<string, unknown> = { startedAt: new Date().toISOString(), passed: false, dataDirectory: data, checks, errors, scope: '复用完整UI回归创建的隔离资料，仅验证副本关联入口与最终展示，不重新生成攻略。' };
let app: ElectronApplication | undefined;
let page!: Page;

/** 仅报告已通过的实际界面操作。 */
const passed = (name: string, details: Record<string, unknown> = {}): void => { checks.push({ name, passed: true, ...details }); console.log(`通过：${name}`); };
/** 精确定位源资料名称。 */
const exact = (value: string): RegExp => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
/** 实际可见绘制帧用于目测，不截取隐藏窗口。 */
const capture = async (name: string): Promise<void> => {
  await page.waitForTimeout(300);
  const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
};
/** 等待并关闭自己的测试实例。 */
const waitExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (result: boolean): void => { clearTimeout(timer); child.removeListener('exit', onExit); done(result); };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};
/** 无论断言是否失败，都只清理本脚本启动的进程树。 */
const cleanup = async (): Promise<void> => {
  if (!app) return;
  const child = app.process();
  void app.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (!(await waitExit(child, 3000))) {
    if (process.platform === 'win32') await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => {
      if (child.exitCode === null && child.signalCode === null) throw error;
    });
    else child.kill('SIGKILL');
    assert(await waitExit(child, 3000), '关联入口测试未退出');
  }
  report.process = { pid: child.pid, exited: true, exitCode: child.exitCode };
};

await mkdir(evidence, { recursive: true });
try {
  assert(data, '请显式设置 PGR_GUIDE_DATA，使用 check-guides 创建的隔离数据目录');
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')), PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
  delete env.PGR_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [project], cwd: project, env, timeout: 30_000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => errors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.webContents.setBackgroundThrottling(false); window.showInactive(); });
  await page.locator('.category-nav').waitFor();
  assert.equal(await page.title(), '战双助手');
  assert((await page.getByText('战双助手', { exact: true }).count()) >= 1);
  report.brand = '战双助手';
  const before = await page.evaluate(() => window.desktop.getState());
  const guide = before.guides.find(item => item.name === '桌面真实操作 · 三人多副本攻略' && item.status === 'ready' && !item.hidden);
  assert(guide && guide.stageIds.length >= 2, '此目录未包含完整UI回归创建的多副本攻略，拒绝改动未知资料');
  const byId = new Map(before.entries.map(entry => [entry.id, entry]));
  const openStage = async (id: string): Promise<void> => {
    const stage = byId.get(id);
    assert(stage?.category === 'stage');
    await page.locator('.category-nav button').filter({ has: page.locator('span', { hasText: /^副本$/ }) }).click();
    await page.locator('.catalog-page:visible').waitFor();
    await page.getByPlaceholder('搜索名称、别名或关键词').fill(stage.name);
    const target = page.locator(`.catalog-page:visible [data-entry-id="${id}"]`);
    // 同名玩法词可能命中多页，通过用户可见分页查找精确副本。
    await page.waitForTimeout(120);
    for (let index = 0; index < 30 && !(await target.count()); index += 1) {
      const next = page.locator('.pagination-bar .n-pagination-item--button').last();
      assert(await next.count() && !((await next.getAttribute('class')) || '').includes('--disabled'), `搜索结果中未找到副本 ${id}`);
      await next.click();
      await page.waitForTimeout(120);
    }
    await target.click();
    await page.locator('.detail-page:visible .detail-hero h1').filter({ hasText: exact(stage.name) }).waitFor();
  };
  for (const id of guide.stageIds.slice(0, 2)) {
    await openStage(id);
    const section = page.locator('.detail-section').filter({ has: page.getByRole('heading', { name: /^关联攻略/ }) });
    const link = section.locator('.related-list button').filter({ has: page.locator('strong', { hasText: exact(guide.name) }) });
    assert.equal(await link.count(), 1, '关联攻略应在每一个适用副本中出现一次');
    await link.click();
    await page.locator('.guides-page[data-guide-mode="detail"]').waitFor();
    assert.equal(await page.locator('.guide-detail-heading h1').innerText(), guide.name);
    assert.equal(await page.locator('.guide-member-card').count(), 3);
  }
  passed('同一攻略在两个适用副本中均有入口，点击均打开原攻略详情', { guide: guide.id, stages: guide.stageIds.slice(0, 2) });

  const first = guide.team.members[0];
  const card = page.locator(`.guide-member-card[data-member-id="${first.id}"]`);
  assert((await card.locator('.guide-memory-resonance').innerText()).includes(guideResonanceLabel(byId.get(first.memoryResonance.lower[0].resonanceId))));
  const pet = byId.get(first.pet.petId)!;
  assert((await card.locator('.guide-pet-active').innerText()).includes(guidePetSkillLabel(pet, first.pet.activeSkillId)));
  assert(!/\bLv\.?\s*\d/.test(await card.locator('.guide-pet-active').innerText()));
  assert(!/\bLv\.?\s*\d/.test(await card.locator('.guide-pet-passive').innerText()));
  await page.locator('.guide-team-overview').scrollIntoViewIfNeeded();
  await capture('最终三人配队页面');
  passed('最终配队页面显示共鸣类型和技能名称，辅助机携技不误标满级');

  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async value => {
      const state = await window.desktop.getState();
      await window.desktop.saveSettings({ ...state.settings, theme: value });
    }, theme);
    await page.reload();
    await page.locator('.guide-nav').getByRole('button', { name: /副本攻略/ }).click();
    await page.locator(`.guide-list-card[data-guide-id="${guide.id}"]`).click();
    await page.locator('.guides-page[data-guide-mode="detail"]').waitFor();
    await page.locator('.guide-team-overview').scrollIntoViewIfNeeded();
    assert.equal(await page.title(), '战双助手');
    assert.equal(await page.locator('.guide-member-card').count(), 3);
    assert.equal(await page.locator('.guide-team-overview').evaluate(element => element.scrollWidth > element.clientWidth + 1), false);
    await capture(`最终${theme}-战双助手配队页面`);
  }
  passed('更名后的最终构建显示战双助手品牌，浅深主题三人配队页均正常');

  const stageId = guide.stageIds[1];
  await openStage(stageId);
  await page.locator('.detail-page').getByRole('button', { name: '新建关联攻略', exact: true }).click();
  await page.locator('.guides-page[data-guide-mode="edit"]').waitFor();
  const tags = page.locator('.guide-basic-form > label').filter({ hasText: /^适用副本/ }).locator('.n-tag:visible');
  assert.equal(await tags.count(), 1);
  assert((await tags.innerText()).includes(byId.get(stageId)!.name));
  await page.getByPlaceholder('例如：囚笼物理队单套流程').fill('不保存的关联入口验证');
  await page.locator('.guide-editor-toolbar').getByRole('button', { name: '返回列表', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await page.getByPlaceholder('例如：囚笼物理队单套流程').inputValue(), '不保存的关联入口验证');
  assert.equal(await tags.count(), 1);
  await capture('副本预选与未保存保护');
  await page.locator('.guide-editor-toolbar').getByRole('button', { name: '返回列表', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.guides-page[data-guide-mode="list"]').waitFor();
  assert((await page.locator('.guide-filter-summary').innerText()).includes(byId.get(stageId)!.name));
  const after = await page.evaluate(() => window.desktop.getState());
  assert.deepEqual(after.guides, before.guides, '未保存的新攻略不应更改任何持久化记录');
  passed('副本新建攻略预选当前副本，返回时保护未保存修改，明确放弃后资料保持原样', { stageId });
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  if (app) await capture('关联入口验证失败').catch(failure => { report.captureFailure = String(failure); });
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { report.cleanupFailure = String(error); report.passed = false; process.exitCode = 1; }
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'guide-links.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, evidence }));
}
