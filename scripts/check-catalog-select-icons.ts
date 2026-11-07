import {_electron as electron, expect} from '@playwright/test';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=resolve(process.env.PGR_EVIDENCE_DIR || resolve(root, 'test-results/catalog-select-icons'));await mkdir(dir,{recursive:true});const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((item):item is [string,string]=>typeof item[1]==='string'));delete env.PGR_DATA_DIR;delete env.PGR_DEV_URL;delete env.ELECTRON_RUN_AS_NODE;env.PGR_TEST_HIDDEN='1';const app=await electron.launch({args:[root],cwd:root,env});const checks:string[]=[];const errors:string[]=[];
try{const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();w.unmaximize();});await page.locator('.guide-nav').waitFor();const before=await page.evaluate(()=>window.desktop.getState());assert.equal(resolve(before.dataDirectory),resolve(root,'data'));
const capture=async(name:string)=>{await page.waitForTimeout(250);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await writeFile(resolve(dir,name+'.png'),Buffer.from(png,'base64'));};

await page.locator('.guide-nav button').click();await page.locator('[data-guide-id="guide:demo-single-sequence"]').click();await page.getByRole('button',{name:'编辑攻略',exact:true}).click();
await page.getByLabel('适用副本',{exact:true}).first().click();await expect(page.locator('.n-base-select-menu:visible .catalog-select-label').first()).toBeVisible();await page.keyboard.press('Escape');
await page.getByRole('button',{name:'队伍配置',exact:true}).click();
for(const label of ['首发机体','配置机体','第1组意识套装','上位第1种共鸣','配置武器','武器共鸣1','谐振绑定意识','配置辅助机','辅助机主动技能','辅助机被动技能']){
 const select=page.getByLabel(label,{exact:true}).first();
 if(!await select.count()){console.log('未找到字段 '+label);continue;}
 await select.scrollIntoViewIfNeeded();await select.click();
 await expect(page.locator('.n-base-select-menu:visible .catalog-select-label').first()).toBeVisible();
 await expect(page.locator('.n-base-select-menu:visible .catalog-select-label img').first()).toBeVisible();
 if(label==='配置武器'||label==='辅助机主动技能')await capture(label+'图标');
 await page.keyboard.press('Escape');await page.waitForTimeout(150);
 checks.push(label+'图标已显示');
}
const selectedIcons=await page.locator('.n-base-selection .catalog-select-label').count();assert(selectedIcons>5);checks.push('已选标签包含图标：'+selectedIcons);
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680));await page.getByLabel('配置武器',{exact:true}).first().scrollIntoViewIfNeeded();await page.getByLabel('配置武器',{exact:true}).first().click();await capture('武器下拉-窄窗口');
await page.keyboard.press('Escape');await page.locator('.category-nav button').first().click();
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1340,900));
for(const key of ['element','profession','effect']){
 const field=page.locator('[data-facet="'+key+'"] .n-base-selection');await field.click();
 await expect(page.locator('.n-base-select-menu:visible .catalog-select-label img').first()).toBeVisible();await capture('字典筛选-'+key);await page.keyboard.press('Escape');await page.waitForTimeout(150);
}
assert(await page.locator('.dictionary-badge .entry-artwork img').count()>0);checks.push('属性、职业、效应筛选及机体卡片字典图标通过');
const after=await page.evaluate(()=>window.desktop.getState());assert.deepEqual(after.guides,before.guides);assert.deepEqual(after.presets,before.presets);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
}finally{await writeFile(resolve(dir,'checks.json'),JSON.stringify({checks,errors},null,2));await app.close();}
