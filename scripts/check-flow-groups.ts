import {_electron as electron} from '@playwright/test';import assert from 'node:assert/strict';import {mkdir,writeFile} from 'node:fs/promises';import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..'),dir=resolve(process.env.PGR_EVIDENCE_DIR || resolve(root, 'test-results/flow-groups'));await mkdir(dir,{recursive:true});const env:Record<string,string>=Object.fromEntries(Object.entries(process.env).filter((item):item is [string,string]=>typeof item[1]==='string'));delete env.PGR_DATA_DIR;delete env.PGR_DEV_URL;delete env.ELECTRON_RUN_AS_NODE;env.PGR_TEST_HIDDEN='1';const app=await electron.launch({args:[root],cwd:root,env});const checks:string[]=[];const errors:string[]=[];
try{const page=await app.firstWindow();page.setDefaultTimeout(12000);page.on('pageerror',e=>errors.push(e.message));await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.webContents.setBackgroundThrottling(false);w.showInactive();w.unmaximize();});await page.locator('.guide-nav').waitFor();await page.evaluate(async()=>{
  const state=await window.desktop.getState();
  for(const record of state.guides){
    const {createdAt,updatedAt,revision,hidden,...document}=record;
    let changed=false;
    const pending=[...document.flow.nodes];while(pending.length){const node=pending.pop()!;if(node.count === undefined){node.count=1;changed=true;}if(node.group === undefined){node.group=0;changed=true;}for(const branch of node.branches)pending.push(...branch);}
    if(document.id==='guide:demo-single-sequence'){for(const node of document.flow.nodes){node.group=0;node.count=1;}document.flow.groupNotes={};changed=true;}if(changed)await window.desktop.saveGuide(document,revision);
  }
});await page.reload();await page.locator('.guide-nav').waitFor();const before=await page.evaluate(()=>window.desktop.getState());assert.equal(resolve(before.dataDirectory),resolve(root,'data'));
const capture=async(name:string)=>{await page.waitForTimeout(250);const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await writeFile(resolve(dir,name+'.png'),Buffer.from(png,'base64'));};

await page.locator('.guide-nav button').click();
await page.locator('[data-guide-id="guide:demo-single-sequence"]').click();
await page.getByRole('button',{name:'编辑攻略',exact:true}).click();
await page.getByRole('button',{name:'操作流程',exact:true}).click();
await page.locator('.flow-node-card').nth(0).click();
await page.getByRole('button',{name:'新建分组',exact:true}).click();
await page.getByLabel('分组备注',{exact:true}).fill('开场连续消球后释放大招');
const input=page.getByLabel('操作次数',{exact:true});await input.fill('3');await input.press('Tab');
await page.locator('.flow-node-card').nth(1).click();
await page.getByLabel('节点分组',{exact:true}).click();
await page.locator('.n-base-select-menu:visible').getByText('分组 1',{exact:true}).click();
assert.equal(await page.locator('.flow-row.grouped > .flow-row-nodes > .flow-step').count(),2);
await page.locator('.flow-node-card').nth(2).click();
assert(await page.getByRole('button',{name:'新建分组',exact:true}).isDisabled());
await page.locator('.flow-node-card').nth(3).click();
await page.getByRole('button',{name:'新建分组',exact:true}).click();
await page.getByRole('button',{name:'保存攻略',exact:true}).click();
await page.locator('[data-guide-mode="detail"]').waitFor();
await page.locator('.guide-flow-view').scrollIntoViewIfNeeded();
assert((await page.locator('.flow-node-top').first().innerText()).includes('红球 × 3'));
const rects=await page.locator('.flow-row.grouped > .flow-row-nodes > .flow-step > .flow-node-card').evaluateAll(items=>items.map(el=>({x:el.getBoundingClientRect().x,y:el.getBoundingClientRect().y,width:el.getBoundingClientRect().width})));
assert.equal(rects.length,2);assert.equal(rects[0].y,rects[1].y);assert(rects[0].x<rects[1].x);assert(rects.every(r=>r.width<=210));
assert(!(await page.locator('.guide-flow-view').innerText()).includes('分组'));
await capture('连续节点横排');
const after=await page.evaluate(()=>window.desktop.getState());const saved=after.guides.find(g=>g.id==='guide:demo-single-sequence')!;
assert.deepEqual(saved.flow.nodes.map(n=>n.group),[1,1,0,2]);assert.equal(saved.flow.nodes[0].count,3);assert.equal(saved.flow.groupNotes?.['1'],'开场连续消球后释放大招');assert.equal(await page.locator('.flow-group-note').innerText(),'开场连续消球后释放大招');
await page.reload();await page.locator('.guide-nav button').click();await page.locator('[data-guide-id="guide:demo-single-sequence"]').click();
assert.equal(await page.locator('.flow-row.grouped > .flow-row-nodes > .flow-step').count(),2);
await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(1000,680));await page.locator('.guide-flow-view').scrollIntoViewIfNeeded();await capture('连续节点横排-窄窗口');
assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
checks.push('默认数据：新增自动编号分组、同机体横排、切人禁止共组、次数保存、重新加载和窄窗口验证通过');assert.deepEqual(errors,[]);console.log(JSON.stringify({checks,errors}));
}finally{await writeFile(resolve(dir,'checks.json'),JSON.stringify({checks,errors},null,2));await app.close();}
