import { z } from 'zod';
import { guideSchema } from './guide-schema';
import type { PresetDocument } from '../shared/presets';

/** 装备字段复用攻略成员边界。 */
const member = guideSchema.shape.team.shape.members.element.shape;
const resonance = z.object({ kind: z.enum(['entry', 'skillType']), value: z.string().min(1).max(180), count: z.number().int().min(1).max(6) }).strict();
const memory = z.object({
  memories: member.memories,
  resonance: z.object({ upper: z.array(resonance).max(6), lower: z.array(resonance).max(6) }).strict(),
  harmonizationMemoryId: z.string().max(180),
}).strict().superRefine((value, context) => {
  if (value.memories.reduce((sum, item) => sum + item.count, 0) > 6) context.addIssue({ code: 'custom', message: '基础意识最多六件' });
  for (const side of ['upper', 'lower'] as const) if (value.resonance[side].reduce((sum, item) => sum + item.count, 0) > 6) context.addIssue({ code: 'custom', message: '每侧共鸣最多六次' });
});
const memorySet = memory.safeExtend({ id: z.string().min(1).max(100), name: z.string().trim().min(1).max(200) });
const base = { id: z.string().regex(/^preset:[a-zA-Z0-9-]{8,100}$/), name: z.string().trim().min(1).max(200), notes: member.notes };
const character = z.object({
  ...base, kind: z.literal('character'), characterId: member.characterId.min(1), evolutionId: member.evolutionId,
  weaponId: member.weaponId, weaponResonanceIds: member.weaponResonanceIds, harmonizationLevel: member.harmonization.shape.level,
  memorySets: z.array(memorySet).min(1).max(30), pet: member.pet,
}).strict().superRefine((value, context) => {
  if (new Set(value.memorySets.map(item => item.id)).size !== value.memorySets.length) context.addIssue({ code: 'custom', message: '意识方案标识不能重复' });
});
const memoryPreset = z.object({ ...base, kind: z.literal('memory'), memory }).strict();
const petPreset = z.object({ ...base, kind: z.literal('pet'), pet: member.pet }).strict();
/** 只接受当前三类独立预设。 */
export const presetSchema = z.discriminatedUnion('kind', [character, memoryPreset, petPreset]) satisfies z.ZodType<PresetDocument>;
const metadata = { createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), hidden: z.boolean(), revision: z.number().int().positive() };
/** 备份保留修订与回收状态。 */
export const presetRecordSchema = z.discriminatedUnion('kind', [character.safeExtend(metadata), memoryPreset.extend(metadata), petPreset.extend(metadata)]);
