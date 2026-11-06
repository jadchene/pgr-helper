import { z } from 'zod';

/** 源资料引用的长度边界。 */
const id = z.string().min(1).max(180);
/** 限定列表防止来源或备份产生无限选项。 */
const ids = z.array(id).max(3000);
/** 攻略培养和装备选项，保存与备份不能剥离其关系。 */
export const guideEntryOptionsSchema = z.object({
  evolutionStages: z.array(z.object({ id, label: z.string().max(100), quality: z.number().int().nonnegative(), phase: z.number().int().nonnegative(), effectSectionIds: ids }).strict()).max(200).optional(),
  weaponType: z.number().int().nonnegative().optional(), characterType: z.number().int().nonnegative().optional(), effectIds: ids.optional(),
  memorySites: z.array(z.number().int().min(1).max(6)).max(6).optional(), memoryStar: z.number().int().nonnegative().optional(),
  memorySetSizes: z.array(z.number().int().min(1).max(12)).max(12).optional(),
  resonanceSlots: z.array(z.object({ slot: z.number().int().min(1).max(3), choices: z.array(z.object({ resonanceId: id, characterIds: ids }).strict()).max(3000) }).strict()).max(3).optional(),
  harmonizationLevels: z.array(z.object({ level: z.number().int().positive(), label: z.string().max(100), description: z.string().max(100000), bonusPieces: z.number().int().nonnegative().max(12), memoryIds: ids, characterIds: ids }).strict()).max(100).optional(),
  partnerQualities: z.array(z.object({ quality: z.number().int().positive(), label: z.string().max(100), passiveSlots: z.number().int().nonnegative().max(20) }).strict()).max(100).optional(),
  activeSkillGroups: z.array(z.object({ id, skillIds: ids }).strict()).max(100).optional(), passiveSkillIds: ids.optional(), activeSkillSlots: z.number().int().nonnegative().max(20).optional(),
}).strict();
