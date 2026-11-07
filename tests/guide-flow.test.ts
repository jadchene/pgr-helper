import { describe, expect, it } from 'vitest';
import { createGuideMember, type FlowNode, type GuideFlow, type GuideTeam } from '../src/shared/guides';
import { analyzeGuideFlow, createFlowNode, findFlowNode, flattenFlowNodes, validateGuideFlow } from '../src/shared/guide-flow';

/** 三名真实业务角色的最小替身，只隔离流程语义，不依赖名称。 */
const team = (): GuideTeam => ({
  members: [createGuideMember('blue', 'a'), createGuideMember('red', 'b'), createGuideMember('yellow', 'c')].map(member => ({ ...member, characterId: `character:${member.id}` })),
  starterMemberId: 'a', captainMemberId: 'a', effectIds: [],
});
/** 建立可读的节点样本，测试不会依赖随机主键。 */
const node = (id: string, changes: Partial<FlowNode> = {}): FlowNode => ({ ...createFlowNode('attack', id), ...changes });
/** 单套流程样本。 */
const flow = (...nodes: FlowNode[]): GuideFlow => ({ mode: 'single', nodes });

describe('攻略操作流程及在场角色', () => {
  it('启动段只运行一次，后续轮次从指定主节点继续校验', () => {
    const value: GuideFlow = { mode: 'loop', loopStartId: 'cycle', nodes: [
      node('startup', { type: 'qte', qteMemberIds: ['b'] }),
      node('cycle', { type: 'switch', memberId: 'b' }),
      node('finish', { type: 'qte', qteMemberIds: ['a'] }),
    ] };
    const result = analyzeGuideFlow(value, team());
    expect(result.issues).toEqual([]);
    expect(result.contexts.startup.activeMemberIds).toEqual(['a']);
    expect(result.contexts.cycle.activeMemberIds).toContain('b');
    expect(validateGuideFlow({ ...value, loopStartId: '' }, team()).some(issue => issue.path.includes('startup'))).toBe(true);
    expect(validateGuideFlow({ ...value, loopStartId: 'missing' }, team()).some(issue => issue.path === 'flow.loopStartId')).toBe(true);
  });

  it('新技能、闪避和普攻默认短按，空草稿不强制出现节点', () => {
    for (const type of ['attack', 'skill', 'dodge'] as const) expect(createFlowNode(type).press).toBe('tap');
    expect(validateGuideFlow(flow(), team())).toEqual([]);
  });

  it('清除循环入口后整套执行一次，保留已有操作节点', () => {
    const nodes = [node('q', { type: 'qte', qteMemberIds: ['b'] }), node('swap', { type: 'switch', memberId: 'b' })];
    const before = JSON.stringify(nodes);
    expect(validateGuideFlow({ mode: 'loop', loopStartId: 'q', nodes }, team()).length).toBeGreaterThan(0);
    expect(validateGuideFlow({ mode: 'single', loopStartId: '', nodes }, team())).toEqual([]);
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it('同一个QTE节点保留多个角色的重复调用和先后次序', () => {
    const qte = node('q', { type: 'qte', qteMemberIds: ['b', 'c', 'b', 'b'] });
    const result = analyzeGuideFlow(flow(qte), team());
    expect(result.issues).toEqual([]);
    expect(qte.qteMemberIds).toEqual(['b', 'c', 'b', 'b']);
    expect(result.contexts.q.qteMemberIds).toEqual(['b', 'c']);
    expect(result.contexts.q.activeMemberIds).toEqual(['a']);
  });

  it('首发不能QTE，切换后原机体可QTE而新在场角色不可QTE', () => {
    expect(validateGuideFlow(flow(node('q', { type: 'qte', qteMemberIds: ['a'] })), team())[0].message).toContain('蓝位可能在场');
    const result = analyzeGuideFlow(flow(node('swap', { type: 'switch', memberId: 'b' }), node('q', { type: 'qte', qteMemberIds: ['a', 'c', 'a'] })), team());
    expect(result.issues).toEqual([]);
    expect(result.contexts.q.qteMemberIds).toEqual(['a', 'c']);
    expect(result.endMemberIds).toEqual(['b']);
    expect(validateGuideFlow(flow(node('swap', { type: 'switch', memberId: 'b' }), node('q', { type: 'qte', qteMemberIds: ['b'] })), team())[0].message).toContain('红位可能在场');
  });

  it('长按普攻的多个并行QTE分支与父节点同时开始，分支内可连续操作', () => {
    const input = flow(node('hold', { press: 'hold', branches: [
      [node('q1', { type: 'qte', qteMemberIds: ['b', 'b'] }), node('q2', { type: 'qte', qteMemberIds: ['c'] })],
      [node('q3', { type: 'qte', qteMemberIds: ['c'] })],
    ] }), node('after'));
    expect(validateGuideFlow(input, team())).toEqual([]);
    expect(flattenFlowNodes(input).map(item => item.node.id)).toEqual(['hold', 'q1', 'q2', 'q3', 'after']);
    expect(findFlowNode(input, 'q2')).toMatchObject({ depth: 2, parent: { id: 'hold' }, branchIndex: 0, index: 1 });
  });

  it('并行中途切人的目标也会被排除，不能仅看父节点的在场角色', () => {
    const input = flow(node('main', { branches: [
      [node('b', { type: 'switch', memberId: 'b' }), node('c', { type: 'switch', memberId: 'c' })],
      [node('q', { type: 'qte', qteMemberIds: ['b'] })],
    ] }), node('after', { type: 'qte', qteMemberIds: ['a', 'b'] }));
    const result = analyzeGuideFlow(input, team());
    expect(result.issues).toEqual([expect.objectContaining({ path: 'flow.nodes.q', message: expect.stringContaining('红位可能在场') })]);
    expect(result.contexts.q.activeMemberIds.sort()).toEqual(['a', 'b', 'c']);
    expect(result.contexts.after.activeMemberIds).toEqual(['c']);
    expect(result.endMemberIds).toEqual(['c']);
  });

  it('两个并行切入不同机体的分支不能假定任意执行顺序', () => {
    const input = flow(node('main', { branches: [[node('b', { type: 'switch', memberId: 'b' })], [node('c', { type: 'switch', memberId: 'c' })]] }));
    expect(validateGuideFlow(input, team()).some(issue => issue.message.includes('并行切人结束后'))).toBe(true);
    expect(analyzeGuideFlow(input, team()).endMemberIds.sort()).toEqual(['b', 'c']);
  });

  it('同目标的并行切人可汇合到确定状态，分支中间目标不污染最终结果', () => {
    const input = flow(node('main', { branches: [
      [node('b', { type: 'switch', memberId: 'b' }), node('c1', { type: 'switch', memberId: 'c' })],
      [node('c2', { type: 'switch', memberId: 'c' })],
    ] }), node('after', { type: 'qte', qteMemberIds: ['a', 'b'] }));
    expect(validateGuideFlow(input, team())).toEqual([]);
    expect(analyzeGuideFlow(input, team()).contexts.after.activeMemberIds).toEqual(['c']);
  });

  it('父节点切人与子QTE并发时同时考虑切换前后角色', () => {
    const input = flow(node('swap', { type: 'switch', memberId: 'b', branches: [[node('q', { type: 'qte', qteMemberIds: ['a', 'b', 'c'] })]] }));
    const result = analyzeGuideFlow(input, team());
    expect(result.issues.filter(issue => issue.path === 'flow.nodes.q')).toHaveLength(2);
    expect(result.contexts.q.qteMemberIds).toEqual(['c']);
  });

  it('循环入口校验包含上一轮留下的角色，不能只检查第一轮', () => {
    const nodes = [node('q', { type: 'qte', qteMemberIds: ['b'] }), node('swap', { type: 'switch', memberId: 'b' })];
    expect(validateGuideFlow({ mode: 'single', nodes }, team())).toEqual([]);
    const repeated = analyzeGuideFlow({ mode: 'loop', nodes }, team());
    expect(repeated.issues.some(issue => issue.path === 'flow.nodes.q' && issue.message.includes('红位可能在场'))).toBe(true);
    expect(repeated.contexts.q.activeMemberIds.sort()).toEqual(['a', 'b']);
    expect(repeated.contexts.q.qteMemberIds).toEqual(['c']);
  });

  it('循环通过明确切人建立固定在场状态，首尾可安全轮换', () => {
    const repeated: GuideFlow = { mode: 'loop', nodes: [node('swap-a', { type: 'switch', memberId: 'a' }), node('q', { type: 'qte', qteMemberIds: ['b', 'c'] }), node('swap-b', { type: 'switch', memberId: 'b' })] };
    expect(validateGuideFlow(repeated, team())).toEqual([]);
    expect(analyzeGuideFlow(repeated, team()).contexts.q.activeMemberIds).toEqual(['a']);
  });

  it('删除或更换队伍后旧QTE引用仍被报告，不静默移除', () => {
    const input = flow(node('q', { type: 'qte', qteMemberIds: ['b', 'b'] }));
    const updated = team();
    updated.members = updated.members.filter(member => member.id !== 'b');
    expect(validateGuideFlow(input, updated)).toHaveLength(2);
    expect(input.nodes[0].qteMemberIds).toEqual(['b', 'b']);
    updated.starterMemberId = 'missing';
    expect(validateGuideFlow(input, updated).some(issue => issue.path === 'team.starterMemberId')).toBe(true);
  });

  it('删除前置切人后重新计算QTE限制，不缓存旧在场机体', () => {
    const q = node('q', { type: 'qte', qteMemberIds: ['a'] });
    const input = flow(node('swap', { type: 'switch', memberId: 'b' }), q);
    expect(validateGuideFlow(input, team())).toEqual([]);
    input.nodes.splice(0, 1);
    expect(validateGuideFlow(input, team())[0].message).toContain('蓝位可能在场');
  });

  it('草稿跳过尚未填写的必填项，但仍拒绝确定非法QTE和非空失效引用', () => {
    const input = flow(node('swap', { type: 'switch' }), node('q', { type: 'qte' }));
    expect(validateGuideFlow(input, team()).length).toBeGreaterThan(0);
    expect(validateGuideFlow(input, team(), { allowIncomplete: true })).toEqual([]);
    expect(validateGuideFlow(flow(node('q', { type: 'qte', qteMemberIds: ['a'] })), team(), { allowIncomplete: true })).toHaveLength(1);
    expect(validateGuideFlow(flow(node('swap', { type: 'switch', memberId: 'missing' })), team(), { allowIncomplete: true })).toHaveLength(1);
    const noStarter = { ...team(), starterMemberId: '' };
    expect(analyzeGuideFlow(input, noStarter, { allowIncomplete: true }).contexts.q.qteMemberIds).toEqual([]);
  });

  it('重复ID、共享节点对象、循环对象和过深树在分析前被拒绝', () => {
    expect(validateGuideFlow(flow(node('same'), node('same')), team())[0].message).toContain('标识重复');
    const shared = node('shared');
    expect(validateGuideFlow(flow(shared, shared), team())[0].message).toContain('标识重复');
    const circular = node('circle');
    circular.branches = [[circular]];
    expect(validateGuideFlow(flow(circular), team())[0].message).toContain('标识重复');
    const deep = node('0');
    let parent = deep;
    for (let index = 1; index <= 9; index++) {
      const child = node(String(index));
      parent.branches = [[child]];
      parent = child;
    }
    expect(validateGuideFlow(flow(deep), team()).some(issue => issue.message.includes('嵌套'))).toBe(true);
  });
});
