import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')), PGR_TEST_HIDDEN: '1' };
delete env.PGR_DATA_DIR; delete env.PGR_DEV_URL; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [root], cwd: root, env });
const checks: string[] = [];
try {
 const page = await app.firstWindow(); page.setDefaultTimeout(12000);
 const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
 await app.evaluate(({ BrowserWindow }) => { const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.showInactive(); win.unmaximize(); win.setSize(1000, 680); });
 await page.locator('.preset-nav').waitFor();
 const before = await page.evaluate(() => window.desktop.getState());
 assert.equal(resolve(before.dataDirectory), resolve(root, 'data'));
 /** 等待准确选项，避免把退出动画中的旧菜单当作当前菜单。 */
 const choose = async (label: string, text: string): Promise<void> => {
  await page.getByLabel(label, { exact: true }).first().click();
  await page.keyboard.press('Control+A'); await page.keyboard.insertText(text);
  await page.locator('.n-base-select-menu:visible').getByText(text, { exact: true }).last().click();
  await expect(page.locator('.n-base-select-menu:visible')).toHaveCount(0);
 };
 await page.locator('.preset-nav button').click();
 const unsaved = before.entries.find(e => e.category === 'character' && !before.presets.some(p => p.kind === 'character' && p.characterId === e.id));
 assert(unsaved);
 await page.locator('[data-character-id="' + unsaved.id + '"]').click();
 await expect(page.locator('.preset-overview')).toBeVisible();
 await page.getByRole('button', { name: '返回机体列表', exact: true }).click();
 checks.push('未配置机体仍展示总览，不写入预设');
 await page.getByRole('tab', { name: '通用预设', exact: true }).click();
 const memory = before.presets.find(p => p.kind === 'memory' && !p.hidden);
 assert(memory?.kind === 'memory');
 const entry = before.entries.find(e => e.id === memory.memory.memories[0].memoryId)!;
 await choose('包含意识筛选', entry.name);
 await expect(page.getByLabel('辅助机筛选', { exact: true })).toHaveCount(0);
 await choose('预设类型筛选', '辅助机预设');
 await expect(page.getByLabel('包含意识筛选', { exact: true })).toHaveCount(0);
 assert(await page.locator('[data-preset-kind="pet"] .preset-inline-config').count() > 0);
 await page.getByRole('button', { name: '清空筛选', exact: true }).click();
 checks.push('通用预设类型切换清理互斥条件，辅助机结果正常');
 await page.locator('.guide-nav button').click();
 const guide = before.guides.find(g => !g.hidden && g.team.members.length === 3)!; assert(guide);
 await page.locator('[data-guide-id="' + guide.id + '"]').click();
 await page.getByRole('button', { name: '编辑攻略', exact: true }).click();
 await page.getByRole('button', { name: '队伍配置', exact: true }).click();
 for (const [label, section] of [['武器与共鸣', 'weapon'], ['辅助机', 'pet'], ['机体培养', 'character']]) {
  await page.locator('.guide-config-jump').getByRole('button', { name: label, exact: true }).click();
  await expect.poll(async () => {
   const box = await page.locator('[data-config-section="' + section + '"]').boundingBox();
   return !!box && box.y >= 0 && box.y < 600;
  }).toBe(true);
 }
 checks.push('窄窗口配装分区跳转可用');
 const activeId = await page.locator('.guide-team-member-tabs .active').getAttribute('data-team-member');
 const duplicate = before.presets.find(p => p.kind === 'character' && !p.hidden && guide.team.members.some(m => m.id !== activeId && m.characterId === p.characterId));
 assert(duplicate);
 await choose('选择预设', '机体 · ' + duplicate.name);
 await expect(page.getByText('此机体已在其他站位，不能重复引入。', { exact: true })).toBeVisible();
 await expect(page.getByRole('button', { name: '引入当前成员', exact: true })).toBeDisabled();
 await page.keyboard.press('Escape');
 await expect(page.locator('.guides-page[data-guide-mode="detail"]')).toBeVisible();
 checks.push('菜单关闭后 Escape 正常返回攻略');
 checks.push('引入重复机体预设被阻止');
 await page.locator('.category-nav button').first().click();
 await page.locator('.entry-card:visible').first().click();
 const skillJump=page.locator('.detail-jump').getByRole('button',{name:'技能',exact:true});
 await skillJump.click();
 await expect.poll(async()=>{const box=await page.locator('#detail-skills').boundingBox();return !!box && box.y>=0 && box.y<600;}).toBe(true);
 await page.locator('.detail-jump').getByRole('button',{name:'简介',exact:true}).click();
 await expect.poll(async()=>{const box=await page.locator('#detail-summary').boundingBox();return !!box && box.y>=0 && box.y<600;}).toBe(true);
 await page.getByRole('button',{name:'返回列表',exact:true}).click();
 checks.push('资料详情技能与简介分区跳转及返回列表通过');
 const after = await page.evaluate(() => window.desktop.getState());
 assert.deepEqual(after.guides, before.guides); assert.deepEqual(after.presets, before.presets); assert.deepEqual(errors, []);
 console.log(JSON.stringify({ checks, errors }));
} finally { await app.close(); }
