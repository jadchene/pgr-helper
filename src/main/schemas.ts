import { z } from 'zod';
import { categories } from '../shared/types';
import type { SourceProfile } from '../shared/types';
import { guideEntryOptionsSchema } from './guide-options-schema';

/** 纯文本长度约束，防止异常来源耗尽内存。 */
const text = (max = 20_000) => z.string().max(max);
/** 可展示的图片地址，仅接受受限数据图片或 HTTPS。 */
const image = z.string().max(3_000_000).refine((value) => !value || /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value) || /^https:\/\//.test(value), '请选择本地图片或 HTTPS 图片地址');
/** 来源排序与多值筛选约束，避免异常排序数值及无界元数据。 */
export const catalogMetadataSchema = z.object({
  order: z.array(z.number().finite()).min(1).max(8),
  basis: z.enum(['source-priority', 'related-character', 'configuration', 'definition']),
  facets: z.record(text(60), z.array(text(200)).max(200)).refine(value => Object.keys(value).length <= 30),
}).strict();
/** 验证技能源分组及属性版本，使编辑和备份完整保留结构。 */
export const skillSectionMetadataSchema = z.object({
  iconResource: text(1000).optional(), image: image.optional(),
  kind: z.enum(['character', 'pet-active', 'pet-passive']), id: text(180).min(1),
  groupId: text(180).min(1), groupName: text(200).min(1), groupOrder: z.number().int().min(0).max(100_000),
  familyId: text(180).min(1), familyName: text(200).min(1), typeName: text(200).min(1),
  level: z.number().int().min(0).max(10_000).optional(),
  element: z.object({ id: z.number().int().nonnegative(), name: text(100).min(1) }).strict().optional(),
}).strict();
/** 普通正文和结构化技能共用的可编辑段落。 */
export const entrySectionSchema = z.object({ title: text(200), body: text(100_000), skill: skillSectionMetadataSchema.optional() }).strict();
/** 主进程验证所有来自界面的资料写入。 */
export const entrySchema = z.object({
  id: text(180).min(1), category: z.enum(categories), name: text(200).trim().min(1, '请填写名称'),
  subtitle: text(500), description: text(100_000), aliases: z.array(text(200)).max(100), tags: z.array(text(100)).max(100),
  element: text(100), profession: text(100), rarity: text(100), image,
  attributes: z.record(text(100), text()), sections: z.array(entrySectionSchema).max(200),
  relatedIds: z.array(text(180)).max(3000), sourceKey: text(180),
  catalog: catalogMetadataSchema.optional(),
  guideOptions: guideEntryOptionsSchema.optional(),
}).strict();
/** 固定格式的资料版本。 */
export const imageSourceSchema = z.object({
  repository: z.literal('undertheobservers/PGR_Assets'), revision: z.string().regex(/^[a-f0-9]{40}$/),
  version: text(200).min(1), updatedAt: z.iso.datetime(),
}).strict();
/** 固定格式的资料版本。 */
export const snapshotSchema = z.object({
  schemaVersion: z.literal(1), provider: z.literal('myssal'), region: z.literal('cn'),
  revision: z.string().regex(/^[a-f0-9]{40}$/), version: text(1000).min(1), builtAt: z.iso.datetime(),
  fingerprints: z.record(text(500), z.string().regex(/^[a-f0-9]{64}$/)),
  entries: z.array(entrySchema).min(1).max(30_000), warnings: z.array(text(2000)).max(1000),
  imageSource: imageSourceSchema.optional(),
}).strict();
/** 首次启动使用的远程 Myssal 仓库配置。 */
export const defaultSourceProfile: SourceProfile = { id: 'myssal-github', name: 'myssal · 国服在线仓库', provider: 'myssal', transport: 'github' };
/** 新界面请求严格拒绝已经移除的目录字段和目录传输方式。 */
export const settingsSchema = z.object({
  fontFamily: text(200).trim().refine(value => !/[\u0000-\u001f\u007f]/.test(value), '字体名称无效').default(''),
  theme: z.enum(['light', 'dark', 'system']), viewMode: z.enum(['grid', 'list']), checkOnStartup: z.boolean(),
  activeSourceId: text(100), sources: z.array(z.object({
    id: text(100).min(1), name: text(100).trim().min(1), provider: z.literal('myssal'),
    transport: z.literal('github'),
  }).strict()).min(1).max(20),
}).strict().superRefine((value, context) => {
  if (new Set(value.sources.map((source) => source.id)).size !== value.sources.length) {
    context.addIssue({ code: 'custom', message: '数据源标识不能重复' });
  }
  if (!value.sources.some((source) => source.id === value.activeSourceId)) {
    context.addIssue({ code: 'custom', message: '请选择有效数据源' });
  }
});
