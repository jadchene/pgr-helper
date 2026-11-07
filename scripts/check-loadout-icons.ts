import {_electron as electron} from '@playwright/test';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');const output=resolve(process.env.PGR_EVIDENCE_DIR || resolve(root, 'test-results/icon-loadouts'));await mkdir(output,{recursive:true});
const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((item):item is [string,string]=>typeof item[1]==='string'));delete env.PGR_DATA_DIR;delete env.PGR_DEV_URL;delete env.ELECTRON_RUN_AS_NODE;env.PGR_TEST_HIDDEN='1';
const app=await electron.launch({args:[root],cwd:root,env});const errors:string[]=[];const checks:string[]=[];
try{const page=await app.firstWindow();page.setDefaultTimeout(15000);page.on('pageerror',error=>errors.push(error.message));await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();w.unmaximize();w.setSize(1340,900);});await page.locator('.guide-nav').waitFor();const before=await page.evaluate(()=>window.desktop.getState());assert.equal(resolve(before.dataDirectory),resolve(root,'data'));
const capture=async(name:string)=>{await page.waitForTimeout(250);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await writeFile(resolve(output,name+'.png'),Buffer.from(png,'base64'));};
await page.locator('.guide-nav button').click();await page.locator('[data-guide-id="guide:demo-loop-sequence"]').click();await page.locator('.guide-team-overview').waitFor();
const first=page.locator('.guide-member-card').first();assert.equal(await first.locator('[aria-label="武器共鸣"] .loadout-item').count(),3);
const boxes=await first.locator('[aria-label="武器共鸣"] .loadout-item').evaluateAll(items=>items.map(item=>item.getBoundingClientRect().y));assert(boxes.every(y=>Math.abs(y-boxes[0])<2));
for(const selector of ['.guide-memory-chip .loadout-item','.guide-equipped-heading .loadout-item','[aria-label="武器共鸣"] .loadout-item','.guide-pet-active .loadout-item','.guide-pet-passive .loadout-item','.resonance-summary .loadout-item']){const item=first.locator(selector).first();await item.scrollIntoViewIfNeeded();await item.hover();await page.locator('.loadout-popover:visible').waitFor();assert((await page.locator('.loadout-popover:visible').innerText()).length>5);assert.equal(await item.evaluate(el=>getComputedStyle(el).cursor),'default');await page.mouse.move(5,5);await page.waitForTimeout(250);}
checks.push('攻略：意识图片、武器共鸣横排、技能图标及各类悬浮详情');
await page.locator('.guide-team-overview').scrollIntoViewIfNeeded();await capture('01-攻略图标总览');
await page.locator('.preset-nav button').click();const preset=before.presets.find(item=>item.kind==='character'&&item.name.includes('时崎'))||before.presets.find(item=>item.kind==='character'&&!item.hidden);assert(preset?.kind==='character');await page.locator('[data-character-id="'+preset.characterId+'"]').click();await page.locator('.preset-overview').waitFor();
await page.waitForTimeout(1800);const skill=page.locator('.preset-overview .skill-row .loadout-item').first();await skill.scrollIntoViewIfNeeded();await skill.hover();await page.locator('.loadout-popover:visible').waitFor();await capture('02-技能悬浮详情');await page.mouse.move(5,5);
const loaded=await skill.locator('img').count();assert(loaded,'辅助机技能应加载来源图标');
const panel=page.locator('.memory-panel');assert((await panel.boundingBox())!.height<280,'意识方案区域应紧凑');await capture('03-预设紧凑总览');
await page.getByRole('button',{name:'编辑预设',exact:true}).click();const input=page.locator('.presets-page input').first();assert.equal(await input.evaluate(el=>getComputedStyle(el).cursor),'text');assert.equal(await page.getByRole('button',{name:'保存预设',exact:true}).evaluate(el=>getComputedStyle(el).cursor),'default');await page.getByRole('button',{name:'返回总览',exact:true}).click();
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680));await page.waitForTimeout(350);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await capture('04-窄窗口');
checks.push('预设：技能真实图标、意识紧凑排版、共鸣合计、悬浮详情及输入光标');
const after=await page.evaluate(()=>window.desktop.getState());assert.deepEqual(after.presets,before.presets);assert.deepEqual(after.guides,before.guides);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
}finally{await writeFile(resolve(output,'checks.json'),JSON.stringify({checks,errors},null,2));await app.close();}
