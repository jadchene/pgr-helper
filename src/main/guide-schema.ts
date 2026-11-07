import { z } from 'zod';
import { isGuideDateTime, type FlowNode, type GuideDocument } from '../shared/guides';
import { flowLimits } from '../shared/guide-flow';

/** 用户填写的普通文本。 */
const text = (max: number) => z.string().max(max);
/** 受限的网页链接，不允许凭据或可执行协议。 */
const webUrl = text(4000).refine(value => {
  try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password; } catch { return false; }
}, '参考视频请输入完整的 HTTPS 网页地址');
/** 节点递归结构，深度和总量在解析前独立限制。 */
const nodeSchema: z.ZodType<FlowNode> = z.lazy(() => z.object({
  id: text(100).min(1), type: z.enum(['switch', 'skill', 'dodge', 'attack', 'qte']), memberId: text(100),
  skill: z.enum(['red', 'yellow', 'blue', 'special', 'ultimate']), press: z.enum(['tap', 'hold']),
  count: z.number().int().min(1).max(999), group: z.number().int().min(0),
  qteMemberIds: z.array(text(100)).max(flowLimits.qte),
  notes: text(10000), branches: z.array(z.array(nodeSchema).max(flowLimits.nodes)).max(flowLimits.branches),
}).strict());
/** 递归数据先校验边界，防止异常 IPC 或备份导致递归溢出。 */
const boundedFlow = z.preprocess((input, context) => {
  if (!input || typeof input !== 'object') return input;
  const nodes = (input as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return input;
  const pending = nodes.map(node => ({ node, depth: 1 }));
  const seen = new Set<object>();
  let count = 0;
  while (pending.length) {
    const { node, depth } = pending.pop()!;
    if (++count > flowLimits.nodes || depth > flowLimits.depth || (node && typeof node === 'object' && seen.has(node))) {
      context.addIssue({ code: 'custom', message: '流程最多 300 个节点、8 层分支，且不能循环引用节点对象' });
      return z.NEVER;
    }
    if (!node || typeof node !== 'object') continue;
    seen.add(node);
    const branches = (node as { branches?: unknown }).branches;
    if (Array.isArray(branches)) for (const branch of branches) if (Array.isArray(branch)) {
      for (const child of branch) pending.push({ node: child, depth: depth + 1 });
    }
  }
  return input;
}, z.object({ mode: z.enum(['single', 'loop']), groupNotes: z.record(z.string().regex(/^[1-9]\d*$/), text(4000)).optional(), loopStartId: text(100).optional(), nodes: z.array(nodeSchema).max(flowLimits.nodes) }).strict());
/** 单个共鸣的数量，空标识允许暂存草稿。 */
const resonanceAllocation = z.object({ resonanceId: text(180), count: z.number().int().min(1).max(6) }).strict();
/** 主进程与备份的攻略格式校验。 */
export const guideSchema = z.object({
  id: z.string().regex(/^guide:[a-zA-Z0-9-]{8,100}$/), name: text(200).trim().min(1, '请填写攻略名称'),
  status: z.enum(['draft', 'ready']), stageIds: z.array(text(180)).max(300),
  recordedAt: text(30).refine(isGuideDateTime, '攻略时间无效'),
  durationSeconds: z.number().finite().min(0).max(86400).nullable(), notes: text(100000), videoUrls: z.array(webUrl).max(30),
  team: z.object({
    members: z.array(z.object({
      id: text(100).min(1), position: z.enum(['blue', 'red', 'yellow']), characterId: text(180), evolutionId: text(100), weaponId: text(180),
      weaponResonanceIds: z.array(text(180)).length(3), harmonization: z.object({ level: z.number().int().min(0).max(1000), memoryId: text(180) }).strict(),
      memories: z.array(z.object({ memoryId: text(180), count: z.number().int().min(1).max(6) }).strict()).max(6),
      memoryResonance: z.object({ upper: z.array(resonanceAllocation).max(6), lower: z.array(resonanceAllocation).max(6) }).strict(),
      pet: z.object({ petId: text(180), quality: z.number().int().min(0).max(100), activeSkillId: text(180), passiveSkillIds: z.array(text(180)).max(20) }).strict(),
      notes: text(10000),
    }).strict()).max(3),
    starterMemberId: text(100), captainMemberId: text(100), effectIds: z.array(text(180)).max(30),
  }).strict(), flow: boundedFlow,
}).strict() satisfies z.ZodType<GuideDocument>;
/** 备份中的攻略修订及回收站状态。 */
export const guideRecordSchema = guideSchema.extend({ createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), hidden: z.boolean(), revision: z.number().int().positive() });
