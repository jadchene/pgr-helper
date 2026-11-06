import type { CatalogEntry, EntryView } from '../shared/types';
import type { SelectOption } from 'naive-ui';
import type { GuideEntryOptions } from '../shared/guide-options';
import { teamPositions, type GuideMember, type GuideTeam, type TeamPosition } from '../shared/guides';

/** 下拉选项及当前组合的可分配数量。 @author chenjd @created 2026-11-06 17:40:00 */
export interface GuideChoice extends SelectOption {
  /** 展示名称。 */ label: string;
  /** 基础资料或技能标识。 */ value: string;
  /** 保留已选失效值，但不允许再次选择。 */ disabled?: boolean;
  /** 当前搭配最多可分配的数量。 */ maxCount?: number;
}
/** 一图流中的基础与谐振合并件数。 @author chenjd @created 2026-11-06 17:40:00 */
export interface GuideMemorySummary {
  /** 意识标识。 */ memoryId: string;
  /** 基础六件中的数量。 */ baseCount: number;
  /** 谐振增加的计数。 */ bonusCount: number;
  /** 用于套装效果的总计数。 */ totalCount: number;
}

/** 跨组件读取已同步的攻略选项。 */
export const guideOptions = (entry: CatalogEntry | undefined): GuideEntryOptions | undefined => entry?.guideOptions;

/** 只复制可持久化字段，避免 Vue 代理影响结构复制。 */
export const cloneGuideTeam = (team: GuideTeam): GuideTeam => JSON.parse(JSON.stringify(team)) as GuideTeam;

/** 保持成员稳定标识，交换站位不改变首发、队长或节点引用。 */
export const swapGuidePosition = (team: GuideTeam, memberId: string, position: TeamPosition): GuideTeam => {
  const result = cloneGuideTeam(team);
  const member = result.members.find(item => item.id === memberId);
  if (!member) return result;
  const other = result.members.find(item => item.id !== memberId && item.position === position);
  if (other) other.position = member.position;
  member.position = position;
  return result;
};

/** 站位顺序固定为蓝、红、黄，成员对象仍保留原身份。 */
export const orderedGuideMembers = (team: GuideTeam): GuideMember[] => [...team.members].sort((left, right) => teamPositions.indexOf(left.position) - teamPositions.indexOf(right.position));

/** 缺失或隐藏资料保留原选择，供用户明确修正。 */
export const preserveGuideChoices = (choices: GuideChoice[], selectedIds: string[], entries: readonly CatalogEntry[] = []): GuideChoice[] => {
  const result = [...choices];
  const present = new Set(result.map(choice => choice.value));
  for (const id of selectedIds.filter(Boolean)) {
    if (present.has(id)) continue;
    const entry = entries.find(item => item.id === id);
    result.push({ value: id, label: `${entry?.name || '原选择'}（当前不可用）`, disabled: true });
    present.add(id);
  }
  return result;
};

/** 在基础资料中选择可见条目，不隐藏当前已经选择的失效项。 */
export const guideCatalogChoices = (entries: readonly EntryView[], category: CatalogEntry['category'], selectedIds: string[] = [], allowed?: (entry: EntryView) => boolean): GuideChoice[] => {
  const choices = entries.filter(entry => entry.category === category && !entry.hidden && !entry.retired && (!allowed || allowed(entry)))
    .map(entry => ({ value: entry.id, label: entry.name }));
  return preserveGuideChoices(choices, selectedIds, entries);
};

/** 仅按照共鸣池的明确机体适用关系筛选。 */
export const allowedGuideResonances = (entry: CatalogEntry | undefined, slot: number, characterId: string): string[] => guideOptions(entry)?.resonanceSlots?.find(item => item.slot === slot)?.choices
  .filter(choice => !choice.characterIds.length || choice.characterIds.includes(characterId)).map(choice => choice.resonanceId) ?? [];

/** 武器技能共鸣不可跨槽重复，属性共鸣仍按来源允许重复选择。 */
export const weaponResonanceChoices = (member: GuideMember, entries: readonly CatalogEntry[], slot: number): GuideChoice[] => {
  const weapon = entries.find(entry => entry.id === member.weaponId);
  const current = member.weaponResonanceIds[slot - 1] || '';
  const choices = allowedGuideResonances(weapon, slot, member.characterId).map(id => {
    const occupied = id !== current && id.startsWith('resonance:weapon-skill-') && member.weaponResonanceIds.some((selected, index) => index !== slot - 1 && selected === id);
    return { value: id, label: `${entries.find(entry => entry.id === id)?.name || '共鸣资料不可用'}${occupied ? '（已在其他槽配置）' : ''}`, disabled: occupied };
  });
  return preserveGuideChoices(choices, [current], entries);
};

/** 只有来源提供明确技能类型时才补充分类，实际技能名称始终保留。 */
export const guideResonanceLabel = (entry: CatalogEntry | undefined): string => {
  if (!entry) return '共鸣资料不可用';
  const types = [...new Set(entry.catalog?.facets.skillType?.filter(value => value.trim() && value !== '未提供' && value !== entry.name) ?? [])];
  return types.length ? `${types.join(' / ')} · ${entry.name}` : entry.name;
};

/** 每侧按意识件数汇总共鸣容量，混搭保留并集而非仅保留交集。 */
export const memoryResonanceChoices = (member: GuideMember, entries: readonly CatalogEntry[], side: 'upper' | 'lower'): GuideChoice[] => {
  const countById = new Map<string, number>();
  for (const allocation of member.memories) {
    const memory = entries.find(entry => entry.id === allocation.memoryId && entry.category === 'memory');
    for (const id of new Set(allowedGuideResonances(memory, side === 'upper' ? 1 : 2, member.characterId))) {
      countById.set(id, (countById.get(id) ?? 0) + allocation.count);
    }
  }
  const choices = [...countById.entries()].map(([id, count]) => ({ value: id, label: `${guideResonanceLabel(entries.find(entry => entry.id === id))}${count < 6 ? ` · 最多 ${count} 次` : ''}`, maxCount: count }));
  return preserveGuideChoices(choices, member.memoryResonance[side].map(item => item.resonanceId), entries).map(choice => choice.disabled
    ? { ...choice, label: `${guideResonanceLabel(entries.find(entry => entry.id === choice.value))}（当前不可用）` }
    : choice);
};

/** 谐振计数按源阶段读取，不把等级当作额外意识件数。 */
export const guideMemorySummary = (member: GuideMember, entries: readonly CatalogEntry[]): GuideMemorySummary[] => {
  const result = new Map<string, GuideMemorySummary>();
  for (const allocation of member.memories) {
    if (!allocation.memoryId) continue;
    const item = result.get(allocation.memoryId) ?? { memoryId: allocation.memoryId, baseCount: 0, bonusCount: 0, totalCount: 0 };
    item.baseCount += allocation.count;
    result.set(item.memoryId, item);
  }
  const weapon = entries.find(entry => entry.id === member.weaponId);
  const stage = guideOptions(weapon)?.harmonizationLevels?.find(item => item.level === member.harmonization.level);
  if (stage && member.harmonization.memoryId) {
    const id = member.harmonization.memoryId;
    const item = result.get(id) ?? { memoryId: id, baseCount: 0, bonusCount: 0, totalCount: 0 };
    item.bonusCount += stage.bonusPieces;
    result.set(id, item);
  }
  return [...result.values()].map(item => ({ ...item, totalCount: item.baseCount + item.bonusCount }));
};

/** 进化阶段来自当前机体选项，不能回退到基础资料初始品级。 */
export const guideEvolutionLabel = (member: GuideMember, entries: readonly CatalogEntry[]): string => {
  if (!member.evolutionId) return '未选进化阶段';
  return guideOptions(entries.find(entry => entry.id === member.characterId))?.evolutionStages?.find(stage => stage.id === member.evolutionId)?.label ?? '原进化阶段不可用';
};

/** 辅助机技能显示名称及属性，不把资料等级当作玩家实际培养等级。 */
export const guidePetSkillLabel = (pet: CatalogEntry | undefined, id: string): string => {
  if (!id) return '未配置';
  const section = pet?.sections.find(item => item.skill?.id === id);
  if (!section) return '原技能暂不可用';
  return [section.title, section.skill?.element?.name].filter(Boolean).join(' · ');
};
