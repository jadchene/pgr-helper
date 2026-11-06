import type { EntrySection, SkillSectionMetadata } from '../shared/types';

/** 带有明确源分类的技能段落。 */
export type SkillSection = EntrySection & { skill: SkillSectionMetadata };

/** 一条完整技能说明及其切换标签。 @author chenjd @created 2026-11-06 15:54:00 */
export interface SkillVariant {
  /** 由源标识生成的稳定键，不依赖技能标题。 */ key: string;
  /** 属性、升阶阶段或中性的版本标签。 */ label: string;
  /** 原段落引用，正文不裁剪或合并。 */ section: SkillSection;
}

/** 上游定义的逻辑技能家族。 @author chenjd @created 2026-11-06 15:54:00 */
export interface SkillFamily {
  /** 原始家族标识。 */ id: string;
  /** 在当前分组中唯一的选择键。 */ key: string;
  /** 上游家族名称。 */ name: string;
  /** 保持来源顺序的全部说明。 */ variants: SkillVariant[];
}

/** 由来源提供的技能大类。 @author chenjd @created 2026-11-06 15:54:00 */
export interface SkillGroup {
  /** 原始大类标识。 */ id: string;
  /** 包含来源种类的大类选择键。 */ key: string;
  /** 来源大类名称。 */ name: string;
  /** 来源大类顺序。 */ order: number;
  /** 按首次出现顺序保留的逻辑技能。 */ families: SkillFamily[];
}

/** 当前技能定位，仅保存稳定标识。 @author chenjd @created 2026-11-06 15:54:00 */
export interface SkillSelection {
  /** 当前大类键。 */ groupKey: string;
  /** 当前家族键。 */ familyKey: string;
  /** 当前变体键。 */ variantKey: string;
}

/** 从最新数据解析出的有效选择。 @author chenjd @created 2026-11-06 15:54:00 */
export interface SelectedSkill {
  /** 最新大类数据。 */ group: SkillGroup;
  /** 最新家族数据。 */ family: SkillFamily;
  /** 最新说明数据。 */ variant: SkillVariant;
}

/** 用明确属性或阶段区分变体，同类同名时只按来源顺序编号。 */
const labelVariants = (variants: SkillVariant[]): void => {
  const types = new Set(variants.map(variant => variant.section.skill.typeName));
  const labels = variants.map((variant, index) => variant.section.skill.element?.name
    ?? (types.size > 1 ? variant.section.skill.typeName : `技能版本 ${index + 1}`));
  const occurrences = new Map<string, number>();
  for (const [index, variant] of variants.entries()) {
    const label = labels[index];
    const occurrence = (occurrences.get(label) ?? 0) + 1;
    occurrences.set(label, occurrence);
    variant.label = labels.filter(value => value === label).length > 1 ? `${label} · 技能版本 ${occurrence}` : label;
  }
};

/** 只依据技能元数据分组；普通正文由调用方保留，不以名称猜测归属。 */
export const groupSkillSections = (sections: readonly EntrySection[]): SkillGroup[] => {
  const groups = new Map<string, SkillGroup>();
  const families = new Map<string, SkillFamily>();
  const occurrences = new Map<string, number>();
  for (const section of sections) {
    if (!section.skill) continue;
    const skill = section.skill;
    const groupKey = JSON.stringify([skill.kind, skill.groupId]);
    let group = groups.get(groupKey);
    if (!group) {
      group = { id: skill.groupId, key: groupKey, name: skill.groupName, order: skill.groupOrder, families: [] };
      groups.set(groupKey, group);
    }
    const familyKey = JSON.stringify([groupKey, skill.familyId]);
    let family = families.get(familyKey);
    if (!family) {
      family = { id: skill.familyId, key: familyKey, name: skill.familyName, variants: [] };
      families.set(familyKey, family);
      group.families.push(family);
    }
    const sourceKey = JSON.stringify([familyKey, skill.id]);
    const occurrence = occurrences.get(sourceKey) ?? 0;
    occurrences.set(sourceKey, occurrence + 1);
    // 即使输入重复了源 ID，也保留每条正文；正常源记录的键不会随标题编辑变化。
    family.variants.push({ key: JSON.stringify([sourceKey, occurrence]), label: '', section: section as SkillSection });
  }
  for (const family of families.values()) labelVariants(family.variants);
  return [...groups.values()].sort((left, right) => left.order - right.order);
};

/** 解析最新资料中的选择；分组、家族或变体消失时分别回退到首个有效项。 */
export const resolveSkillSelection = (groups: readonly SkillGroup[], selection: SkillSelection | null): SelectedSkill | null => {
  const group = groups.find(item => item.key === selection?.groupKey) ?? groups[0];
  if (!group) return null;
  const family = group.families.find(item => item.key === selection?.familyKey) ?? group.families[0];
  if (!family) return null;
  const variant = family.variants.find(item => item.key === selection?.variantKey) ?? family.variants[0];
  return variant ? { group, family, variant } : null;
};

/** 将有效选择保存为标识，不把已编辑前的段落对象留在状态中。 */
export const skillSelectionKeys = (selection: SelectedSkill): SkillSelection => ({
  groupKey: selection.group.key,
  familyKey: selection.family.key,
  variantKey: selection.variant.key,
});
