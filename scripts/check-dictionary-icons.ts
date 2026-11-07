import {_electron as electron, expect} from '@playwright/test';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=resolve(process.env.PGR_EVIDENCE_DIR || resolve(root, 'test-results/catalog-select-icons'));await mkdir(dir,{recursive:true});const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((item):item is [string,string]=>typeof item[1]==='string'));delete env.PGR_DATA_DIR;delete env.PGR_DEV_URL;delete env.ELECTRON_RUN_AS_NODE;env.PGR_TEST_HIDDEN='1';const app=await electron.launch({args:[root],cwd:root,env});const checks:string[]=[];const errors:string[]=[];
try{const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();w.unmaximize();});await page.locator('.guide-nav').waitFor();const before=await page.evaluate(()=>window.desktop.getState());assert.equal(resolve(before.dataDirectory),resolve(root,'data'));
const capture=async(name:string)=>{await page.waitForTimeout(250);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await writeFile(resolve(dir,name+'.png'),Buffer.from(png,'base64'));};

await page.locator('.category-nav button').first().click();
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1340,900));
for(const key of ['element','profession','effect']){
 const field=page.locator('[data-facet="'+key+'"] .n-base-selection');await field.click();
 await expect(page.locator('.n-base-select-menu:visible .catalog-select-label img').first()).toBeVisible();if(key==='profession') {
 const icon=page.locator('.n-base-select-menu:visible [data-dictionary-type="职业"] img').first();
 await expect(icon).toBeVisible();
 const original=await page.evaluate(()=>document.documentElement.dataset.theme);
 await page.evaluate(()=>document.documentElement.dataset.theme='light');
 assert.equal(await icon.evaluate(el=>getComputedStyle(el).filter),'brightness(0.55)');
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');
 assert.equal(await icon.evaluate(el=>getComputedStyle(el).filter),'none');
 await page.evaluate(value=>{if(value) document.documentElement.dataset.theme=value;else delete document.documentElement.dataset.theme;},original);
 checks.push('职业图标深浅主题对比度通过');
}
await capture('字典筛选-'+key);await page.keyboard.press('Escape');await page.waitForTimeout(150);
}
assert(await page.locator('.dictionary-badge .entry-artwork img').count()>0);checks.push('属性、职业、效应筛选及机体卡片字典图标通过');
const after=await page.evaluate(()=>window.desktop.getState());assert.deepEqual(after.guides,before.guides);assert.deepEqual(after.presets,before.presets);assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
}finally{await writeFile(resolve(dir,'checks.json'),JSON.stringify({checks,errors},null,2));await app.close();}
