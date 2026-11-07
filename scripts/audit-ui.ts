import { _electron as electron } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const output=process.env.PGR_EVIDENCE_DIR || resolve(process.env.PGR_EVIDENCE_DIR || resolve(root, 'test-results/all-pages-before'));
await mkdir(output,{recursive:true});
const env: Record<string, string> = { ...Object.fromEntries(Object.entries(process.env).filter((item): item is [string, string] => typeof item[1] === 'string')), PGR_TEST_HIDDEN: '1' };delete env.PGR_DATA_DIR;delete env.PGR_DEV_URL;delete env.ELECTRON_RUN_AS_NODE;
const app=await electron.launch({args:[root],cwd:root,env});
let originalTheme: 'system' | 'light' | 'dark' | undefined;
const errors:string[]=[]; const views:unknown[]=[];
try {
 const page=await app.firstWindow();page.setDefaultTimeout(10000);page.on('pageerror',error=>errors.push(error.message));
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();w.unmaximize();w.setSize(1340,900);});
 await page.locator('.category-nav').waitFor();
 const initial=await page.evaluate(()=>window.desktop.getState());assert.equal(resolve(initial.dataDirectory),resolve(root,'data'));
 originalTheme=initial.settings.theme;
 if(process.env.PGR_AUDIT_THEME){await page.locator('.utility-nav').getByRole('button',{name:'设置',exact:true}).click();await page.locator('.theme-option').filter({hasText:process.env.PGR_AUDIT_THEME==='dark'?'深色':'浅色'}).click();}
 /** 截图与几何同时记录，超出主内容区域的页面需单独处理。 */
 const capture=async(name:string)=>{
  await page.waitForTimeout(200);
  const geometry=await page.evaluate(()=>({width:innerWidth,height:innerHeight,scroll:document.documentElement.scrollWidth,heading:document.querySelector('.main-content h1')?.textContent}));
  views.push({name,...geometry});assert(geometry.scroll<=geometry.width+1,name+'横向溢出');
  const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
  await writeFile(resolve(output,name+'.png'),Buffer.from(png,'base64'));
 };
 for(const width of [1340,1000]){
  await app.evaluate(({BrowserWindow},width)=>BrowserWindow.getAllWindows()[0].setSize(width,width===1000?680:900),width);
  for(let index=0;index<8;index++){
   await page.locator('.category-nav button').nth(index).click();await page.locator('.catalog-filter-bar').waitFor();await capture(width+'-catalog-'+index);
   const first=page.locator('.entry-card:visible, .entry-row:visible').first();
   if(await first.count()){
    await first.click();await page.locator('.detail-page').waitFor();await capture(width+'-detail-'+index);
    if(await page.locator('.skill-book').count()){await page.locator('.skill-book').scrollIntoViewIfNeeded();await capture(width+'-skills-'+index);}
    if(index===0){await page.getByRole('button',{name:'编辑资料',exact:true}).click();await page.locator('.editor-modal').waitFor();await capture(width+'-entry-editor');for(const tab of ['属性与正文','关联资料']){await page.locator('.editor-modal .n-tabs-tab').filter({hasText:tab}).click();await capture(width+'-entry-editor-'+tab);}await page.getByRole('button',{name:'取消',exact:true}).click();}
    await page.getByRole('button',{name:'返回列表',exact:true}).click();
   }
  }
  for(const name of ['同步中心','回收站','设置']){
   await page.locator('.utility-nav').getByRole('button',{name:new RegExp('^'+name)}).click();await capture(width+'-'+name);
   if(name==='设置'){if(await page.locator('.settings-jump').count()){await page.locator('.settings-jump').getByRole('button',{name:'数据与备份',exact:true}).click();assert(await page.locator('#settings-data').isVisible());await capture(width+'-设置数据入口');}await page.locator('.settings-scroll').evaluate(el=>{el.scrollTop=el.scrollHeight;});await capture(width+'-设置下部');}
  }
  await page.locator('.guide-nav button').click();await capture(width+'-攻略列表');
  await page.locator('.guide-page-header').getByRole('button',{name:'新建攻略',exact:true}).click();
  for(const name of ['基本信息','队伍配置','操作流程']){await page.getByRole('button',{name,exact:true}).click();await capture(width+'-攻略编辑-'+name);}
  await page.getByRole('button',{name:'返回列表',exact:true}).click();
  await page.locator('.preset-nav button').click();await capture(width+'-机体预设');
  const preset=initial.presets.find(item=>item.kind==='character'&&!item.hidden);
  if(preset?.kind==='character'){
   await page.locator('[data-character-id="'+preset.characterId+'"]').click();await capture(width+'-预设总览');
   await page.getByRole('button',{name:'编辑预设',exact:true}).click();await capture(width+'-预设编辑');
   await page.getByRole('button',{name:'返回总览',exact:true}).click();await page.getByRole('button',{name:'返回机体列表',exact:true}).click();
  }
  await page.getByRole('tab',{name:'通用预设',exact:true}).click();await capture(width+'-通用预设');
  for(const name of ['意识','辅助机']){await page.getByRole('button',{name:'新增'+name+'预设',exact:true}).click();await capture(width+'-新增'+name);await page.getByRole('button',{name:'返回通用预设',exact:true}).click();}
 }
 const final=await page.evaluate(()=>window.desktop.getState());assert.deepEqual(final.presets,initial.presets);assert.deepEqual(final.guides,initial.guides);assert.deepEqual(errors,[]);
 console.log('已检查 '+views.length+' 个页面状态');
} finally {if(originalTheme) await app.firstWindow().then(page=>page.evaluate(async theme=>window.desktop.saveSettings({...((await window.desktop.getState()).settings),theme}),originalTheme!)).catch(()=>{});await writeFile(resolve(output,'audit.json'),JSON.stringify({views,errors},null,2));await app.close();}
