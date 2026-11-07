import { _electron as electron, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { CatalogStore } from '../src/main/store';
import { buildGuideFixture, loadGuideSnapshot } from '../tests/helpers/guide-fixture';
import { teamPositionLabels, type FlowNodeType, type GuideMember, type GuideRecord } from '../src/shared/guides';
import { flattenFlowNodes, flowNodeLabels, flowSkillLabels } from '../src/shared/guide-flow';
import { guidePetSkillLabel, guideResonanceLabel, guideStageLabel } from '../src/renderer/guide-team';
import type { CatalogEntry } from '../src/shared/types';

const project = resolve(import.meta.dirname, '..');
const repository = process.env.PGR_DATA_REPOSITORY;
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/guides'));
const data = resolve(process.env.PGR_GUIDE_DATA || join(project, `test-results/guide-data-${Date.now()}`));
const execute = promisify(execFile);
const checks: Record<string, unknown>[] = [];
const rendererErrors: string[] = [];
const exited: Record<string, unknown>[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(), passed: false, dataDirectory: data, checks, rendererErrors, processes: exited,
  sourceMode: '真实固定提交源表经当前生产加载器生成，图片清空；攻略由可见界面实际点选和编辑，未用保存接口预造攻略。',
};
let app: ElectronApplication | undefined;
let page!: Page;
let sourceEntries: CatalogEntry[] = [];
let uiActions = 0;

/** 只报告已完成的可见使用场景。 */
const passed = (name: string, details: Record<string, unknown> = {}): void => {
  checks.push({ name, passed: true, ...details });
  console.log(`通过：${name}`);
};
/** 固定资料名称中的标点不参与正则解释。 */
const exact = (value: string): RegExp => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
/** 读取真实资料名称，缺失时立即停止验证。 */
const entry = (id: string): CatalogEntry => {
  const found = sourceEntries.find(item => item.id === id);
  assert(found, `测试资料引用缺失：${id}`);
  return found;
};
/** 通过公开界面选择，长列表先输入搜索，选项使用完整标签定位。 */
const choose = async (control: Locator, label: string): Promise<void> => {
  await control.scrollIntoViewIfNeeded();
  // 多选框中间可能正好是已选标签的删除按钮，点击左上内边距只打开下拉。
  await control.click({ position: { x: 5, y: 5 } });
  const input = control.locator('input').first();
  if (await input.count() && await input.isEditable()) await input.fill(label);
  const menu = page.locator('.n-base-select-menu:visible').last();
  await menu.waitFor();
  const option = menu.locator('.n-base-select-option').filter({ hasText: exact(label) }).first();
  await option.click();
  uiActions++;
  if (await menu.isVisible()) await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
};
/** 组件传入的业务标签用于稳定定位字段。 */
const select = async (label: string, value: string): Promise<void> => choose(page.locator(`.n-select[aria-label="${label}"]`), value);
/** 攻略表单内部页签。 */
const tab = async (name: string): Promise<void> => {
  await page.locator('.guide-editor-tabs').getByRole('button', { name, exact: true }).click();
  uiActions++;
};
/** 在攻略列表按记录标识打开，避免标题相同导致误选。 */
const openGuide = async (id: string): Promise<void> => {
  await page.locator('.guide-nav').getByRole('button', { name: /副本攻略/ }).click();
  await page.locator('.guides-page[data-guide-mode="list"]').waitFor();
  await page.locator(`.guide-list-card[data-guide-id="${id}"]`).click();
  await page.locator('.guides-page[data-guide-mode="detail"]').waitFor();
};
/** 编辑器与详情共享真实的持久化结果。 */
const savedGuides = async (): Promise<GuideRecord[]> => page.evaluate(async () => (await window.desktop.getState()).guides);
/** 始终从可见测试窗口捕获绘制帧。 */
const capture = async (name: string): Promise<void> => {
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.waitForTimeout(300);
  const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
};
/** 有界等待并仅清理本脚本启动的进程树。 */
const waitExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (result: boolean): void => { clearTimeout(timer); child.removeListener('exit', onExit); done(result); };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};
/** 失败也关闭测试实例，不让未保存草稿阻止清理。 */
const cleanup = async (): Promise<void> => {
  if (!app) return;
  const current = app;
  app = undefined;
  const child = current.process();
  void current.evaluate(({ app: application }) => application.exit(0)).catch(() => {});
  if (!(await waitExit(child, 3000))) {
    if (process.platform === 'win32') await execute(join(process.env.SystemRoot || 'C:\\Windows', 'System32/taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 5000 }).catch(error => {
      if (child.exitCode === null && child.signalCode === null) throw error;
    });
    else child.kill('SIGKILL');
    assert(await waitExit(child, 3000), '隔离测试进程未退出');
  }
  exited.push({ pid: child.pid, exited: true, exitCode: child.exitCode });
};
/** 启动正常沙箱的可见桌面窗口，避免隐藏窗口绘制降频。 */
const launch = async (): Promise<void> => {
  const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')), PGR_DATA_DIR: data, PGR_TEST_HIDDEN: '1' };
  delete env.PGR_DEV_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  app = await electron.launch({ args: [project], cwd: project, env, timeout: 30_000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => rendererErrors.push(error.message));
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0];
    window.webContents.setBackgroundThrottling(false);
    window.showInactive();
  });
  await page.locator('.guide-nav').waitFor();
};

/** 完整成员配置全部通过真实下拉与快捷搭配选择。 */
const configureMember = async (member: GuideMember): Promise<void> => {
  const character = entry(member.characterId);
  const weapon = entry(member.weaponId);
  const pet = entry(member.pet.petId);
  await page.locator(`.guide-team-member-tabs [data-position="${member.position}"]`).click();
  await select('配置机体', character.name);
  await select('进化品级与阶段', character.guideOptions!.evolutionStages!.find(stage => stage.id === member.evolutionId)!.label);
  await page.locator('.guide-preset-buttons').getByRole('button', { name: member.memories.map(memory => memory.count).join(' + '), exact: true }).click();
  for (const [index, memory] of member.memories.entries()) await select(`第${index + 1}组意识套装`, entry(memory.memoryId).name);
  for (const [side, label] of [['upper', '上位'], ['lower', '下位']] as const) await select(`${label}共鸣六次快捷`, guideResonanceLabel(entry(member.memoryResonance[side][0].resonanceId)));
  await select('配置武器', weapon.name);
  for (const [index, id] of member.weaponResonanceIds.entries()) await select(`武器共鸣${index + 1}`, entry(id).name);
  const harmonization = weapon.guideOptions!.harmonizationLevels!.find(level => level.level === member.harmonization.level)!;
  await select('武器谐振阶段', `${harmonization.label} · 额外意识 ${harmonization.bonusPieces} 件`);
  await select('谐振绑定意识', entry(member.harmonization.memoryId).name);
  await select('配置辅助机', pet.name);
  const quality = pet.guideOptions!.partnerQualities!.find(value => value.quality === member.pet.quality)!;
  await select('辅助机品级', `${quality.label} · ${quality.passiveSlots} 个被动槽`);
  await select('辅助机主动技能', guidePetSkillLabel(pet, member.pet.activeSkillId));
  for (const [index, id] of member.pet.passiveSkillIds.entries()) {
    await select('辅助机被动技能', guidePetSkillLabel(pet, id));
    assert.equal(await page.locator('.n-select[aria-label="辅助机被动技能"] .n-tag').count(), index + 1, '携带技能选项应逐项加入而不移除已选项');
  }
  await page.locator('.n-input[aria-label="成员配置备注"] textarea').fill(member.notes);
  uiActions++;
};

/** 在主流程新增一种节点，保留编辑器默认短按供断言。 */
const addMainNode = async (type: FlowNodeType): Promise<string> => {
  await page.locator('.flow-editor-toolbar').getByRole('button', { name: '添加主流程节点', exact: true }).click();
  if (type !== 'attack') await select('节点类型', flowNodeLabels[type]);
  const id = await page.locator('.flow-node-form').getAttribute('data-selected-flow-node');
  assert(id);
  uiActions++;
  return id;
};
/** QTE 每次点击代表一次独立触发，重复点击不得去重。 */
const qte = async (names: string[]): Promise<void> => {
  for (const name of names) {
    await page.locator('.flow-qte-add').getByRole('button', { name, exact: true }).click();
    uiActions++;
  }
};

await mkdir(evidence, { recursive: true });
try {
  assert(repository, '请设置 PGR_DATA_REPOSITORY，使用固定真实源表审计仓库');
  await mkdir(data, { recursive: true });
  assert.equal((await readdir(data)).length, 0, '只允许使用全新的隔离数据目录');
  const snapshot = await loadGuideSnapshot(repository);
  snapshot.entries = snapshot.entries.map(item => ({ ...item, image: '' }));
  sourceEntries = snapshot.entries;
  const fixture = buildGuideFixture(sourceEntries);
  fixture.name = '桌面真实操作 · 三人多副本攻略';
  await writeFile(join(evidence, 'fixture-guide.json'), JSON.stringify(fixture, null, 2));
  const store = new CatalogStore(data);
  try {
    store.applySnapshot(snapshot, '攻略桌面测试固定源表（清空图片）');
    store.saveSettings({ ...store.getSettings(), theme: 'light', fontFamily: '', checkOnStartup: false });
    assert.equal(store.listGuides().length, 0);
  } finally { store.close(); }
  report.source = { revision: snapshot.revision, entries: snapshot.entries.length, tables: Object.keys(snapshot.fingerprints).length };
  await launch();
  await page.locator('.guide-nav').getByRole('button', { name: /副本攻略/ }).click();
  await page.locator('.guide-page-header').getByRole('button', { name: '新建攻略', exact: true }).click();
  await page.getByPlaceholder('例如：囚笼物理队操作流程').fill(fixture.name);
  const stagesControl = page.locator('.n-select[aria-label="适用副本"]');
  for (const id of fixture.stageIds) {
    const stage = entry(id);
    await choose(stagesControl, guideStageLabel(stage, sourceEntries));
  }
  await page.getByLabel('攻略记录时间', { exact: true }).fill(fixture.recordedAt);
  await page.locator('.guide-form-row label').filter({ hasText: '预计战斗时长' }).locator('input').fill(String(fixture.durationSeconds));
  await page.getByPlaceholder('适用条件、注意事项、成绩或调整建议').fill(fixture.notes);
  await page.getByRole('button', { name: '添加视频网址', exact: true }).click();
  await page.locator('.n-input[aria-label="参考视频网址1"] input').fill(fixture.videoUrls[0]);
  await tab('队伍配置');
  for (const member of fixture.team.members) await configureMember(member);
  const roleName = (position: GuideMember['position']): string => {
    const member = fixture.team.members.find(value => value.position === position)!;
    return `${teamPositionLabels[position]} · ${entry(member.characterId).name}`;
  };
  await select('首发机体', roleName('blue'));
  await select('队长机体', roleName('red'));
  for (const id of fixture.team.effectIds) await select('队伍效应', entry(id).name);
  passed('从空攻略实际填写多个副本、时间备注视频和三名成员的全部装备配置', { members: fixture.team.members.map(member => member.characterId), uiActions });

  await tab('操作流程');
  const holdId = await addMainNode('attack');
  assert.equal(await page.getByRole('button', { name: '短按', exact: true }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: '长按', exact: true }).click();
  await page.locator('.flow-node-form .n-input-number input').fill('3');
  await page.locator('.flow-node-notes-input textarea').fill('长按普攻时，同时拉多个后台机体 QTE。');
  await page.getByRole('button', { name: '添加分支', exact: true }).click();
  assert.equal(await page.locator('.flow-qte-add').getByRole('button', { name: roleName('blue'), exact: true }).count(), 0, '首发机体不应出现在QTE选择中');
  await qte([roleName('red'), roleName('yellow'), roleName('red')]);
  assert.equal(await page.locator('.flow-qte-sequence li').count(), 3);
  await page.getByRole('button', { name: '返回父节点设置', exact: true }).click();
  await page.getByRole('button', { name: '添加分支', exact: true }).click();
  await qte([roleName('yellow'), roleName('yellow')]);
  assert.equal(await page.locator('.flow-qte-sequence li').count(), 2);
  for (const [index, skill] of (['red', 'yellow', 'blue', 'special', 'ultimate'] as const).entries()) {
    await addMainNode('skill');
    assert.equal(await page.getByRole('button', { name: '短按', exact: true }).getAttribute('aria-pressed'), 'true');
    await select('技能操作', flowSkillLabels[skill]);
    if (index % 2) await page.getByRole('button', { name: '长按', exact: true }).click();
  }
  await addMainNode('dodge');
  await addMainNode('dodge');
  await page.getByRole('button', { name: '长按', exact: true }).click();
  await addMainNode('switch');
  await select('切换目标机体', roleName('red'));
  await addMainNode('qte');
  assert.equal(await page.locator('.flow-qte-add').getByRole('button', { name: roleName('red'), exact: true }).count(), 0, '切换后的在场角色不应出现在QTE选择中');
  await qte([roleName('blue'), roleName('yellow'), roleName('blue')]);
  await addMainNode('switch');
  await select('切换目标机体', roleName('yellow'));
  await addMainNode('attack');
  await addMainNode('switch');
  await select('切换目标机体', roleName('blue'));
  await select('循环入口', '第 1 步 · 普攻');
  assert.equal(await page.locator('.flow-return-edge').count(), 1);
  assert.equal(await page.locator('.flow-validation').count(), 0);
  await page.locator(`[data-flow-id="${holdId}"]`).click();
  await capture('01-循环与并行QTE编辑');
  passed('真实操作建立全部节点类型、长短按、重复多角色QTE、两个并行分支及循环回边', { uiActions });

  await tab('基本信息');
  await choose(page.locator('.n-select[aria-label="完成状态"]'), '已完成');
  await page.locator('.guide-editor-toolbar').getByRole('button', { name: '保存攻略', exact: true }).click();
  await page.locator('.guides-page[data-guide-mode="detail"]').waitFor();
  let saved = (await savedGuides()).find(guide => guide.name === fixture.name)!;
  assert(saved);
  assert.equal(saved.status, 'ready');
  assert.deepEqual(saved.stageIds, fixture.stageIds);
  assert.equal(saved.recordedAt, fixture.recordedAt);
  assert.equal(saved.durationSeconds, fixture.durationSeconds);
  assert.deepEqual(saved.videoUrls, fixture.videoUrls);
  for (const expected of fixture.team.members) {
    const actual = saved.team.members.find(member => member.position === expected.position)!;
    const { id: _actualId, ...actualFields } = actual;
    const { id: _expectedId, ...expectedFields } = expected;
    assert.deepEqual(actualFields, expectedFields, `${expected.position}配置没有完整保存`);
  }
  assert.equal(saved.team.members.find(member => member.id === saved.team.starterMemberId)?.position, 'blue');
  assert.equal(saved.team.members.find(member => member.id === saved.team.captainMemberId)?.position, 'red');
  assert.deepEqual(saved.team.effectIds, fixture.team.effectIds);
  assert.equal(saved.flow.mode, 'loop');
  assert.equal(saved.flow.nodes[0].branches.length, 2);
  const mapPosition = (id: string): string | undefined => saved.team.members.find(member => member.id === id)?.position;
  assert.deepEqual(saved.flow.nodes[0].branches[0][0].qteMemberIds.map(mapPosition), ['red', 'yellow', 'red']);
  assert.deepEqual(saved.flow.nodes[0].branches[1][0].qteMemberIds.map(mapPosition), ['yellow', 'yellow']);
  assert.deepEqual(saved.flow.nodes.filter(node => node.type === 'skill').map(node => node.skill), ['red', 'yellow', 'blue', 'special', 'ultimate']);
  await writeFile(join(evidence, 'saved-guide.json'), JSON.stringify(saved, null, 2));
  assert.equal(await page.locator('.guide-member-card').count(), 3);
  assert.equal(await page.locator('.guide-memory-resonance').count(), 3);
  assert((await page.locator('.guide-evolution').allTextContents()).includes('SSS3'));
  assert((await page.locator('.guide-memory-resonance').allTextContents()).every(text => text.includes('上位') && text.includes('下位') && text.includes('6')));
  await page.locator('.guide-team-overview').scrollIntoViewIfNeeded();
  await capture('02-三人配队一图流');
  passed('一图流显示三色站位、SSS3、首发队长、意识上下位六共鸣、武器谐振和辅助机携技', { guideId: saved.id, nodes: flattenFlowNodes(saved.flow).length });

  await app!.evaluate(({ shell }) => {
    const state = globalThis as unknown as { guideTestLinks: string[] };
    state.guideTestLinks = [];
    shell.openExternal = async (url: string) => { state.guideTestLinks.push(url); };
  });
  await page.locator('.guide-video-link').first().click();
  const links = await app!.evaluate(() => (globalThis as unknown as { guideTestLinks: string[] }).guideTestLinks);
  assert.deepEqual(links, fixture.videoUrls);
  passed('参考视频点击通过真实桌面桥接到系统浏览器调用（测试拦截外部打开）');

  await page.locator('.guide-detail-toolbar').getByRole('button', { name: '编辑攻略', exact: true }).click();
  await page.getByPlaceholder('适用条件、注意事项、成绩或调整建议').fill('尚未保存的修改');
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '继续编辑', exact: true }).click();
  assert.equal(await page.getByPlaceholder('适用条件、注意事项、成绩或调整建议').inputValue(), '尚未保存的修改');
  await page.locator('.guide-editor-toolbar').getByRole('button', { name: '返回攻略', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '放弃修改', exact: true }).click();
  await page.locator('.guides-page[data-guide-mode="detail"]').waitFor();
  assert.equal((await savedGuides()).find(guide => guide.id === saved.id)!.notes, fixture.notes);
  passed('跨侧栏和返回详情均保护未保存攻略，取消离开保留草稿，放弃后原记录不变');

  await page.locator('.guide-detail-toolbar').getByRole('button', { name: '复制攻略', exact: true }).click();
  const copyName = `${fixture.name} · 单套副本`;
  await page.getByPlaceholder('例如：囚笼物理队操作流程').fill(copyName);
  await tab('操作流程');
  await page.locator('.n-select[aria-label="循环入口"] .n-base-clear').click();
  assert.equal(await page.locator('.flow-return-edge').count(), 0);
  await page.locator('.guide-editor-toolbar').getByRole('button', { name: '保存攻略', exact: true }).click();
  await page.locator('.guides-page[data-guide-mode="detail"]').waitFor();
  const copied = (await savedGuides()).find(guide => guide.name === copyName)!;
  assert(copied && copied.id !== saved.id);
  assert.deepEqual(copied.team, saved.team);
  assert.equal(copied.flow.mode, 'single');
  assert.deepEqual(copied.flow.nodes, saved.flow.nodes);
  await page.locator('.guide-detail-toolbar').getByRole('button', { name: '编辑攻略', exact: true }).click();
  await page.locator('.guide-editor-toolbar').getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.locator('.n-dialog').getByRole('button', { name: '移至回收站', exact: true }).click();
  await page.locator('.guides-page[data-guide-mode="list"]').waitFor();
  assert.equal((await savedGuides()).find(guide => guide.id === copied.id)!.hidden, true);
  await page.getByRole('button', { name: '攻略回收站', exact: true }).click();
  await page.locator(`.guide-list-card[data-guide-id="${copied.id}"]`).click();
  await page.getByRole('button', { name: '恢复攻略', exact: true }).click();
  assert.equal((await savedGuides()).find(guide => guide.id === copied.id)!.hidden, false);
  await page.getByRole('button', { name: '我的攻略', exact: true }).click();
  passed('复制攻略保持独立记录，清除循环入口后执行一次；回收与恢复保留全部队伍及流程');

  await openGuide(saved.id);
  for (const theme of ['light', 'dark'] as const) {
    await page.evaluate(async value => {
      const current = await window.desktop.getState();
      await window.desktop.saveSettings({ ...current.settings, theme: value });
    }, theme);
    await page.reload();
    await page.locator('.guide-nav').waitFor();
    await openGuide(saved.id);
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 680));
    await page.locator('.guide-team-overview').scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => ({
      width: innerWidth, pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth,
      boxes: ['.guides-page', '.guide-page-scroll', '.guide-team-overview', '.guide-overview-grid'].map(selector => {
        const element = document.querySelector<HTMLElement>(selector)!;
        return { selector, width: element.clientWidth, scrollWidth: element.scrollWidth };
      }),
    }));
    assert(Math.abs(geometry.width - 1000) <= 3, 'Windows缩放后的最小窗口宽度超出允许的舍入误差');
    assert(geometry.pageScrollWidth <= geometry.pageWidth + 1);
    geometry.boxes.forEach(box => assert(box.scrollWidth <= box.width + 1, `${box.selector}最小窗口横向溢出`));
    await capture(`03-${theme}-最小窗口一图流`);
    await page.locator('.guide-detail-toolbar').getByRole('button', { name: '编辑攻略', exact: true }).click();
    await tab('操作流程');
    const editorBounds = await page.locator('.flow-editor-layout').evaluate(element => ({ width: element.clientWidth, scrollWidth: element.scrollWidth }));
    assert(editorBounds.scrollWidth <= editorBounds.width + 1, '流程编辑器横向溢出，画布应只在自己的容器滚动');
    await capture(`04-${theme}-最小窗口流程编辑`);
    await page.locator('.guide-editor-toolbar').getByRole('button', { name: '返回攻略', exact: true }).click();
  }
  passed('1000×680浅色与深色一图流、流程画布及编辑器均可用，页面无横向溢出');

  const beforeRestart = await savedGuides();
  await cleanup();
  await launch();
  assert.deepEqual(await savedGuides(), beforeRestart);
  await openGuide(saved.id);
  saved = (await savedGuides()).find(guide => guide.id === saved.id)!;
  assert.equal(await page.locator('.guide-member-card').count(), 3);
  assert.equal(await page.locator('.flow-return-edge').count(), 1);
  await capture('05-重启后攻略完整保留');
  passed('退出并重启后全部攻略、修订、装备配置、并行节点和重复QTE完整持久化', { guides: beforeRestart.length });
  assert.deepEqual(rendererErrors, []);
  report.uiActions = uiActions;
  report.guideId = saved.id;
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  if (app) await capture('攻略验证失败').catch(failure => { report.captureFailure = String(failure); });
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { report.cleanupFailure = String(error); report.passed = false; process.exitCode = 1; }
  report.uiActions = uiActions;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'guides.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, uiActions, evidence }));
}
