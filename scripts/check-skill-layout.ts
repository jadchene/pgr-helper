import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import assert from 'node:assert/strict';
import { execFile, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { defaultSourceProfile } from '../src/main/schemas';
import { CatalogStore } from '../src/main/store';
import { loadCatalogSnapshot, myssalTablePaths } from '../src/main/sources';
import { categoryLabels, type CatalogEntry, type EntrySection, type SkillSectionMetadata } from '../src/shared/types';
import { readMyssalHttpFixture } from '../tests/helpers/myssal-http-fixture';

const project = resolve(import.meta.dirname, '..');
const evidence = resolve(process.env.PGR_EVIDENCE_DIR || join(project, 'test-results/skill-layout'));
const data = resolve(process.env.PGR_SKILL_DATA || join(project, `test-results/skill-layout-data-${Date.now()}`));
const repository = process.env.PGR_DATA_REPOSITORY;
const execute = promisify(execFile);
const checks: Record<string, unknown>[] = [];
const rendererErrors: string[] = [];
const report: Record<string, unknown> = {
  startedAt: new Date().toISOString(), passed: false, dataDirectory: data, checks, rendererErrors,
  sourceMode: '固定真实 Git 表经 HTTP fixture 和当前生产规范化器生成快照；图片清空。本次验证技能布局，不验证真实网络同步。',
};
let app: ElectronApplication | undefined;
let page: Page;
let checkedBodies = 0;

/** 控制台只报告已完成的场景，逐段校验数量写入证据。 */
const passed = (name: string, details: Record<string, unknown> = {}): void => {
  checks.push({ name, passed: true, ...details });
  console.log(`通过：${name}`);
};

/** 使用真实技能元信息，普通说明段落不伪造技能分类。 */
const skills = (entry: CatalogEntry): (EntrySection & { skill: SkillSectionMetadata })[] => entry.sections.filter((section): section is EntrySection & { skill: SkillSectionMetadata } => !!section.skill);

/** 精确匹配中文标题，避免来源标点改变正则含义。 */
const exact = (value: string): RegExp => new RegExp(`^${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/** 通过可见列表进入详情，已有页面必须在侧栏导航时卸载。 */
const openEntry = async (entry: CatalogEntry): Promise<void> => {
  await page.locator('.category-nav button').filter({ has: page.locator('span', { hasText: exact(categoryLabels[entry.category]) }) }).click();
  await page.locator('.catalog-page:visible').waitFor();
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.skill-book').count(), 0, '离开详情后技能页面仍残留');
  await page.locator('.catalog-page:visible .catalog-search input').fill(entry.name);
  await page.locator(`.catalog-page:visible [data-entry-id="${entry.id}"] h2`).click();
  await page.locator('.detail-page:visible .detail-hero h1').filter({ hasText: exact(entry.name) }).waitFor();
  await page.locator('.skill-book:visible').waitFor();
  assert.equal(await page.locator('.skill-book').count(), 1, '同时存在多个技能页面');
};

/** 按稳定源标识选择技能，完整文本逐字比较，不能只检验标题或长度。 */
const showSection = async (section: EntrySection & { skill: SkillSectionMetadata }): Promise<void> => {
  const metadata = section.skill;
  await page.locator(`.skill-group-tabs [data-skill-group="${metadata.groupId}"]`).click();
  await page.locator(`.skill-family-list [data-skill-family="${metadata.familyId}"]`).click();
  const variant = page.locator(`.skill-variants [data-skill-id="${metadata.id}"]`);
  if (await variant.count()) await variant.click();
  const content = page.locator(`.skill-content:visible[data-skill-id="${metadata.id}"]`);
  await content.waitFor();
  assert.equal(await page.locator('.skill-content:visible').count(), 1, '一个技能位置只能展示一个变体正文');
  assert.equal(await content.locator('.skill-body.rich-text').textContent(), section.body || '暂无内容', `技能 ${metadata.id} 正文被截断、合并或替换`);
  if (metadata.element && await variant.count()) assert.equal((await variant.innerText()).trim(), metadata.element.name, `技能 ${metadata.id} 属性标签未按来源映射`);
  checkedBodies++;
};

/** 遍历样本的全部分组、技能族和变体，证明同名源记录没有被去重。 */
const checkSkillBook = async (entry: CatalogEntry): Promise<void> => {
  const sections = skills(entry);
  assert(sections.length, `${entry.id} 缺少技能元信息`);
  const groups = [...new Map(sections.map(section => [section.skill.groupId, section.skill])).values()].sort((a, b) => a.groupOrder - b.groupOrder);
  const renderedGroups = await page.locator('.skill-group-tabs [data-skill-group]').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.skillGroup));
  assert.deepEqual(renderedGroups, groups.map(group => group.groupId), `${entry.id} 大类缺失或顺序错误`);
  for (const group of groups) {
    const groupButton = page.locator(`.skill-group-tabs [data-skill-group="${group.groupId}"]`);
    assert((await groupButton.innerText()).includes(group.groupName), '大类名称应来自元信息');
    await groupButton.click();
    const sectionsInGroup = sections.filter(section => section.skill.groupId === group.groupId);
    const families = [...new Set(sectionsInGroup.map(section => section.skill.familyId))];
    const renderedFamilies = await page.locator('.skill-family-list [data-skill-family]').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.skillFamily));
    assert.deepEqual(renderedFamilies, families, `${entry.id}/${group.groupId} 源技能族被合并或丢失`);
    for (const familyId of families) {
      await page.locator(`.skill-family-list [data-skill-family="${familyId}"]`).click();
      const variants = sectionsInGroup.filter(section => section.skill.familyId === familyId);
      if (variants.length > 1) {
        const renderedVariants = await page.locator('.skill-variants [data-skill-id]').evaluateAll(buttons => buttons.map(button => (button as HTMLElement).dataset.skillId));
        assert.deepEqual(renderedVariants, variants.map(section => section.skill.id), `${entry.id}/${familyId} 变体被去重或重排`);
      }
      for (const variant of variants) await showSection(variant);
    }
  }
};

/** 返回时必须看到原列表，DOM中隐藏的保留列表不算成功。 */
const backToList = async (search: string): Promise<void> => {
  await page.locator('.detail-page').getByRole('button', { name: '返回列表', exact: true }).click();
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  await page.locator('.catalog-page:visible').waitFor();
  assert.equal(await page.locator('.skill-book').count(), 0, '返回后技能内容仍然挂载');
  assert.equal(await page.locator('.catalog-page:visible .catalog-search input').inputValue(), search, '返回后原搜索条件改变');
};

/** 展示测试窗口但不抢焦点，等待新帧后从Electron捕获，避免隐藏窗口旧截图。 */
const capture = async (name: string): Promise<void> => {
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].showInactive());
  await page.waitForTimeout(300);
  const png = await app!.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(join(evidence, `${name}.png`), Buffer.from(png, 'base64'));
};

/** 有界等待进程退出，失败兜底只针对本脚本启动的实例。 */
const waitExit = (child: ChildProcess, milliseconds: number): Promise<boolean> => {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(done => {
    const finish = (result: boolean): void => { clearTimeout(timer); child.removeListener('exit', onExit); done(result); };
    const onExit = (): void => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once('exit', onExit);
  });
};

/** 无论断言或截图是否失败，都关闭隔离实例并等待退出。 */
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
  assert(repository, '请设置 PGR_DATA_REPOSITORY，指向含固定审计提交的 Myssal 本地测试仓库');
  await mkdir(data, { recursive: true });
  assert.equal((await readdir(data)).length, 0, '只允许使用空测试目录，拒绝覆盖已有资料');
  const fixture = await readMyssalHttpFixture(repository);
  const originalFetch = globalThis.fetch;
  let snapshot;
  try {
    globalThis.fetch = fixture.fetch;
    snapshot = await loadCatalogSnapshot(defaultSourceProfile, new AbortController().signal, () => {}, { cacheDirectory: join(data, 'source-cache') });
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(snapshot.revision, '170abcceee1fdbdee00a8770830ef80680a6ceca');
  assert.equal(snapshot.entries.length, 1799, '本回归要求固定真实版本的完整1799条资料');
  assert.equal(Object.keys(snapshot.fingerprints).length, myssalTablePaths.length);
  snapshot.entries = snapshot.entries.map(entry => ({ ...entry, image: '' }));
  const snapshotPath = join(data, 'snapshot.json');
  await writeFile(snapshotPath, JSON.stringify(snapshot, null, 2));
  report.snapshotPath = snapshotPath;
  const store = new CatalogStore(data);
  try {
    store.applySnapshot(snapshot, '技能源分组桌面测试固定快照（图片清空）');
    store.saveSettings({ ...store.getSettings(), theme: 'light', fontFamily: '', viewMode: 'grid', checkOnStartup: false });
  } finally { store.close(); }
  report.source = { repository, revision: snapshot.revision, version: snapshot.version, total: snapshot.entries.length, tables: Object.keys(snapshot.fingerprints).length };
  const byId = new Map(snapshot.entries.map(entry => [entry.id, entry]));
  const character = byId.get('character:1011002')!;
  const frost = byId.get('pet:16040000')!;
  const bird = byId.get('pet:16080000')!;
  assert(character && frost && bird, '真实机体或辅助机样本缺失');
  const uniframe = snapshot.entries.find(entry => entry.category === 'character' && entry.catalog?.facets.frameType?.includes('独域机体') && skills(entry).some(section => section.skill.groupName === '独域技能'));
  assert(uniframe, '固定源中缺少带独域技能的独域机体样本');
  const duplicateCharacter = snapshot.entries.find(entry => entry.category === 'character' && skills(entry).some((section, index, all) => all.some((other, otherIndex) => otherIndex !== index && other.title === section.title && other.skill.id !== section.skill.id)));
  assert(duplicateCharacter, '固定源中未找到同名不同ID技能样本，不能声称已覆盖');
  const duplicateTitle = skills(duplicateCharacter).find((section, index, all) => all.some((other, otherIndex) => otherIndex !== index && other.title === section.title && other.skill.id !== section.skill.id))!.title;
  const duplicatePair = skills(duplicateCharacter).filter(section => section.title === duplicateTitle).slice(0, 2);
  assert.notEqual(duplicatePair[0].skill.id, duplicatePair[1].skill.id);
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
    // 隐藏窗口仍可能降频绘制，整个交互回归保持可见但不抢焦点。
    window.showInactive();
  });
  await page.locator('.catalog-page:visible .entry-card').first().waitFor();
  report.launchArguments = [project];

  for (const sample of [...new Map([character, duplicateCharacter].map(entry => [entry.id, entry])).values()]) {
    await openEntry(sample);
    await checkSkillBook(sample);
  }
  await capture('01-机体技能分组');
  passed('真实机体全部分类与技能正文，同名不同ID保持独立', { samples: [...new Set([character.id, duplicateCharacter.id])], duplicate: duplicatePair.map(section => ({ title: section.title, id: section.skill.id })) });

  await openEntry(uniframe);
  const uniframeSkills = skills(uniframe).filter(section => section.skill.groupName === '独域技能');
  assert(uniframeSkills.length);
  assert(uniframeSkills.every(section => section.skill.groupId === 'character-gate:5' && section.skill.groupName !== '跃升技能'));
  const uniframeTab = page.locator('.skill-group-tabs [data-skill-group="character-gate:5"]');
  assert((await uniframeTab.innerText()).includes('独域技能'));
  assert(!(await uniframeTab.innerText()).includes('跃升技能'));
  for (const section of uniframeSkills) await showSection(section);
  await capture('01B-独域技能分类');
  passed('独域机体使用真实独域技能分类，不误放入跃升页签', { entry: uniframe.id, name: uniframe.name, skills: uniframeSkills.map(section => section.skill.id) });

  await openEntry(frost);
  const frostSkills = skills(frost);
  const active = frostSkills.filter(section => section.skill.kind === 'pet-active');
  const passive = frostSkills.filter(section => section.skill.kind === 'pet-passive');
  assert.equal(new Set(active.map(section => section.skill.familyId)).size, 2);
  assert.equal(active.length, 12);
  assert.equal(passive.length, 5);
  await checkSkillBook(frost);
  const physical = active.find(section => section.skill.id === '1071')!;
  const ice = active.find(section => section.skill.id === '1073')!;
  assert(physical.body.includes('持续8秒') && ice.body.includes('持续4秒'));
  await showSection(physical);
  await capture('02-霜誓物理属性8秒');
  await showSection(ice);
  await capture('03-霜誓冰属性4秒');
  passed('辅助机2个源主动组各6属性切换，5个被动独立且每次正文完整匹配', { entry: frost.id, activeGroups: 2, activeVariants: 12, passive: 5 });

  await openEntry(bird);
  const birdPhysical = skills(bird).find(section => section.skill.id === '1151')!;
  const birdIce = skills(bird).find(section => section.skill.id === '1153')!;
  assert(birdPhysical.body.includes('1500%物理伤害'));
  assert(birdIce.body.includes('750%冰属性伤害') && birdIce.body.includes('额外伤害加成提高3%'));
  await showSection(birdPhysical);
  await showSection(birdIce);
  passed('切换辅助机页面无旧技能残留，属性变体倍率和特殊机制均保留', { entry: bird.id });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 680));
  await openEntry(character);
  const longest = skills(character).reduce((current, section) => section.body.length > current.body.length ? section : current);
  await showSection(longest);
  await page.locator('.skill-book').scrollIntoViewIfNeeded();
  const geometry = await page.evaluate(() => {
    const selectors = ['.detail-page', '.detail-scroll', '.detail-toolbar', '.skill-book', '.skill-family-list', '.skill-content'];
    const boxes = selectors.map(selector => {
      const element = document.querySelector<HTMLElement>(selector)!;
      const rect = element.getBoundingClientRect();
      return { selector, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, left: rect.left, right: rect.right };
    });
    const back = document.querySelector('.detail-back')!.getBoundingClientRect();
    return { width: innerWidth, height: innerHeight, pageWidth: document.documentElement.clientWidth, pageScrollWidth: document.documentElement.scrollWidth, boxes, back: { left: back.left, right: back.right, top: back.top, bottom: back.bottom } };
  });
  assert(Math.abs(geometry.width - 1000) <= 3 && Math.abs(geometry.height - 680) <= 3);
  assert(geometry.pageScrollWidth <= geometry.pageWidth + 1, '最小窗口页面横向溢出');
  for (const box of geometry.boxes) assert(box.scrollWidth <= box.clientWidth + 1 && box.left >= 0 && box.right <= geometry.width + 1, `${box.selector} 在最小窗口横向溢出`);
  assert(geometry.back.top >= 0 && geometry.back.bottom <= geometry.height && geometry.back.left >= 0 && geometry.back.right <= geometry.width, '最小窗口返回按钮被裁切');
  await capture('04-最小窗口机体技能');
  await openEntry(frost);
  await showSection(ice);
  assert(await page.locator('.skill-variants').evaluate(element => element.scrollWidth <= element.clientWidth + 1), '最小窗口属性控件横向溢出');
  await capture('05-最小窗口辅助机属性');
  passed('1000×680机体长正文、辅助机属性切换与返回按钮无横向溢出', { geometry });

  await page.locator('.utility-nav').getByRole('button', { name: '设置', exact: true }).click();
  await page.locator('.detail-page').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.skill-book').count(), 0, '切换到设置后技能页面仍残留');
  await page.getByRole('button', { name: '深色', exact: true }).click();
  await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await openEntry(frost);
  await showSection(physical);
  await page.locator('.skill-book').scrollIntoViewIfNeeded();
  const darkGeometry = await page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    pageWidth: document.documentElement.clientWidth,
    pageScrollWidth: document.documentElement.scrollWidth,
    boxes: ['.skill-book', '.skill-family-list', '.skill-content', '.skill-variants'].map(selector => {
      const element = document.querySelector<HTMLElement>(selector)!;
      return { selector, width: element.clientWidth, scrollWidth: element.scrollWidth, color: getComputedStyle(element).color, background: getComputedStyle(element).backgroundColor };
    }),
  }));
  assert.equal(darkGeometry.theme, 'dark');
  assert(darkGeometry.pageScrollWidth <= darkGeometry.pageWidth + 1);
  for (const box of darkGeometry.boxes) assert(box.width > 0 && box.scrollWidth <= box.width + 1, `${box.selector} 深色窄窗口不可见或横向溢出`);
  assert(await page.locator('.skill-content .skill-body').isVisible());
  await capture('06-最小窗口深色辅助机技能');
  passed('深色主题技能区域和属性控件可见，1000×680无横向溢出', { geometry: darkGeometry });

  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1340, 900));
  await openEntry(frost);
  await showSection(ice);
  await page.locator('.detail-page').getByRole('button', { name: '编辑资料', exact: true }).click();
  const changedName = `${frost.name}·技能布局验证`;
  await page.getByPlaceholder('例如：露西亚·深红囚影').fill(changedName);
  await page.locator('.editor-modal').getByRole('button', { name: '保存资料', exact: true }).click();
  await page.locator('.editor-modal').waitFor({ state: 'hidden' });
  await page.locator('.detail-page .detail-hero h1').filter({ hasText: exact(changedName) }).waitFor();
  const saved = await page.evaluate(async id => (await window.desktop.getState()).entries.find(entry => entry.id === id), frost.id);
  assert(saved);
  assert.equal(saved.name, changedName);
  assert.equal(saved.modified, true);
  assert.deepEqual(saved.sections, frost.sections, '仅改名称后技能正文或元信息改变');
  await showSection(ice);
  await backToList(frost.name);
  await page.locator(`.catalog-page:visible [data-entry-id="${frost.id}"] h2`).click();
  await page.locator('.detail-page .detail-hero h1').filter({ hasText: exact(changedName) }).waitFor();
  await checkSkillBook(saved);
  await backToList(frost.name);
  passed('真实编辑名称后全部技能元信息保留，返回原列表后可重新进入和切换');

  assert.deepEqual(rendererErrors, []);
  report.checkedBodies = checkedBodies;
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? error.stack : String(error);
  if (app) await capture('技能布局验证失败').catch(failure => { report.captureFailure = String(failure); });
  process.exitCode = 1;
} finally {
  try { await cleanup(); } catch (error) { report.cleanupFailure = String(error); report.passed = false; process.exitCode = 1; }
  report.checkedBodies = checkedBodies;
  report.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'skill-layout.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, checks: checks.length, checkedBodies, evidence }));
}
