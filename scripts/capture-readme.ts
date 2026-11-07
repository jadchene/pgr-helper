import { _electron as electron, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const output = resolve(root, 'docs/screenshots');
await mkdir(output, { recursive: true });
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')), PGR_TEST_HIDDEN: '1' };
delete env.PGR_DATA_DIR; delete env.PGR_DEV_URL; delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: [root], cwd: root, env });
let originalTheme: 'system' | 'light' | 'dark' | undefined;
try {
 const page = await app.firstWindow(); page.setDefaultTimeout(15000);
 await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows()[0]; win.webContents.setBackgroundThrottling(false); win.showInactive(); win.unmaximize(); win.setSize(1440, 1000);
 });
 await page.locator('.category-nav').waitFor();
 const before = await page.evaluate(() => window.desktop.getState());
 originalTheme = before.settings.theme;
 assert.equal(resolve(before.dataDirectory), resolve(root, 'data'));
 await page.locator('.utility-nav').getByRole('button', { name: '设置', exact: true }).click();
 await page.locator('.theme-option').filter({ hasText: '浅色' }).click();
 /** 只截取应用内容，等待图片加载与过渡完成。 */
 const capture = async (name: string): Promise<void> => {
  await page.waitForTimeout(800);
  await expect(page.locator('.entry-artwork[data-artwork-loading="true"]:visible')).toHaveCount(0, { timeout: 30000 });
  const image = await app.evaluate(async ({ BrowserWindow }) => (await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(resolve(output, name + '.png'), Buffer.from(image, 'base64'));
 };
 await page.locator('.category-nav button').first().click();
 await capture('catalog');
 await page.locator('.preset-nav button').click();
 const preset = before.presets.find(p => p.kind === 'character' && !p.hidden && p.name === '七实·芒星之迹');
 assert(preset?.kind === 'character', '请先同步资料并生成示例预设');
 await page.locator('[data-character-id="' + preset.characterId + '"]').click();
 await capture('preset');
 await page.locator('.guide-nav button').click();
 await page.locator('[data-guide-id="guide:demo-single-sequence"]').click();
 await capture('team');
 await page.getByRole('button', { name: '编辑攻略', exact: true }).click();
 await page.getByRole('button', { name: '操作流程', exact: true }).click();
 await capture('flow');
 const after = await page.evaluate(() => window.desktop.getState());
 assert.deepEqual(after.presets, before.presets); assert.deepEqual(after.guides, before.guides);
 console.log('已生成四张真实界面截图，预设与攻略数据未修改。');
} finally {
 if (originalTheme) await app.firstWindow().then(page => page.evaluate(async theme => window.desktop.saveSettings({ ...(await window.desktop.getState()).settings, theme }), originalTheme!));
 await app.close();
}
