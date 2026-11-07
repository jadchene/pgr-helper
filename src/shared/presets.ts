import type { GuideMember, MemoryAllocation } from './guides';

/** 来源共鸣或可跨机体匹配的技能类型。 @author chenjd @created 2026-11-07 11:00:00 */
export interface PresetResonance {
  /** 条目或技能类型。 */ kind: 'entry' | 'skillType';
  /** 来源标识或类型名称。 */ value: string;
  /** 同侧次数。 */ count: number;
}
/** 独立意识配置。 @author chenjd @created 2026-11-07 11:00:00 */
export interface PresetMemory {
  /** 基础意识件数。 */ memories: MemoryAllocation[];
  /** 上下位共鸣。 */ resonance: { upper: PresetResonance[]; lower: PresetResonance[] };
  /** 谐振绑定意识。 */ harmonizationMemoryId: string;
}
/** 机体的命名意识方案。 @author chenjd @created 2026-11-07 11:00:00 */
export interface PresetMemorySet extends PresetMemory {
  /** 稳定标识。 */ id: string;
  /** 方案名称。 */ name: string;
}
/** 共有记录字段。 @author chenjd @created 2026-11-07 11:00:00 */
interface PresetBase {
  /** 本地标识。 */ id: string;
  /** 名称。 */ name: string;
  /** 备注。 */ notes: string;
}
/** 每个机体直接维护一份培养装备配置。 @author chenjd @created 2026-11-07 11:00:00 */
export interface CharacterPreset extends PresetBase {
  /** 机体预设。 */ kind: 'character';
  /** 机体标识。 */ characterId: string;
  /** 进化阶段。 */ evolutionId: string;
  /** 武器标识。 */ weaponId: string;
  /** 三个武器共鸣槽。 */ weaponResonanceIds: string[];
  /** 武器谐振阶段。 */ harmonizationLevel: number;
  /** 多套意识方案。 */ memorySets: PresetMemorySet[];
  /** 辅助机配置。 */ pet: GuideMember['pet'];
}
/** 通用意识预设直接保存一套配置。 @author chenjd @created 2026-11-07 11:00:00 */
export interface MemoryPreset extends PresetBase {
  /** 意识预设。 */ kind: 'memory';
  /** 意识、共鸣及谐振意识。 */ memory: PresetMemory;
}
/** 通用辅助机预设与意识独立。 @author chenjd @created 2026-11-07 11:00:00 */
export interface PetPreset extends PresetBase {
  /** 辅助机预设。 */ kind: 'pet';
  /** 品级与携带技能。 */ pet: GuideMember['pet'];
}
/** 当前支持的三类预设，不保留旧组合通用格式。 */
export type PresetDocument = CharacterPreset | MemoryPreset | PetPreset;
/** 持久化记录与并发保护元数据。 */
export type PresetRecord = PresetDocument & {
  /** 创建时间。 */ createdAt: string;
  /** 更新时间。 */ updatedAt: string;
  /** 回收状态。 */ hidden: boolean;
  /** 修订号。 */ revision: number;
};
/** 创建空意识配置。 */
export const createPresetMemory = (): PresetMemory => ({ memories: [], resonance: { upper: [], lower: [] }, harmonizationMemoryId: '' });
/** 创建独立命名意识方案。 */
export const createPresetMemorySet = (name = '意识方案 1'): PresetMemorySet => ({ id: crypto.randomUUID(), name, ...createPresetMemory() });
/** 按用途创建预设，不添加无关字段。 */
export const createPreset = <K extends PresetDocument['kind']>(kind: K): Extract<PresetDocument, { kind: K }> => {
  const base = { id: `preset:${crypto.randomUUID()}`, name: '', notes: '' };
  const pet = { petId: '', quality: 0, activeSkillId: '', passiveSkillIds: [] };
  let value: PresetDocument;
  if (kind === 'memory') value = { ...base, kind, memory: createPresetMemory() };
  else if (kind === 'pet') value = { ...base, kind, pet };
  else value = { ...base, kind: 'character', characterId: '', evolutionId: '', weaponId: '', weaponResonanceIds: ['', '', ''], harmonizationLevel: 0, memorySets: [createPresetMemorySet()], pet };
  return value as Extract<PresetDocument, { kind: K }>;
};
