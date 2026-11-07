import { _electron as electron, type ElectronApplication, type Page, type Locator } from '@playwright/test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { categories, categoryLabels } from '../src/shared/types';
import { catalogQueryConfig, compareCatalogEntries, facetValues } from '../src/renderer/catalog-query';

const project=resolve(import.meta.dirname,'..');
const data=join(project,'data');
const evidence=resolve(process.env.PGR_EVIDENCE_DIR || join(project,'test-results/inline-filters'));
const checks: string[] = [], errors: string[] = [];
const report: Record<string,unknown>={passed:false,data,checks,errors};
let app: ElectronApplication | undefined;
let page!: Page;
const exact=(text:string)=>new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}$`);
const passed=(name:string)=>{checks.push(name);console.log(`通过：${name}`);};
/** 下拉通过实际点击和搜索选择，保留正常焦点和关闭行为。 */
const choose=async(control:Locator,value:string)=>{
 await control.scrollIntoViewIfNeeded(); await control.click({position:{x:5,y:5}});
 const input=control.locator('input').first();
 if(await input.count() && await input.isEditable()) await input.fill(value);
 await page.locator('.n-base-select-menu:visible .n-base-select-option').filter({hasText:exact(value)}).first().click();
 await page.locator('.n-base-select-menu:visible').waitFor({state:'hidden'});
};
const capture=async(name:string)=>{
 await page.waitForTimeout(350);
 const png=await app!.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));
 await writeFile(join(evidence,`${name}.png`),Buffer.from(png,'base64'));
};
/** 读取展示结果，不访问组件内部状态。 */
const shown=()=>page.locator('.catalog-page:visible .entry-card, .catalog-page:visible .entry-row').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-entry-id')));
try {
 await mkdir(evidence,{recursive:true});
 const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((item):item is [string,string]=>typeof item[1]==='string'));
 delete env.PGR_DATA_DIR;delete env.PGR_DEV_URL;delete env.ELECTRON_RUN_AS_NODE;env.PGR_TEST_HIDDEN='1';
 app=await electron.launch({args:[project],cwd:project,env});page=await app.firstWindow();page.setDefaultTimeout(12000);
 page.on('pageerror',error=>errors.push(error.message));
 await app.evaluate(({BrowserWindow})=>{const window=BrowserWindow.getAllWindows()[0];window.webContents.setBackgroundThrottling(false);window.showInactive();});
 await page.locator('.category-nav').waitFor();
 const initial=await page.evaluate(()=>window.desktop.getState());assert.equal(resolve(initial.dataDirectory),data);
 const entries=initial.entries;report.entries=entries.length;
 for(const category of categories){
  await page.locator('.category-nav button').filter({has:page.locator('span',{hasText:exact(categoryLabels[category])})}).click();
  await page.locator('.catalog-page:visible .catalog-filter-bar').waitFor();
  const base=entries.filter(entry=>entry.category===category && !entry.hidden).sort(compareCatalogEntries);
  assert.deepEqual(await shown(),base.slice(0,24).map(entry=>entry.id));
  const fields=await page.locator('.catalog-page:visible [data-facet]:not([data-facet="status"])').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-facet')));
  assert.deepEqual(fields,catalogQueryConfig[category].filters.map(field=>field.key));
  assert.equal(await page.getByRole('button',{name:'筛选',exact:true}).count(),0);
  const field=catalogQueryConfig[category].filters.find(field=>new Set(base.flatMap(entry=>facetValues(entry,field.key))).size>1)!;
  assert(field);
  const value=facetValues(base[0],field.key)[0];
  await choose(page.locator(`.catalog-page:visible [data-facet="${field.key}"] .n-select`),value);
  assert.deepEqual(await shown(),base.slice(0,24).map(entry=>entry.id));
  await page.getByRole('button',{name:'应用筛选',exact:true}).click();
  assert.deepEqual(await shown(),base.filter(entry=>facetValues(entry,field.key).includes(value)).slice(0,24).map(entry=>entry.id));
  await page.getByRole('button',{name:'清空筛选',exact:true}).click();
  assert.deepEqual(await shown(),base.slice(0,24).map(entry=>entry.id));
  passed(`${categoryLabels[category]}：条件直接展开，应用前保留列表，应用与清空结果正确`);
 }
 await page.locator('.category-nav button').filter({has:page.locator('span',{hasText:exact('机体')})}).click();
 const target=entries.find(entry=>entry.category==='character' && !entry.hidden && entry.element && entry.profession)!;
 await choose(page.locator('.catalog-page:visible [data-facet="element"] .n-select'),target.element);
 await choose(page.locator('.catalog-page:visible [data-facet="profession"] .n-select'),target.profession);
 await page.getByRole('button',{name:'应用筛选',exact:true}).click();
 const expected=entries.filter(entry=>entry.category==='character'&&!entry.hidden&&entry.element===target.element&&entry.profession===target.profession).sort(compareCatalogEntries);
 assert.deepEqual(await shown(),expected.slice(0,24).map(entry=>entry.id));
 const search=page.getByPlaceholder('搜索名称、别名或关键词');
 await search.fill(target.name);assert.deepEqual(await shown(),[target.id]);
 const sizes=await page.locator('.catalog-page:visible .filter-fields').evaluate(element=>({width:element.clientWidth,search:element.querySelector('.catalog-search')!.getBoundingClientRect().width}));
 assert(sizes.search<sizes.width/2);
 await capture('01-基础资料搜索与独立筛选');
 await page.getByRole('button',{name:'清空筛选',exact:true}).click();
 await page.locator('.catalog-page:visible [data-facet="element"] .n-select').click();
 await page.locator('.catalog-page:visible [data-facet="element"] > span').click();
 await page.locator('.n-base-select-menu:visible').waitFor({state:'hidden'});
 await search.fill(target.name);
 await page.locator(`.catalog-page:visible [data-entry-id="${target.id}"]`).click();
 await page.locator('.detail-page:visible').waitFor();
 await page.getByRole('button',{name:'返回列表',exact:true}).click();
 assert.equal(await search.inputValue(),target.name);
 passed('基础资料搜索与条件组合，标题空白收起下拉，详情返回保留查询');
 await page.locator('.preset-nav button').click();
 const presetFields=page.locator('.guide-choice-filter[aria-label="机体筛选"]');
 const presetSearch=page.getByPlaceholder('搜索机体名称或别名');
 assert.equal(await presetFields.locator('.guide-filter-fields .n-input').count(),1);
 assert.equal(await presetFields.locator('.n-select').count(),7);
 await choose(page.locator('.n-select[aria-label="机体属性筛选"]'),target.element);
 await choose(page.locator('.n-select[aria-label="机体职业筛选"]'),target.profession);
 const presetExpected=expected.filter(entry=>!entry.retired);
 assert.deepEqual(await page.locator('.preset-character-card').evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-character-id'))),presetExpected.map(entry=>entry.id));
 await presetSearch.fill(target.name);
 assert.equal(await page.locator('.preset-character-card').count(),1);
 await capture('02-机体预设搜索并入筛选');
 await presetFields.getByRole('button',{name:'清空筛选',exact:true}).click();
 assert.equal(await presetSearch.inputValue(),'');
 assert.equal(await page.locator('.preset-character-card').count(),entries.filter(entry=>entry.category==='character'&&!entry.hidden&&!entry.retired).length);
 passed('预设搜索位于筛选网格，七个独立条件可组合且一键清空');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680));
 await capture('03-窄窗口预设筛选');
 assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
 await page.locator('.n-select[aria-label="机体职业筛选"]').click();
 await page.getByRole('tab',{name:'通用预设',exact:true}).click();
 await page.locator('.n-base-select-menu:visible').waitFor({state:'hidden'});
 await page.locator('.category-nav button').filter({has:page.locator('span',{hasText:exact('副本')})}).click();
 await capture('04-窄窗口副本筛选');
 const geometry=await page.evaluate(()=>({width:innerWidth,pageWidth:document.documentElement.scrollWidth,bar:document.querySelector('.catalog-page .catalog-filter-bar')!.getBoundingClientRect().bottom,scroll:document.querySelector('.catalog-page .catalog-scroll')?.clientHeight||0}));
 report.minimumWindow=geometry;assert(geometry.pageWidth<=geometry.width+1);assert(geometry.scroll>=90);
 await page.getByRole('button',{name:'应用筛选',exact:true}).click({trial:true});
 passed('窄窗口搜索和筛选自动换行，无横向溢出，切换页面收起下拉');
 const final=await page.evaluate(()=>window.desktop.getState());
 assert.deepEqual(final.presets,initial.presets);assert.deepEqual(final.guides,initial.guides);
 assert.deepEqual(errors,[]);report.passed=true;
}catch(error){report.failure=error instanceof Error?error.stack:String(error);if(app)await capture('failure').catch(()=>{});process.exitCode=1;}
finally{
 if(app){const child=app.process();const exited=new Promise<void>(done=>child.once('exit',()=>done()));await app.evaluate(({app})=>app.exit(0)).catch(()=>{});if(child.exitCode===null)await exited;}
 await writeFile(join(evidence,'filters.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
