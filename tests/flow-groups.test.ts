import { describe, expect, it } from 'vitest';
import { createGuideMember, type GuideFlow, type GuideTeam } from '../src/shared/guides';
import { createFlowNode, flowNodeTitle, normalizeFlowGroups, validateGuideFlow } from '../src/shared/guide-flow';
const team: GuideTeam = { members: [createGuideMember('blue', 'a'), createGuideMember('red', 'b')].map(member => ({ ...member, characterId: member.id })), starterMemberId: 'a', captainMemberId: 'a', effectIds: [] };
/** 创建同角色的连续分组。 */
const sample = (): GuideFlow => ({ mode: 'single', nodes: [0, 1, 2].map(index => ({ ...createFlowNode('attack', String(index)), group: 1 })) });
describe('操作次数与同机体分组', () => {
  it('连续同机体分组有效，次数只影响操作标题', () => {
    const flow = sample(); flow.nodes[0].count = 3;
    expect(validateGuideFlow(flow, team)).toEqual([]);
    expect(flowNodeTitle(flow.nodes[0], team, [])).toBe('普攻 × 3');
    flow.nodes[0].count = 1; expect(flowNodeTitle(flow.nodes[0], team, [])).toBe('普攻');
  });
  it('拒绝无效次数以及 QTE 和大招的重复次数', () => {
    for (const count of [0, -1, 1.5, 1000]) { const flow = sample(); flow.nodes[0].count = count; expect(validateGuideFlow(flow, team).length).toBeGreaterThan(0); }
    const flow = sample(); Object.assign(flow.nodes[0], { type: 'skill', skill: 'ultimate', count: 2 });
    expect(validateGuideFlow(flow, team).some(issue => issue.message.includes('不支持重复'))).toBe(true);
  });
  it('跨切人不能共组，编辑后拆组且不改变顺序', () => {
    const flow = sample(); Object.assign(flow.nodes[1], { type: 'switch', memberId: 'b' });
    expect(validateGuideFlow(flow, team).length).toBeGreaterThan(0);
    normalizeFlowGroups(flow, team);
    expect(flow.nodes.map(node => node.group)).toEqual([1, 0, 2]);
    expect(flow.nodes.map(node => node.id)).toEqual(['0', '1', '2']);
    expect(validateGuideFlow(flow, team)).toEqual([]);
  });
  it('跨未分组节点和循环入口会拆开，编号不冲突', () => {
    const flow = sample(); flow.groupNotes = { '1': '连续操作说明' }; flow.nodes[1].group = 0;
    normalizeFlowGroups(flow, team); expect(flow.nodes.map(node => node.group)).toEqual([1, 0, 2]);
    expect(flow.groupNotes).toEqual({ '1': '连续操作说明', '2': '连续操作说明' });
    const loop = sample(); loop.mode = 'loop'; loop.loopStartId = '1'; normalizeFlowGroups(loop, team);
    expect(loop.nodes.map(node => node.group)).toEqual([1, 2, 2]); expect(validateGuideFlow(loop, team)).toEqual([]);
  });
  it('不同并行分支不能共组', () => {
    const flow = sample(); flow.nodes[0].branches = [[{ ...createFlowNode('attack', 'branch'), group: 1 }]];
    normalizeFlowGroups(flow, team);
    expect(flow.nodes[0].branches[0][0].group).not.toBe(flow.nodes[0].group);
    expect(flow.nodes[1].group).not.toBe(flow.nodes[0].group);
    expect(validateGuideFlow(flow, team)).toEqual([]);
  });
  it('在场机体未知时不能分组', () => {
    const flow = sample(); normalizeFlowGroups(flow, { ...team, starterMemberId: '' });
    expect(flow.nodes.every(node => node.group === 0)).toBe(true);
  });
});
