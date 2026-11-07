import { _electron as electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { buildGuideFixture } from '../tests/helpers/guide-fixture';
import { CatalogStore } from '../src/main/store';
const root=resolve(import.meta.dirname,'..');const output=resolve(process.env.PGR_EVIDENCE_DIR || resolve(root, 'test-results/populated-guide-ui'));await mkdir(output,{recursive:true});
const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((item):item is [string,string]=>typeof item[1]==='string'));delete env.PGR_DATA_DIR;delete env.PGR_DEV_URL;delete env.ELECTRON_RUN_AS_NODE;env.PGR_TEST_HIDDEN='1';
let testId='';let settings:Awaited<ReturnType<CatalogStore['getState']>>['settings'] | undefined;
const app=await electron.launch({args:[root],cwd:root,env});const errors:string[]=[];
try{const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();w.unmaximize();});await page.locator('.guide-nav').waitFor();const state=await page.evaluate(()=>window.desktop.getState());settings=state.settings;assert.equal(resolve(state.dataDirectory),resolve(root,'data'));
const guide=buildGuideFixture(state.entries);guide.name='界面审查：完整队伍与循环流程';testId=guide.id;await page.evaluate(value=>window.desktop.saveGuide(value,null),guide);await page.reload();await page.locator('.guide-nav').waitFor();
for(const theme of ['浅色','深色']){await page.locator('.utility-nav').getByRole('button',{name:'设置',exact:true}).click();await page.locator('.theme-option').filter({hasText:theme}).click();
for(const width of [1340,1000]){await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,width===1000?680:900),width);await page.locator('.guide-nav button').click();await page.locator('[data-guide-id="'+testId+'"]').click();
const capture=async(name:string)=>{await page.waitForTimeout(250);assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));const image=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await writeFile(resolve(output,theme+'-'+width+'-'+name+'.png'),Buffer.from(image,'base64'));};
await capture('队伍总览');await page.locator('.guide-flow-view').scrollIntoViewIfNeeded();await capture('流程总览');await page.getByRole('button',{name:'编辑攻略',exact:true}).click();await page.getByRole('button',{name:'队伍配置',exact:true}).click();await capture('队伍编辑');await page.getByRole('button',{name:'操作流程',exact:true}).click();await capture('流程编辑');await page.getByRole('button',{name:'返回攻略',exact:true}).click();}}
assert.deepEqual(errors,[]);console.log('完整三人队伍与循环/并行流程：两种主题、两种尺寸共16个状态通过。');
}finally{if(settings)await app.firstWindow().then(page=>page.evaluate(value=>window.desktop.saveSettings(value),settings!));await app.close();const store=new CatalogStore(resolve(root,'data'));if(testId)store.db.prepare('DELETE FROM guides WHERE id=?').run(testId);store.close();await writeFile(resolve(output,'audit.json'),JSON.stringify({errors,testId,cleaned:true},null,2));}
