import { readFileSync } from 'node:fs';
import { snapshotSchema } from '../../src/main/schemas';
import type { CatalogEntry, CatalogSnapshot } from '../../src/shared/types';
import type { GuideDocument, GuideMember, FlowNodeType } from '../../src/shared/guides';
import { createGuide, createGuideMember, teamPositions } from '../../src/shared/guides';
import { createFlowNode } from '../../src/shared/guide-flow';
import { loadCatalogSnapshot } from '../../src/main/sources';
import { defaultSourceProfile } from '../../src/main/schemas';
import { readMyssalHttpFixture } from './myssal-http-fixture';

/** 通过当前生产加载器读取固定真实表，适用于单测和隔离桌面验证。 */
export const loadGuideSnapshot = async (repository: string): Promise<CatalogSnapshot> => {
  // 业务回归可使用开发程序已同步的快照；原始表适配测试仍走仓库样本。
  if (process.env.PGR_TEST_CATALOG) {
    const cache = JSON.parse(readFileSync(process.env.PGR_TEST_CATALOG, 'utf8'));
    return snapshotSchema.parse(typeof cache.payload === 'string' ? JSON.parse(cache.payload) : cache);
  }
  const fixture = await readMyssalHttpFixture(repository);
  const original = globalThis.fetch;
  try {
    globalThis.fetch = fixture.fetch;
    return await loadCatalogSnapshot(defaultSourceProfile, new AbortController().signal);
  } finally { globalThis.fetch = original; }
};

/** 从当前条目关系构建三人完整攻略，测试不依赖某一机体或装备名称。 */
export const buildGuideFixture = (entries: readonly CatalogEntry[]): GuideDocument => {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const characters = entries.filter(entry => entry.category === 'character' && entry.guideOptions?.evolutionStages?.length && entry.guideOptions.characterType === 1);
  const anchor = characters.find(entry => entry.guideOptions!.evolutionStages!.some(stage => stage.label === 'SSS3') && entry.guideOptions!.effectIds!.length);
  if (!anchor) throw new Error('真实攻略样本需要一名有 SSS3 阶段和队伍效应的机体');
  const partners = entries.filter(entry => entry.category === 'pet' && entry.guideOptions?.partnerQualities?.length);
  const selected = [anchor];
  for (let index = 1; index < 3; index++) {
    const next = characters.find(entry => !selected.includes(entry) && entry.element === anchor.element && !selected.some(member => member.profession === entry.profession))
      ?? characters.find(entry => !selected.includes(entry) && entry.element === anchor.element)
      ?? characters.find(entry => !selected.includes(entry));
    if (!next) throw new Error('真实攻略样本不足三名机体');
    selected.push(next);
  }
  const guide = createGuide(entries.filter(entry => entry.category === 'stage').slice(0, 2).map(entry => entry.id));
  if (guide.stageIds.length !== 2) throw new Error('真实攻略样本需要两个副本');
  guide.name = '三人多副本攻略验证';
  guide.status = 'ready';
  guide.recordedAt = '2026-11-06T16:40';
  guide.durationSeconds = 120;
  guide.notes = '完整配置与可重复 QTE、并行操作的真实源样本。';
  guide.videoUrls = ['https://www.bilibili.com/video/BV1xx411c7mD'];
  guide.team.members = selected.map((character, index): GuideMember => {
    const member = createGuideMember(teamPositions[index], `member-${teamPositions[index]}`);
    member.characterId = character.id;
    member.evolutionId = character.guideOptions!.evolutionStages!.find(stage => stage.label === 'SSS3')?.id ?? character.guideOptions!.evolutionStages!.at(-1)!.id;
    const isAllowed = (choice: { characterIds: string[] }): boolean => !choice.characterIds.length || choice.characterIds.includes(character.id);
    const weapons = entries.filter(entry => entry.category === 'weapon' && entry.guideOptions?.weaponType === character.guideOptions!.weaponType && entry.guideOptions?.resonanceSlots?.length === 3 && entry.guideOptions.resonanceSlots.every(slot => slot.choices.some(isAllowed)) && entry.guideOptions.harmonizationLevels?.length);
    const weapon = weapons.find(entry => character.relatedIds.includes(entry.id)) ?? weapons[0];
    if (!weapon) throw new Error(`样本机体没有可完整配置的武器：${character.id}`);
    member.weaponId = weapon.id;
    const used = new Set<string>();
    member.weaponResonanceIds = weapon.guideOptions!.resonanceSlots!.map(slot => {
      const choice = slot.choices.find(choice => isAllowed(choice) && !used.has(choice.resonanceId));
      if (!choice) throw new Error(`样本武器共鸣选项不足：${weapon.id}`);
      used.add(choice.resonanceId);
      return choice.resonanceId;
    });
    const memories = entries.filter(entry => entry.category === 'memory' && entry.guideOptions?.memoryStar === 6 && entry.guideOptions.characterType === character.guideOptions!.characterType && entry.guideOptions?.memorySites?.length === 6 && entry.guideOptions.resonanceSlots?.length === 2 && entry.guideOptions.resonanceSlots.every(slot => slot.choices.some(isAllowed)))
      .sort((a, b) => Number(b.relatedIds.includes(character.id)) - Number(a.relatedIds.includes(character.id)));
    if (memories.length < 2) throw new Error('样本意识组合不足');
    member.memories = index === 1 ? [{ memoryId: memories[0].id, count: 6 }] : [{ memoryId: memories[0].id, count: 4 }, { memoryId: memories[1].id, count: 2 }];
    for (const [side, slot] of [['upper', 1], ['lower', 2]] as const) {
      const choices = memories[0].guideOptions!.resonanceSlots!.find(value => value.slot === slot)!.choices.filter(choice => isAllowed(choice) && member.memories.every(memory => byId.get(memory.memoryId)!.guideOptions!.resonanceSlots!.find(value => value.slot === slot)!.choices.some(other => other.resonanceId === choice.resonanceId && isAllowed(other))));
      const ultimate = side === 'lower' ? choices.find(choice => byId.get(choice.resonanceId)?.catalog?.facets.skillType?.includes('必杀技能')) : undefined;
      const resonance = ultimate ?? choices.find(choice => choice.characterIds.includes(character.id)) ?? choices[0];
      if (!resonance) throw new Error(`样本意识没有可共同分配的${side}位共鸣`);
      member.memoryResonance[side] = [{ resonanceId: resonance.resonanceId, count: 6 }];
    }
    const level = weapon.guideOptions!.harmonizationLevels!.find(level => !level.characterIds.length || level.characterIds.includes(character.id))!;
    member.harmonization = { level: level.level, memoryId: level.memoryIds.find(id => member.memories.some(memory => memory.memoryId === id)) ?? level.memoryIds[0] };
    const pet = partners.find(entry => entry.relatedIds.includes(character.id)) ?? partners.find(entry => entry.catalog?.facets.element?.includes(character.element)) ?? partners[0];
    if (!pet) throw new Error('真实攻略样本需要辅助机');
    const quality = pet.guideOptions!.partnerQualities!.at(-1)!;
    const activeIds = new Set(pet.guideOptions!.activeSkillGroups![0].skillIds);
    const active = pet.sections.find(section => section.skill && activeIds.has(section.skill.id) && section.skill.element?.name === character.element) ?? pet.sections.find(section => section.skill && activeIds.has(section.skill.id));
    if (!active?.skill) throw new Error('样本辅助机缺少主动技能');
    member.pet = { petId: pet.id, quality: quality.quality, activeSkillId: active.skill.id, passiveSkillIds: pet.guideOptions!.passiveSkillIds!.slice(0, quality.passiveSlots) };
    member.notes = `第 ${index + 1} 名成员配置`;
    return member;
  });
  guide.team.starterMemberId = guide.team.members[0].id;
  guide.team.captainMemberId = guide.team.members[1].id;
  guide.team.effectIds = [...new Set(selected.flatMap(entry => entry.guideOptions!.effectIds ?? []))];
  let nextId = 0;
  const node = (type: FlowNodeType) => createFlowNode(type, `fixture-node-${++nextId}`);
  const [first, second, third] = guide.team.members;
  const attack = node('attack');
  attack.press = 'hold';
  attack.notes = '长按普攻时同时触发后台成员 QTE';
  const qte = node('qte');
  qte.qteMemberIds = [second.id, third.id, second.id];
  const otherQte = node('qte');
  otherQte.qteMemberIds = [third.id, third.id];
  attack.branches = [[qte], [otherQte]];
  const skills = (['red', 'yellow', 'blue', 'special', 'ultimate'] as const).map((skill, index) => ({ ...node('skill'), skill, press: index % 2 ? 'hold' as const : 'tap' as const }));
  const dodge = node('dodge');
  const holdDodge = { ...node('dodge'), press: 'hold' as const };
  const switchSecond = { ...node('switch'), memberId: second.id };
  const laterQte = { ...node('qte'), qteMemberIds: [first.id, third.id, first.id] };
  const switchThird = { ...node('switch'), memberId: third.id };
  const finalAttack = node('attack');
  const reset = { ...node('switch'), memberId: first.id };
  guide.flow = { mode: 'loop', nodes: [attack, ...skills, dodge, holdDodge, switchSecond, laterQte, switchThird, finalAttack, reset] };
  return guide;
};
