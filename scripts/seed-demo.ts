import { resolve } from 'node:path';
import { CatalogStore } from '../src/main/store';
import { buildGuideFixture } from '../tests/helpers/guide-fixture';
import { createPreset, type PresetDocument } from '../src/shared/presets';
import { presetMemoryFromMember } from '../src/renderer/preset-config';
import { validatePreset } from '../src/shared/preset-validation';
import { validateGuide } from '../src/shared/guide-validation';
import { createFlowNode } from '../src/shared/guide-flow';
import type { GuideDocument } from '../src/shared/guides';

/** 使用默认资料生成可查看的展示示例，不覆盖已有配置。 */
const store = new CatalogStore(resolve(import.meta.dirname, '../data'));
try {
 const entries=store.listEntries().filter(item=>!item.hidden&&!item.retired);
 const byId=new Map(entries.map(item=>[item.id,item]));
 const base=buildGuideFixture(entries);
 const note='界面展示示例：用于体验配置总览和编辑流程，装备与动作仅演示功能，不代表实战最优搭配。可自行修改或移至回收站。';
 const presets:PresetDocument[]=[];
 for(const [index,member] of base.team.members.entries()) {
  if(store.listPresets().some(item=>item.kind==='character'&&item.characterId===member.characterId)) continue;
  const value=createPreset('character');
  Object.assign(value,{id:`preset:demo-character-${member.characterId.replaceAll(':','-')}`,name:byId.get(member.characterId)!.name,notes:note,characterId:member.characterId,evolutionId:member.evolutionId,weaponId:member.weaponId,weaponResonanceIds:member.weaponResonanceIds,harmonizationLevel:member.harmonization.level,pet:member.pet});
  const first=presetMemoryFromMember(member,entries,false,'示例 · 常用搭配');
  const second=structuredClone(first);second.id=crypto.randomUUID();second.name='示例 · 六件套方案';second.memories=[{memoryId:first.memories[0].memoryId,count:6}];
  value.memorySets=first.memories.length>1?[first,second]:[first];presets.push(value);
  if(index<2) {
   const generic=createPreset('memory');generic.id=`preset:demo-memory-${index+1}`;generic.name=`示例 · ${index===0?'4＋2组合':'六件套组合'}`;generic.notes=note;
   const {id:_id,name:_name,...memory}=presetMemoryFromMember(member,entries,true);generic.memory=memory;presets.push(generic);
   const companion=createPreset('pet');companion.id=`preset:demo-pet-${index+1}`;companion.name=`示例 · ${byId.get(member.pet.petId)?.name || '辅助机'} · ${index===0?'完整技能':'基础技能'}`;companion.notes=note;companion.pet=structuredClone(member.pet);
   if(index===1){const quality=byId.get(member.pet.petId)!.guideOptions!.partnerQualities![0];companion.pet.quality=quality.quality;companion.pet.passiveSkillIds=companion.pet.passiveSkillIds.slice(0,quality.passiveSlots);}
   presets.push(companion);
  }
 }
 const guides:GuideDocument[]=[];
 const single=structuredClone(base);single.id='guide:demo-single-sequence';single.name='示例 · 单轮输出与换人';single.notes=note+'\n展示三人配装、开场技能和换人收尾。';single.stageIds=base.stageIds.slice(0,1);single.durationSeconds=30;single.videoUrls=[];single.recordedAt='';
 const skill=createFlowNode('skill');skill.skill='red';skill.notes='开场消球';const ultimate=createFlowNode('skill');ultimate.skill='ultimate';const change=createFlowNode('switch');change.memberId=single.team.members[1].id;const attack=createFlowNode('attack');attack.notes='切换成员后收尾';single.flow={mode:'single',nodes:[skill,ultimate,change,attack]};guides.push(single);
 const loop=structuredClone(base);loop.id='guide:demo-loop-sequence';loop.name='示例 · 三人循环与并行QTE';loop.notes=note+'\n展示长按普攻时并行触发QTE，以及三人轮换后的循环返回。';loop.videoUrls=[];loop.recordedAt='';loop.flow.loopStartId=loop.flow.nodes[0].id;guides.push(loop);
 const draft=structuredClone(single);draft.id='guide:demo-draft-sequence';draft.name='示例 · 待完善的副本攻略';draft.status='draft';draft.notes=note+'\n草稿示例：已配好队伍，操作流程可在编辑页继续补充。';draft.flow={mode:'single',nodes:[]};draft.durationSeconds=null;guides.push(draft);
 const freshPresets=presets.filter(value=>!store.listPresets().some(item=>item.id===value.id));const freshGuides=guides.filter(value=>!store.listGuides().some(item=>item.id===value.id));
 for(const value of freshPresets){const issues=validatePreset(value,entries);if(issues.length)throw new Error(value.name+': '+issues.join(';'));}
 for(const value of freshGuides){const issues=validateGuide(value,entries);if(issues.length)throw new Error(value.name+': '+issues.map(item=>item.message).join(';'));}
 for(const value of freshPresets)store.savePreset(value,null);
 for(const value of freshGuides)store.saveGuide(value,null);
 console.log(JSON.stringify({dataDirectory:store.getState().dataDirectory,createdPresets:freshPresets.map(value=>({name:value.name,kind:value.kind})),createdGuides:freshGuides.map(value=>value.name)},null,2));
} finally {store.close();}
