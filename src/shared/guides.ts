/** 三个队伍站位，与游戏中的颜色对应。 */
export const teamPositions = ['blue', 'red', 'yellow'] as const;
/** 站位代码。 */
export type TeamPosition = typeof teamPositions[number];
/** 站位名称。 */
export const teamPositionLabels: Record<TeamPosition, string> = { blue: '蓝位', red: '红位', yellow: '黄位' };
/** 按件数记录的意识搭配。 @author chenjd @created 2026-11-06 16:30:00 */
export interface MemoryAllocation {
  /** 意识基础资料标识。 */ memoryId: string;
  /** 基础六件中的使用数量，不包含谐振。 */ count: number;
}
/** 同类共鸣的数量配置。 @author chenjd @created 2026-11-06 16:30:00 */
export interface ResonanceAllocation {
  /** 共鸣基础资料标识。 */ resonanceId: string;
  /** 该位置使用此共鸣的意识数量。 */ count: number;
}
/** 一名成员的实际培养与装备配置，独立于基础资料。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideMember {
  /** 攻略内稳定标识，换机体或站位不改变节点引用。 */ id: string;
  /** 游戏站位。 */ position: TeamPosition;
  /** 机体基础资料标识。 */ characterId: string;
  /** 源数据中明确的进化品级与阶段标识。 */ evolutionId: string;
  /** 武器基础资料标识，空值表示未配置。 */ weaponId: string;
  /** 三个武器共鸣槽位，空字符串表示未配置。 */ weaponResonanceIds: string[];
  /** 谐振等级及其额外套装意识，额外件数从来源读取。 */ harmonization: { level: number; memoryId: string };
  /** 基础六件意识组合。 */ memories: MemoryAllocation[];
  /** 上下位分别记录，每侧最多六次共鸣。 */ memoryResonance: { upper: ResonanceAllocation[]; lower: ResonanceAllocation[] };
  /** 辅助机实际品级和携带技能，空机体标识表示未配置。 */ pet: { petId: string; quality: number; activeSkillId: string; passiveSkillIds: string[] };
  /** 该成员配置补充。 */ notes: string;
}
/** 攻略队伍。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideTeam {
  /** 最多三名成员，成员标识和站位唯一。 */ members: GuideMember[];
  /** 开始战斗时在场的成员。 */ starterMemberId: string;
  /** 队长成员。 */ captainMemberId: string;
  /** 明确配置的队伍效应基础资料标识。 */ effectIds: string[];
}
/** 操作节点类型。 */
export type FlowNodeType = 'switch' | 'skill' | 'dodge' | 'attack' | 'qte';
/** 技能操作类型。 */
export type FlowSkill = 'red' | 'yellow' | 'blue' | 'special' | 'ultimate';
/** 操作节点；并行分支与本节点同时开始，汇合后继续下一节点。 @author chenjd @created 2026-11-06 16:30:00 */
export interface FlowNode {
  /** 稳定节点标识。 */ id: string;
  /** 操作类别。 */ type: FlowNodeType;
  /** 切换机体的目标成员；其他操作留空。 */ memberId: string;
  /** 技能类别；技能以外的操作忽略此字段。 */ skill: FlowSkill;
  /** 普攻、闪避和技能的按法，默认短按。 */ press: 'tap' | 'hold';
  /** 红黄蓝球、普攻和闪避的重复次数。 */ count: number;
  /** 同一连续流程的分组编号，0 表示不分组。 */ group: number;
  /** 按触发顺序记录的 QTE 成员，可重复，也可包含多个角色。 */ qteMemberIds: string[];
  /** 节点操作说明。 */ notes: string;
  /** 同时启动的多个子流程，各分支内仍按节点顺序执行。 */ branches: FlowNode[][];
}
/** 战区循环或囚笼单套流程。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideFlow {
  /** 按分组编号记录的整体备注，无备注时可省略。 */ groupNotes?: Record<string, string>;
  /** 循环入口的主流程节点标识，空值表示首节点；此前节点仅启动时执行。 */ loopStartId?: string;
  /** 单套执行完即结束；循环模式汇合后回到起点。 */ mode: 'single' | 'loop';
  /** 主流程的有序节点。 */ nodes: FlowNode[];
}
/** 用户维护的副本攻略内容。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideDocument {
  /** 本地独立攻略标识。 */ id: string;
  /** 攻略名称。 */ name: string;
  /** 草稿允许尚未完成的配置，完成状态要求配置和流程有效。 */ status: 'draft' | 'ready';
  /** 一个攻略适用的多个副本。 */ stageIds: string[];
  /** 用户记录的攻略日期与时间，使用本地日期时间输入格式。 */ recordedAt: string;
  /** 可选的预计战斗时长，单位秒。 */ durationSeconds: number | null;
  /** 攻略备注。 */ notes: string;
  /** 参考视频网页，点击后用系统浏览器打开。 */ videoUrls: string[];
  /** 实际配队与培养信息。 */ team: GuideTeam;
  /** 有序主流程及并行操作分支。 */ flow: GuideFlow;
}
/** 数据库中的攻略记录。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideRecord extends GuideDocument {
  /** 创建时间。 */ createdAt: string;
  /** 最近保存时间。 */ updatedAt: string;
  /** 回收站状态。 */ hidden: boolean;
  /** 用于检测其他窗口或旧草稿覆盖的修订号。 */ revision: number;
}
/** 可显示在表单旁的配置问题。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideIssue {
  /** 关联字段或节点路径。 */ path: string;
  /** 用户可读原因。 */ message: string;
}
/** 创建空成员，节点引用使用稳定标识。 */
export const createGuideMember = (position: TeamPosition, id: string = crypto.randomUUID()): GuideMember => ({
  id, position, characterId: '', evolutionId: '', weaponId: '', weaponResonanceIds: ['', '', ''],
  harmonization: { level: 0, memoryId: '' }, memories: [], memoryResonance: { upper: [], lower: [] },
  pet: { petId: '', quality: 0, activeSkillId: '', passiveSkillIds: [] }, notes: '',
});
/** 创建本地攻略草稿，基础资料由用户选择。 */
export const createGuide = (stageIds: string[] = []): GuideDocument => ({
  id: `guide:${crypto.randomUUID()}`, name: '', status: 'draft', stageIds, recordedAt: '', durationSeconds: null,
  notes: '', videoUrls: [], team: { members: [], starterMemberId: '', captainMemberId: '', effectIds: [] },
  flow: { mode: 'single', nodes: [] },
});

/** 验证用户记录时间的真实公历日期，拒绝 Date.parse 自动归一的不存在日期。 */
export const isGuideDateTime = (value: string): boolean => {
  if (!value) return true;
  const matched = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(value);
  if (!matched) return false;
  const [year, month, day, hour, minute, second] = matched.slice(1).map(value => Number(value || 0));
  if (year < 1 || month < 1 || month > 12 || day < 1 || hour > 23 || minute > 59 || second > 59) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
};
