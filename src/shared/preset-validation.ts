import type { CatalogEntry } from './types';
import type { PresetDocument } from './presets';
import { createGuideMember } from './guides';
import { validateGuideTeam } from './guide-validation';

/** 保存预设时检查已填写的配置；通用技能在引入具体机体后再次校验。 */
export const validatePreset = (preset: PresetDocument, source: readonly CatalogEntry[]): string[] => {
  const issues: string[] = [];
  const entries = new Map(source.map(entry => [entry.id, entry]));
  const member = createGuideMember('blue', 'preset-validation');
  if (preset.kind !== 'memory') member.pet = preset.pet;
  if (preset.kind === 'character') Object.assign(member, {
    characterId: preset.characterId, evolutionId: preset.evolutionId, weaponId: preset.weaponId,
    weaponResonanceIds: preset.weaponResonanceIds,
  });
  const checkMember = (): string[] => validateGuideTeam({ members: [member], starterMemberId: member.id, captainMemberId: member.id, effectIds: [] }, source, false).map(issue => issue.message);
  issues.push(...checkMember());
  const sets = preset.kind === 'character' ? preset.memorySets : preset.kind === 'memory' ? [{ ...preset.memory, name: preset.name }] : [];
  for (const set of sets) {
    const add = (message: string): void => { issues.push(`${set.name}：${message}`); };
    if (preset.kind === 'character') {
      member.memories = set.memories;
      member.harmonization = { level: preset.harmonizationLevel, memoryId: set.harmonizationMemoryId };
      for (const side of ['upper', 'lower'] as const) {
        member.memoryResonance[side] = set.resonance[side].filter(item => item.kind === 'entry').map(item => ({ resonanceId: item.value, count: item.count }));
        if (set.resonance[side].some(item => item.kind !== 'entry')) add('机体预设应选择具体共鸣技能。');
      }
      checkMember().forEach(add);
      continue;
    }
    if (new Set(set.memories.map(item => item.memoryId)).size !== set.memories.length) add('相同意识请合并件数。');
    for (const allocation of set.memories) {
      const entry = entries.get(allocation.memoryId);
      if (!entry || entry.category !== 'memory') add('请选择有效的意识。');
      else if (entry.guideOptions?.memorySites && allocation.count > entry.guideOptions.memorySites.length) add(`${entry.name}没有足够的实际号位。`);
    }
    if (set.harmonizationMemoryId && entries.get(set.harmonizationMemoryId)?.category !== 'memory') add('谐振意识已不可用。');
    for (const side of ['upper', 'lower'] as const) {
      const pieces = set.memories.flatMap(allocation => {
        const choices = entries.get(allocation.memoryId)?.guideOptions?.resonanceSlots?.find(slot => slot.slot === (side === 'upper' ? 1 : 2))?.choices || [];
        const values = new Set(choices.flatMap(choice => choice.characterIds.length
          ? (entries.get(choice.resonanceId)?.catalog?.facets.skillType || []).map(type => `skillType:${type}`)
          : [`entry:${choice.resonanceId}`]));
        return Array.from({ length: allocation.count }, () => values);
      });
      const requests = set.resonance[side].flatMap(item => Array<string>(item.count).fill(`${item.kind}:${item.value}`));
      const assigned = Array<number>(pieces.length).fill(-1);
      const match = (request: number, visited: Set<number>): boolean => {
        for (let index = 0; index < pieces.length; index++) {
          if (visited.has(index) || !pieces[index].has(requests[request])) continue;
          visited.add(index);
          if (assigned[index] < 0 || match(assigned[index], visited)) { assigned[index] = request; return true; }
        }
        return false;
      };
      if (!requests.every((_, index) => match(index, new Set()))) add(`${side === 'upper' ? '上位' : '下位'}共鸣的类型或数量不适用于所选意识。`);
    }
  }
  return [...new Set(issues)];
};
