import { teamPositionLabels, type FlowNode, type FlowNodeType, type FlowSkill, type GuideFlow, type GuideIssue, type GuideTeam } from './guides';
import type { CatalogEntry } from './types';

/** 流程规模限制，与编辑器和保存校验共用。 */
export const flowLimits = { nodes: 300, depth: 8, branches: 8, qte: 60, durationSeconds: 3600 } as const;
/** 操作类别名称，不依赖具体机体名称。 */
export const flowNodeLabels: Record<FlowNodeType, string> = { switch: '切换机体', skill: '技能', dodge: '闪避', attack: '普攻', qte: 'QTE' };
/** 技能操作名称。 */
export const flowSkillLabels: Record<FlowSkill, string> = { red: '红球', yellow: '黄球', blue: '蓝球', special: '特殊球', ultimate: '大招' };

/** 节点在全部可达轮次和并行顺序中的在场情况。 @author chenjd @created 2026-11-06 16:35:00 */
export interface FlowNodeContext {
  /** 所有可能在场的队伍成员，QTE 必须排除这些成员。 */ activeMemberIds: string[];
  /** 首发或切人目标尚未填写，无法确定在场角色。 */ unknownActive: boolean;
  /** 当前节点允许加入 QTE 序列的成员。 */ qteMemberIds: string[];
}
/** 一次完整流程分析。 @author chenjd @created 2026-11-06 16:35:00 */
export interface FlowAnalysis {
  /** 结构或操作错误，包含稳定的节点定位。 */ issues: GuideIssue[];
  /** 按稳定节点标识查询上下文。 */ contexts: Record<string, FlowNodeContext>;
  /** 一轮结束后可能在场的成员。 */ endMemberIds: string[];
  /** 一轮结束的在场角色是否尚未配置。 */ unknownEnd: boolean;
}
/** 流程校验选项。 @author chenjd @created 2026-11-06 16:35:00 */
export interface FlowValidationOptions {
  /** 草稿可保存尚未填写的字段，但不会放过明确的角色冲突。 */ allowIncomplete?: boolean;
}
/** 节点在当前树中的定位，不随标题修改变化。 @author chenjd @created 2026-11-06 16:35:00 */
export interface FlowLocation {
  /** 当前节点。 */ node: FlowNode;
  /** 所属连续流程。 */ sequence: FlowNode[];
  /** 在连续流程中的顺序。 */ index: number;
  /** 从主流程开始的嵌套深度。 */ depth: number;
  /** 并行分支的父节点，主流程为空。 */ parent: FlowNode | null;
  /** 父节点内的分支下标，主流程为空。 */ branchIndex: number | null;
}
/** 分析中的在场状态。 @author chenjd @created 2026-11-06 16:35:00 */
interface ActiveState {
  /** 可能在场成员。 */ ids: Set<string>;
  /** 有尚未填写的角色来源。 */ unknown: boolean;
}
/** 连续流程中最后一次切换的独立结果。 @author chenjd @created 2026-11-06 16:35:00 */
interface SequenceResult {
  /** 结束时可用于后续操作的在场状态。 */ state: ActiveState;
  /** 当前连续流程是否执行过切人。 */ switched: boolean;
  /** 本流程最后切入的目标；不混入其他并行线程的中间状态。 */ lastTargets: Set<string>;
  /** 当前最后切人是否尚未选目标。 */ unknownLast: boolean;
}

/** 新节点默认短按，不预填不存在的角色。 */
export const createFlowNode = (type: FlowNodeType = 'attack', id: string = crypto.randomUUID()): FlowNode => ({
  id, type, memberId: '', skill: 'red', press: 'tap', qteMemberIds: [], durationSeconds: null, notes: '', branches: [],
});

/** 深度优先列出节点，保留来源顺序；异常重复引用只访问一次。 */
export const flattenFlowNodes = (flow: GuideFlow): FlowLocation[] => {
  const result: FlowLocation[] = [];
  const seen = new Set<FlowNode>();
  const visit = (sequence: FlowNode[], depth: number, parent: FlowNode | null, branchIndex: number | null): void => {
    for (const [index, node] of sequence.entries()) {
      result.push({ node, sequence, index, depth, parent, branchIndex });
      if (seen.has(node)) continue;
      seen.add(node);
      if (depth < flowLimits.depth + 1) node.branches.forEach((branch, i) => visit(branch, depth + 1, node, i));
    }
  };
  visit(flow.nodes, 1, null, null);
  return result;
};

/** 用稳定 ID 查找当前节点，编辑不依赖画布展示顺序。 */
export const findFlowNode = (flow: GuideFlow, id: string): FlowLocation | undefined => flattenFlowNodes(flow).find(item => item.node.id === id);

/** 用实际资料显示成员名称；已删除或尚未配置的引用也不会消失。 */
export const flowMemberName = (team: GuideTeam, entries: readonly CatalogEntry[], memberId: string): string => {
  const member = team.members.find(item => item.id === memberId);
  if (!member) return memberId ? '已移除成员' : '未选择机体';
  const name = entries.find(entry => entry.id === member.characterId)?.name || (member.characterId ? '资料暂不可用' : '未配置机体');
  return `${teamPositionLabels[member.position]} · ${name}`;
};

/** 生成完整操作标题，不合并重复 QTE。 */
export const flowNodeTitle = (node: FlowNode, team: GuideTeam, entries: readonly CatalogEntry[]): string => {
  if (node.type === 'switch') return `切换 → ${flowMemberName(team, entries, node.memberId)}`;
  if (node.type === 'qte') return node.qteMemberIds.length ? `QTE · ${node.qteMemberIds.length} 次` : 'QTE · 待选择';
  const action = node.type === 'skill' ? flowSkillLabels[node.skill] : flowNodeLabels[node.type];
  return `${node.press === 'hold' ? '长按' : '短按'}${action}`;
};

/** 统计同时操作的最长路径时长；未填写的时间不作为零秒承诺。 */
export const flowDuration = (flow: GuideFlow): { seconds: number; complete: boolean } => {
  const sequenceDuration = (nodes: FlowNode[]): { seconds: number; complete: boolean } => nodes.reduce<{ seconds: number; complete: boolean }>((total, node) => {
    const branches = node.branches.map(sequenceDuration);
    return {
      seconds: total.seconds + Math.max(node.durationSeconds ?? 0, ...branches.map(branch => branch.seconds)),
      complete: total.complete && node.durationSeconds !== null && branches.every(branch => branch.complete),
    };
  }, { seconds: 0, complete: true });
  return sequenceDuration(flow.nodes);
};

/** 推导并行分支和循环中的全部可能在场角色，检查 QTE 与角色引用。 */
export const analyzeGuideFlow = (flow: GuideFlow, team: GuideTeam, options: FlowValidationOptions = {}): FlowAnalysis => {
  const issues: GuideIssue[] = [];
  const contexts: Record<string, FlowNodeContext> = {};
  const issueKeys = new Set<string>();
  const validMembers = new Set(team.members.filter(member => member.characterId).map(member => member.id));
  const locations = flattenFlowNodes(flow);
  const nodeIds = new Set<string>();
  let structurallySafe = true;
  const issue = (path: string, message: string): void => {
    const key = `${path}\n${message}`;
    if (!issueKeys.has(key)) {
      issueKeys.add(key);
      issues.push({ path, message });
    }
  };
  const required = (path: string, message: string): void => {
    if (!options.allowIncomplete) issue(path, message);
  };
  if (locations.length > flowLimits.nodes) {
    issue('flow', `操作流程最多 ${flowLimits.nodes} 个节点，请拆分过长流程。`);
    structurallySafe = false;
  }
  for (const { node, depth } of locations) {
    const path = `flow.nodes.${node.id}`;
    if (!node.id || nodeIds.has(node.id)) {
      issue(path, '节点标识重复或为空，请重新添加该节点。');
      structurallySafe = false;
    }
    nodeIds.add(node.id);
    if (depth > flowLimits.depth) {
      issue(path, `并行操作最多嵌套 ${flowLimits.depth} 层。`);
      structurallySafe = false;
    }
    if (node.branches.length > flowLimits.branches) {
      issue(path, `每个节点最多 ${flowLimits.branches} 个并行分支。`);
      structurallySafe = false;
    }
    if (node.qteMemberIds.length > flowLimits.qte) issue(path, `一个 QTE 节点最多记录 ${flowLimits.qte} 次触发。`);
    if (node.durationSeconds !== null && (!Number.isFinite(node.durationSeconds) || node.durationSeconds < 0 || node.durationSeconds > flowLimits.durationSeconds)) issue(path, `节点时长应为 0 至 ${flowLimits.durationSeconds} 秒。`);
    if (node.branches.some(branch => !branch.length)) required(path, '并行分支为空，请添加操作或移除此分支。');
  }
  const starterValid = validMembers.has(team.starterMemberId);
  if (flow.nodes.length && !starterValid) {
    if (team.starterMemberId) issue('team.starterMemberId', '首发机体不在当前已配置队伍中。');
    else required('team.starterMemberId', '请先选择首发机体，才能确定每个节点的在场角色。');
  }
  const initial: ActiveState = { ids: new Set(starterValid ? [team.starterMemberId] : []), unknown: !starterValid };
  if (!structurallySafe || !flow.nodes.length) return { issues, contexts, endMemberIds: [...initial.ids], unknownEnd: initial.unknown };

  /** 收集并行线程可能切入的角色，用于保守判断重叠时间内的 QTE。 */
  const switchTargets = (nodes: FlowNode[]): ActiveState => {
    const ids = new Set<string>();
    let unknown = false;
    for (const node of nodes) {
      if (node.type === 'switch') {
        if (validMembers.has(node.memberId)) ids.add(node.memberId);
        else unknown = true;
      }
      for (const branch of node.branches) {
        const child = switchTargets(branch);
        child.ids.forEach(id => ids.add(id));
        unknown ||= child.unknown;
      }
    }
    return { ids, unknown };
  };
  /** 合并所有可行状态，不挑选任意一条并行顺序来掩盖冲突。 */
  const union = (...states: ActiveState[]): ActiveState => ({ ids: new Set(states.flatMap(state => [...state.ids])), unknown: states.some(state => state.unknown) });
  const emptyState = (): ActiveState => ({ ids: new Set(), unknown: false });
  const runSequence = (nodes: FlowNode[], input: ActiveState, external: ActiveState): SequenceResult => {
    let current = union(input, external);
    let switched = false;
    let lastTargets = new Set<string>();
    let unknownLast = false;
    for (const node of nodes) {
      const path = `flow.nodes.${node.id}`;
      const branchSwitches = node.branches.map(switchTargets);
      const possibleActive = union(current, external, ...branchSwitches);
      const context = contexts[node.id] ?? { activeMemberIds: [], unknownActive: false, qteMemberIds: [] };
      context.activeMemberIds = [...new Set([...context.activeMemberIds, ...possibleActive.ids])];
      context.unknownActive ||= possibleActive.unknown;
      contexts[node.id] = context;
      if (node.type === 'switch') {
        if (!node.memberId) required(path, '请选择要切换的机体。');
        else if (!validMembers.has(node.memberId)) issue(path, '切换目标已移出队伍或尚未配置机体，请重新选择。');
      } else if (node.type === 'qte') {
        if (!node.qteMemberIds.length) required(path, '请添加至少一次 QTE，可重复选择同一名非在场机体。');
        node.qteMemberIds.forEach((id, index) => {
          if (!validMembers.has(id)) issue(path, `第 ${index + 1} 次 QTE 的机体已移出队伍或尚未配置。`);
          else if (possibleActive.ids.has(id)) {
            const member = team.members.find(value => value.id === id)!;
            issue(path, `第 ${index + 1} 次 QTE 的${teamPositionLabels[member.position]}可能在场，请先切换机体或调整并行操作。`);
          } else if (possibleActive.unknown) required(path, '在场角色尚不确定，请先完成首发或前面的切人配置。');
        });
      }
      const ownSwitch = node.type === 'switch';
      const ownTarget: ActiveState = ownSwitch
        ? { ids: new Set(validMembers.has(node.memberId) ? [node.memberId] : []), unknown: !validMembers.has(node.memberId) }
        : emptyState();
      const branchResults = node.branches.map((branch, index) => runSequence(
        branch,
        current,
        union(external, ownTarget, ...branchSwitches.filter((_, other) => other !== index)),
      ));
      const switchingResults = branchResults.filter(result => result.switched);
      const changed = ownSwitch || switchingResults.length > 0;
      if (changed) {
        const finalTargets = union(ownTarget, ...switchingResults.map(result => ({ ids: result.lastTargets, unknown: result.unknownLast })));
        if (finalTargets.ids.size > 1) issue(path, '并行切人结束后可能留下不同机体，请把切换改为有先后顺序的节点。');
        current = union(finalTargets, external);
        switched = true;
        lastTargets = finalTargets.ids;
        unknownLast = finalTargets.unknown;
      }
    }
    return { state: current, switched, lastTargets, unknownLast };
  };

  let starts = initial;
  let end = initial;
  // 队伍人数有限，单调合并循环入口后最多经过人数加两轮即可达到稳定状态。
  for (let iteration = 0; iteration < (flow.mode === 'loop' ? validMembers.size + 2 : 1); iteration++) {
    end = runSequence(flow.nodes, starts, emptyState()).state;
    if (flow.mode !== 'loop') break;
    const next = union(starts, end);
    if (next.ids.size === starts.ids.size && next.unknown === starts.unknown) break;
    starts = next;
  }
  for (const context of Object.values(contexts)) context.qteMemberIds = context.unknownActive ? [] : [...validMembers].filter(id => !context.activeMemberIds.includes(id));
  return { issues, contexts, endMemberIds: [...end.ids], unknownEnd: end.unknown };
};

/** 主进程和渲染进程共用同一套流程规则。 */
export const validateGuideFlow = (flow: GuideFlow, team: GuideTeam, options: FlowValidationOptions = {}): GuideIssue[] => analyzeGuideFlow(flow, team, options).issues;
