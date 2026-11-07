import type { CatalogEntry } from '../shared/types';
import type { GuideMember, ResonanceAllocation } from '../shared/guides';
import type { CharacterPreset, PresetDocument, PresetMemorySet } from '../shared/presets';
import { allowedGuideResonances } from './guide-team';
import { compareCatalogEntries } from './catalog-query';

/** 预设来自响应式页面，复制可持久化字段时剥离 Vue 代理。 */
const copyConfiguration = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** 按明确机体关联选择默认专用装备，不把任意同属性装备当作专用。 */
export const presetCharacterDefaults = (characterId: string, entries: readonly CatalogEntry[]) => {
  const character = entries.find(entry => entry.id === characterId && entry.category === 'character');
  if (!character) return { weaponId: '', petId: '' };
  const related = entries.filter(entry => !('hidden' in entry && entry.hidden) && !('retired' in entry && entry.retired) && (character.relatedIds.includes(entry.id) || entry.relatedIds.includes(characterId))).sort(compareCatalogEntries);
  const weapon = related.find(entry => entry.category === 'weapon' && character?.relatedIds.includes(entry.id) && character.guideOptions?.weaponType === entry.guideOptions?.weaponType);
  const pet = related.find(entry => entry.category === 'pet');
  return { weaponId: weapon?.id || '', petId: pet?.id || '' };
};

/** 将当前成员的意识配置保存成独立方案，通用预设把专属技能换成源技能类型。 */
export const presetMemoryFromMember = (member: GuideMember, entries: readonly CatalogEntry[], general: boolean, name = '意识方案 1'): PresetMemorySet => {
  const convert = (side: 'upper' | 'lower') => member.memoryResonance[side].map(item => {
    const entry = entries.find(entry => entry.id === item.resonanceId);
    const types = entry?.catalog?.facets.skillType?.filter(value => value && value !== '未提供') ?? [];
    return general && types.length === 1
      ? { kind: 'skillType' as const, value: types[0], count: item.count }
      : { kind: 'entry' as const, value: item.resonanceId, count: item.count };
  });
  return { id: crypto.randomUUID(), name, memories: copyConfiguration(member.memories), resonance: { upper: convert('upper'), lower: convert('lower') }, harmonizationMemoryId: member.harmonization.memoryId };
};

/** 引入预设生成独立草稿；匹配失败返回问题，调用方应保留原成员直到用户确认调整。 */
export const applyPresetConfiguration = (preset: PresetDocument, setId: string, target: GuideMember, entries: readonly CatalogEntry[]): { member: GuideMember; issues: string[] } => {
  const member: GuideMember = JSON.parse(JSON.stringify(target));
  const issues: string[] = [];
  const memory = preset.kind === 'character' ? preset.memorySets.find(item => item.id === setId) : preset.kind === 'memory' ? preset.memory : undefined;
  if (preset.kind === 'character') {
    member.characterId = preset.characterId;
    member.evolutionId = preset.evolutionId;
    member.weaponId = preset.weaponId;
    member.weaponResonanceIds = [...preset.weaponResonanceIds];
    member.harmonization.level = preset.harmonizationLevel;
  }
  if (preset.kind !== 'memory') member.pet = copyConfiguration(preset.pet);
  if (preset.kind === 'character' && !memory) issues.push('意识方案已不存在，请重新选择。');
  if (memory) {
    member.memories = copyConfiguration(memory.memories);
    member.harmonization.memoryId = memory.harmonizationMemoryId;
    for (const side of ['upper', 'lower'] as const) {
      const allowed = new Set(member.memories.flatMap(item => allowedGuideResonances(entries.find(entry => entry.id === item.memoryId), side === 'upper' ? 1 : 2, member.characterId)));
      const allocations: ResonanceAllocation[] = [];
      for (const allocation of memory.resonance[side]) {
        const matches = allocation.kind === 'entry' ? [...allowed].filter(id => id === allocation.value)
          : entries.filter(entry => allowed.has(entry.id) && entry.catalog?.facets.skillType?.includes(allocation.value)).map(entry => entry.id);
        if (matches.length !== 1) {
          issues.push(`${side === 'upper' ? '上位' : '下位'}共鸣“${allocation.value}”${matches.length ? '有多个候选，请手动选择' : '不适用于当前机体与意识'}。`);
          continue;
        }
        const existing = allocations.find(item => item.resonanceId === matches[0]);
        if (existing) existing.count += allocation.count;
        else allocations.push({ resonanceId: matches[0], count: allocation.count });
      }
      member.memoryResonance[side] = allocations;
    }
  }
  return { member, issues };
};

/** 更新机体共享配置与当前意识方案；关闭谐振时清理所有方案中隐藏的绑定。 */
export const updateCharacterPresetFromMember = (preset: CharacterPreset, member: GuideMember, setId: string, entries: readonly CatalogEntry[]): void => {
  Object.assign(preset, { evolutionId: member.evolutionId, weaponId: member.weaponId, weaponResonanceIds: [...member.weaponResonanceIds], harmonizationLevel: member.harmonization.level, pet: copyConfiguration(member.pet) });
  const current = preset.memorySets.find(set => set.id === setId);
  if (current) {
    const converted = presetMemoryFromMember(member, entries, false, current.name);
    Object.assign(current, { memories: converted.memories, resonance: converted.resonance, harmonizationMemoryId: converted.harmonizationMemoryId });
  }
  if (!preset.harmonizationLevel) for (const set of preset.memorySets) set.harmonizationMemoryId = '';
};
