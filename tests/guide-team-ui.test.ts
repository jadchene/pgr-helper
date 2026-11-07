import { describe, expect, it } from 'vitest';
import type { CatalogEntry, EntryView } from '../src/shared/types';
import { createGuideMember, type GuideTeam } from '../src/shared/guides';
import { guideCatalogChoices, guideEvolutionLabel, guideMemorySummary, guidePetSkillLabel, guideResonanceLabel, matchesGuideFilters, memoryResonanceChoices, orderedGuideMembers, swapGuidePosition, weaponResonanceChoices } from '../src/renderer/guide-team';

/** 构造只包含本次配置语义的独立资料。 */
const entry = (id: string, changes: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id, category: 'memory', name: id, subtitle: '', description: '', aliases: [], tags: [], element: '', profession: '', rarity: '', image: '',
  attributes: {}, sections: [], relatedIds: [], sourceKey: id, ...changes,
});
/** 添加资料状态用于筛选可选条目。 */
const view = (value: CatalogEntry, changes: Partial<EntryView> = {}): EntryView => ({ ...value, origin: 'source', modified: false, hidden: false, retired: false, updatedAt: '', ...changes });

describe('攻略队伍配置与一图流', () => {
  it('优先关联装备，其次同属性，再按来源新旧排列；标签过滤保留有效已选项', () => {
    const character = view(entry('character:dark', { category: 'character', element: '暗', relatedIds: ['memory:dedicated'] }));
    const make = (id: string, order: number, tags: string[] = []) => view(entry(id, { tags, catalog: { order: [order], basis: 'source-priority', facets: { purpose: tags } } }));
    const entries = [character, make('memory:generic', 100), make('memory:dark-old', 30, ['暗']), make('memory:dedicated', 10), make('memory:dark-new', 40, ['暗'])];
    const options = guideCatalogChoices(entries, 'memory', [], undefined, { characterId: character.id });
    expect(options.map(item => item.value)).toEqual(['memory:dedicated', 'memory:dark-new', 'memory:dark-old', 'memory:generic']);
    const filtered = guideCatalogChoices(entries, 'memory', ['memory:generic'], undefined, { characterId: character.id, facets: { purpose: '暗' } });
    expect(filtered.map(item => item.value)).toEqual(['memory:dark-new', 'memory:dark-old', 'memory:generic']);
    expect(filtered.every(item => !item.disabled)).toBe(true);
  });
  it('属性、职业、品级等条件独立匹配，不混用标签，同字段清空后解除限制', () => {
    const value = entry('character:1', { category: 'character', element: '暗', profession: '进攻型', rarity: 'S', tags: ['辅助型'], catalog: { order: [1], basis: 'source-priority', facets: { frameType: ['泛用机体'], effect: ['观测者'] } } });
    expect(matchesGuideFilters(value, { element: '暗', profession: '进攻型', rarity: 'S', frameType: '泛用机体' })).toBe(true);
    expect(matchesGuideFilters(value, { profession: '辅助型' })).toBe(false);
    expect(matchesGuideFilters(value, { element: '观测者' })).toBe(false);
    expect(matchesGuideFilters(value, { element: null, effect: '观测者' })).toBe(true);
    expect(matchesGuideFilters(value, {})).toBe(true);
  });
  it('下拉沿用图鉴来源倒序，不被名称或输入顺序覆盖，失效选择仍保留', () => {
    const older = view(entry('character:older', { category: 'character', name: 'A旧机体', catalog: { order: [10], basis: 'source-priority', facets: {} } }));
    const newer = view(entry('character:newer', { category: 'character', name: 'Z新机体', catalog: { order: [100], basis: 'source-priority', facets: {} } }));
    const source = [older, newer];
    expect(guideCatalogChoices(source, 'character', ['character:missing']).map(choice => choice.value)).toEqual(['character:newer', 'character:older', 'character:missing']);
    expect(source.map(item => item.id)).toEqual(['character:older', 'character:newer']);
  });

  it('交换站位不改变成员ID、首发、队长和原对象', () => {
    const blue = { ...createGuideMember('blue', 'member-blue'), characterId: 'character:1', notes: '保留配置' };
    const red = { ...createGuideMember('red', 'member-red'), characterId: 'character:2' };
    const team: GuideTeam = { members: [red, blue], starterMemberId: blue.id, captainMemberId: red.id, effectIds: [] };
    const swapped = swapGuidePosition(team, blue.id, 'red');
    expect(team.members[1].position).toBe('blue');
    expect(swapped.members.find(member => member.id === blue.id)).toMatchObject({ position: 'red', notes: '保留配置', characterId: 'character:1' });
    expect(swapped.members.find(member => member.id === red.id)?.position).toBe('blue');
    expect(swapped.starterMemberId).toBe(blue.id);
    expect(swapped.captainMemberId).toBe(red.id);
    expect(orderedGuideMembers(swapped).map(member => member.id)).toEqual([red.id, blue.id]);
  });

  it('隐藏、退役或不适配的旧选择可见且不可再选，不重复添加', () => {
    const entries = [view(entry('memory:1')), view(entry('memory:2'), { hidden: true }), view(entry('memory:3'), { retired: true })];
    const choices = guideCatalogChoices(entries, 'memory', ['memory:2', 'memory:2', 'memory:missing']);
    expect(choices.map(choice => choice.value)).toEqual(['memory:1', 'memory:2', 'memory:missing']);
    expect(choices[1]).toMatchObject({ disabled: true, label: 'memory:2（当前不可用）' });
    expect(choices[2].disabled).toBe(true);
  });

  it('意识混搭保留共鸣并集及准确容量，并按当前角色、上下位过滤', () => {
    const member = createGuideMember('blue', 'member');
    member.characterId = 'character:a';
    member.memories = [{ memoryId: 'memory:one', count: 4 }, { memoryId: 'memory:two', count: 2 }];
    member.memoryResonance.upper = [{ resonanceId: 'resonance:stale', count: 1 }];
    const choices = [{ resonanceId: 'resonance:common', characterIds: [] }, { resonanceId: 'resonance:role', characterIds: ['character:a'] }, { resonanceId: 'resonance:other', characterIds: ['character:b'] }];
    const entries = [
      entry('memory:one', { guideOptions: { resonanceSlots: [{ slot: 1, choices }, { slot: 2, choices: [{ resonanceId: 'resonance:lower', characterIds: [] }] }] } }),
      entry('memory:two', { guideOptions: { resonanceSlots: [{ slot: 1, choices: [choices[0]] }] } }),
      ...['common', 'role', 'other', 'lower', 'stale'].map(name => entry(`resonance:${name}`, { category: 'resonance', name })),
    ];
    const upper = memoryResonanceChoices(member, entries, 'upper');
    expect(upper.map(choice => [choice.value, choice.maxCount, choice.disabled ?? false])).toEqual([
      ['resonance:common', 6, false], ['resonance:role', 4, false], ['resonance:stale', undefined, true],
    ]);
    expect(memoryResonanceChoices(member, entries, 'lower').map(choice => [choice.value, choice.maxCount])).toEqual([['resonance:lower', 4]]);
  });

  it('谐振七阶仍按来源增加两件，合并同套装并保留基础件数', () => {
    const member = createGuideMember('blue', 'member');
    member.memories = [{ memoryId: 'memory:a', count: 4 }, { memoryId: 'memory:b', count: 2 }];
    member.weaponId = 'weapon:1';
    member.harmonization = { level: 7, memoryId: 'memory:b' };
    const entries = [entry('weapon:1', { category: 'weapon', guideOptions: { harmonizationLevels: [{ level: 7, label: '来源阶段', description: '', bonusPieces: 2, memoryIds: ['memory:b'], characterIds: [] }] } })];
    expect(guideMemorySummary(member, entries)).toEqual([
      { memoryId: 'memory:a', baseCount: 4, bonusCount: 0, totalCount: 4 },
      { memoryId: 'memory:b', baseCount: 2, bonusCount: 2, totalCount: 4 },
    ]);
    expect(member.memories[1].count).toBe(2);
  });

  it('进化SSS3取实际选择，不使用基础图鉴的S初始品级', () => {
    const member = createGuideMember('blue', 'member');
    member.characterId = 'character:1';
    member.evolutionId = '5:3';
    const entries = [entry('character:1', { category: 'character', rarity: 'S', guideOptions: { evolutionStages: [{ id: '5:3', label: 'SSS3', quality: 5, phase: 3, effectSectionIds: [] }] } })];
    expect(guideEvolutionLabel(member, entries)).toBe('SSS3');
    member.evolutionId = '5:4';
    expect(guideEvolutionLabel(member, entries)).toBe('原进化阶段不可用');
  });

  it('辅助机携带技能只显示名称与属性，不把源最高等级当作玩家等级', () => {
    const pet = entry('pet:1', { category: 'pet', sections: [{ title: '源技能名称', body: '独立版本效果', skill: { kind: 'pet-active', id: 'variant-ice', groupId: 'active', groupName: '主动技能', groupOrder: 1, familyId: 'family', familyName: '主动技能 1', typeName: '主动', level: 5, element: { id: 3, name: '冰' } } }] });
    expect(guidePetSkillLabel(pet, 'variant-ice')).toBe('源技能名称 · 冰');
    const titled = { ...pet, sections: pet.sections.map(section => ({ ...section, title: `${section.title}·冰` })) };
    expect(guidePetSkillLabel(titled, 'variant-ice')).toBe('源技能名称·冰');
    expect(guidePetSkillLabel(pet, 'missing')).toBe('原技能暂不可用');
  });

  it('意识共鸣按真实类型标明必杀等分类，无依据时不猜测类型', () => {
    const resonance = entry('resonance:skill', { category: 'resonance', name: '闪影挽空', catalog: { order: [1], basis: 'definition', facets: { skillType: ['必杀技能', '必杀技能'] } } });
    expect(guideResonanceLabel(resonance)).toBe('必杀技能 · 闪影挽空');
    expect(guideResonanceLabel({ ...resonance, catalog: undefined })).toBe('闪影挽空');
    expect(guideResonanceLabel({ ...resonance, catalog: { ...resonance.catalog!, facets: { skillType: ['未提供'] } } })).toBe('闪影挽空');
    const member = createGuideMember('blue', 'member');
    member.memories = [{ memoryId: 'memory:1', count: 6 }];
    const memory = entry('memory:1', { guideOptions: { resonanceSlots: [{ slot: 2, choices: [{ resonanceId: resonance.id, characterIds: [] }] }] } });
    expect(memoryResonanceChoices(member, [memory, resonance], 'lower')[0].label).toBe('必杀技能 · 闪影挽空');
  });

  it('其他槽已选武器技能不可再选，当前槽和可重复属性共鸣仍可操作', () => {
    const member = createGuideMember('blue', 'member');
    member.characterId = 'character:1';
    member.weaponId = 'weapon:1';
    const skillId = 'resonance:weapon-skill-1';
    const attributeId = 'resonance:attribute-pool-1';
    member.weaponResonanceIds = [skillId, attributeId, ''];
    const choices = [skillId, attributeId].map(resonanceId => ({ resonanceId, characterIds: [] }));
    const entries = [entry('weapon:1', { category: 'weapon', guideOptions: { resonanceSlots: [1, 2, 3].map(slot => ({ slot, choices })) } }), entry(skillId, { category: 'resonance', name: '技能共鸣' }), entry(attributeId, { category: 'resonance', name: '属性共鸣' })];
    expect(weaponResonanceChoices(member, entries, 3)).toEqual([
      { value: skillId, label: '技能共鸣（已在其他槽配置）', disabled: true },
      { value: attributeId, label: '属性共鸣', disabled: false },
    ]);
    expect(weaponResonanceChoices(member, entries, 1)[0]).toMatchObject({ value: skillId, disabled: false });
    member.weaponResonanceIds[1] = skillId;
    expect(weaponResonanceChoices(member, entries, 1)[0]).toMatchObject({ value: skillId, disabled: false });
  });
});
