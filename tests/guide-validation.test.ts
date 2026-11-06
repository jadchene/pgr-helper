import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CatalogEntry, CatalogSnapshot } from '../src/shared/types';
import type { GuideDocument, FlowNode } from '../src/shared/guides';
import { createGuide } from '../src/shared/guides';
import { createFlowNode, flattenFlowNodes, flowLimits } from '../src/shared/guide-flow';
import { validateGuide, validateGuideTeam } from '../src/shared/guide-validation';
import { guideSchema } from '../src/main/guide-schema';
import { buildGuideFixture, loadGuideSnapshot } from './helpers/guide-fixture';

const repository = process.env.PGR_DATA_REPOSITORY;
let snapshot: CatalogSnapshot;
let guide: GuideDocument;

/** 节点层级样本，顶层算第一层，与流程编辑器一致。 */
const nestedNode = (depth: number): FlowNode => {
  const root = createFlowNode('attack', 'depth-1');
  let current = root;
  for (let index = 2; index <= depth; index++) {
    const child = createFlowNode('attack', `depth-${index}`);
    current.branches = [[child]];
    current = child;
  }
  return root;
};

describe('攻略格式边界', () => {
  const blank = (): GuideDocument => ({ ...createGuide(), name: '格式边界草稿' });

  it.each(['javascript:alert(1)', 'file:///C:/test.mp4', 'data:text/html,test', 'https://user:password@example.com/video', 'http://example.com/video'])('拒绝不允许的视频网址 %s', url => {
    expect(() => guideSchema.parse({ ...blank(), videoUrls: [url] })).toThrow();
  });

  it('接受300节点与8层边界，拒绝超过边界及循环对象，前后端限制一致', () => {
    const current = blank();
    current.flow.nodes = Array.from({ length: flowLimits.nodes }, (_, index) => createFlowNode('attack', `limit-${index}`));
    expect(() => guideSchema.parse(current)).not.toThrow();
    current.flow.nodes.push(createFlowNode('attack', 'too-many'));
    expect(() => guideSchema.parse(current)).toThrow(/300/);
    current.flow.nodes = [nestedNode(flowLimits.depth)];
    expect(() => guideSchema.parse(current)).not.toThrow();
    current.flow.nodes = [nestedNode(flowLimits.depth + 1)];
    expect(() => guideSchema.parse(current)).toThrow(/8/);
    const circular = createFlowNode('attack', 'circular');
    circular.branches = [[circular]];
    current.flow.nodes = [circular];
    expect(() => guideSchema.parse(current)).toThrow(/循环|节点/);
  });

  it('QTE次数上限与编辑器共用，超过上限拒绝', () => {
    const current = blank();
    const qte = createFlowNode('qte', 'qte-limit');
    qte.qteMemberIds = Array<string>(flowLimits.qte).fill('member-off-field');
    current.flow.nodes = [qte];
    expect(() => guideSchema.parse(current)).not.toThrow();
    qte.qteMemberIds.push('member-off-field');
    expect(() => guideSchema.parse(current)).toThrow();
  });

  it('草稿可缺配置，但日期不能使用不存在的公历日期', () => {
    const current = blank();
    expect(validateGuide(current, [])).toEqual([]);
    expect(() => guideSchema.parse({ ...current, recordedAt: '2026-02-30T12:00' })).toThrow(/时间/);
  });
});

describe.skipIf(!repository || !existsSync(repository))('真实资料的完整攻略语义', () => {
  beforeAll(async () => {
    snapshot = await loadGuideSnapshot(repository!);
    guide = buildGuideFixture(snapshot.entries);
  }, 30_000);

  it('61张真实表支持多副本三人完整配置，SSS3独立于SSS且所有操作均可保存', () => {
    expect(Object.keys(snapshot.fingerprints)).toHaveLength(61);
    expect(snapshot.entries).toHaveLength(1799);
    expect(guideSchema.safeParse(guide).success).toBe(true);
    expect(validateGuide(guide, snapshot.entries)).toEqual([]);
    expect(guide.stageIds).toHaveLength(2);
    expect(guide.team.members.map(member => member.position)).toEqual(['blue', 'red', 'yellow']);
    expect(guide.team.starterMemberId).not.toBe(guide.team.captainMemberId);
    const first = guide.team.members[0];
    const character = snapshot.entries.find(entry => entry.id === first.characterId)!;
    const stages = character.guideOptions!.evolutionStages!;
    expect(stages.find(stage => stage.id === first.evolutionId)?.label).toBe('SSS3');
    expect(stages.find(stage => stage.label === 'SSS')?.id).not.toBe(first.evolutionId);
    expect(first.memories.map(memory => memory.count)).toEqual([4, 2]);
    expect(guide.team.members[1].memories.map(memory => memory.count)).toEqual([6]);
    for (const member of guide.team.members) {
      expect(member.weaponResonanceIds.filter(Boolean)).toHaveLength(3);
      expect(member.memoryResonance.upper[0].count).toBe(6);
      expect(member.memoryResonance.lower[0].count).toBe(6);
      expect(member.pet.activeSkillId).toBeTruthy();
      expect(member.pet.passiveSkillIds.length).toBeGreaterThan(0);
    }
    expect(guide.team.effectIds.length).toBeGreaterThan(0);
    const nodes = flattenFlowNodes(guide.flow).map(location => location.node);
    expect(new Set(nodes.map(node => node.type))).toEqual(new Set(['attack', 'qte', 'skill', 'dodge', 'switch']));
    expect(new Set(nodes.filter(node => node.type === 'skill').map(node => node.skill))).toEqual(new Set(['red', 'yellow', 'blue', 'special', 'ultimate']));
    expect(nodes.some(node => node.qteMemberIds.length > new Set(node.qteMemberIds).size)).toBe(true);
    expect(nodes.some(node => node.branches.length > 1)).toBe(true);
    const single = structuredClone(guide);
    single.flow.mode = 'single';
    expect(validateGuide(single, snapshot.entries)).toEqual([]);
  });

  it('辅助机降级后的超额被动与其他辅助机主动技能被拒绝', () => {
    const current = structuredClone(guide);
    const member = current.team.members[0];
    const pet = snapshot.entries.find(entry => entry.id === member.pet.petId)!;
    member.pet.quality = pet.guideOptions!.partnerQualities![0].quality;
    expect(validateGuide(current, snapshot.entries).some(issue => issue.message.includes('超过当前品级槽数'))).toBe(true);
    member.pet.passiveSkillIds = [];
    const another = snapshot.entries.find(entry => entry.category === 'pet' && entry.id !== pet.id)!;
    member.pet.activeSkillId = another.guideOptions!.activeSkillGroups![0].skillIds[0];
    expect(validateGuide(current, snapshot.entries).some(issue => issue.message.includes('主动技能不匹配'))).toBe(true);
  });

  it('上下位共鸣不能串槽，武器和独域意识类型不能错配', () => {
    const current = structuredClone(guide);
    const member = current.team.members[0];
    member.memoryResonance.upper = structuredClone(member.memoryResonance.lower);
    expect(validateGuide(current, snapshot.entries).some(issue => issue.path.endsWith('memoryResonance.upper'))).toBe(true);
    member.memoryResonance.upper = [];
    const character = snapshot.entries.find(entry => entry.id === member.characterId)!;
    member.weaponId = snapshot.entries.find(entry => entry.category === 'weapon' && entry.guideOptions?.weaponType !== character.guideOptions!.weaponType)!.id;
    expect(validateGuide(current, snapshot.entries).some(issue => issue.message.includes('武器类型与机体不匹配'))).toBe(true);
    member.memories = [{ memoryId: snapshot.entries.find(entry => entry.category === 'memory' && entry.guideOptions?.characterType === 2)!.id, count: 6 }];
    expect(validateGuide(current, snapshot.entries).some(issue => issue.message.includes('适用机体类型不匹配'))).toBe(true);
  });

  it('武器技能共鸣跨槽不可重复，五星属性共鸣仍按各槽来源许可使用', () => {
    const current = structuredClone(guide);
    const member = current.team.members[0];
    const weapon = snapshot.entries.find(entry => entry.id === member.weaponId)!;
    const slots = weapon.guideOptions!.resonanceSlots!;
    const repeated = slots[0].choices.find(choice => choice.resonanceId.startsWith('resonance:weapon-skill-') && choice.characterIds.includes(member.characterId) && slots.every(slot => slot.choices.some(other => other.resonanceId === choice.resonanceId && other.characterIds.includes(member.characterId))))!;
    expect(repeated).toBeTruthy();
    member.weaponResonanceIds = [repeated.resonanceId, repeated.resonanceId, ''];
    expect(validateGuide(current, snapshot.entries).some(issue => issue.path.includes('weaponResonanceIds') && issue.message.includes('重复'))).toBe(true);
    const attributes = snapshot.entries.find(entry => {
      const options = entry.guideOptions;
      return entry.category === 'weapon' && options && options.weaponType === weapon.guideOptions!.weaponType && options.resonanceSlots?.length === 3 && options.resonanceSlots.every(slot => slot.choices.length && slot.choices.every(choice => choice.resonanceId.startsWith('resonance:attribute-')));
    })!;
    expect(attributes).toBeTruthy();
    member.weaponId = attributes.id;
    member.harmonization = { level: 0, memoryId: '' };
    member.weaponResonanceIds = attributes.guideOptions!.resonanceSlots!.map(slot => slot.choices[0].resonanceId);
    expect(validateGuide(current, snapshot.entries)).toEqual([]);
    // 若来源将同一属性池用于多槽，不能把技能共鸣的唯一规则扩大到属性共鸣。
    const commonAttribute = attributes.guideOptions!.resonanceSlots![0].choices[0];
    const changedEntries = snapshot.entries.map(entry => entry.id === attributes.id ? { ...entry, guideOptions: { ...entry.guideOptions, resonanceSlots: [1, 2, 3].map(slot => ({ slot, choices: [commonAttribute] })) } } : entry);
    member.weaponResonanceIds = Array<string>(3).fill(commonAttribute.resonanceId);
    expect(validateGuide(current, changedEntries)).toEqual([]);
  });

  it('混搭共鸣按实际意识容量分配，竞争同两件意识的组合拒绝，可重分配的组合通过', () => {
    const current = structuredClone(guide);
    current.team.members = [current.team.members[0]];
    current.team.captainMemberId = current.team.members[0].id;
    current.team.effectIds = [];
    const member = current.team.members[0];
    const [firstMemory, secondMemory] = member.memories;
    const actual = snapshot.entries.find(entry => entry.id === firstMemory.memoryId)!;
    const choices = actual.guideOptions!.resonanceSlots![0].choices.filter(choice => !choice.characterIds.length).slice(0, 3);
    expect(choices).toHaveLength(3);
    const [a, b, c] = choices;
    member.memories = [{ memoryId: firstMemory.memoryId, count: 2 }, { memoryId: secondMemory.memoryId, count: 4 }];
    member.memoryResonance.lower = [];
    const replacePools = (second: typeof choices): CatalogEntry[] => snapshot.entries.map(entry => {
      if (entry.id !== firstMemory.memoryId && entry.id !== secondMemory.memoryId) return entry;
      return { ...entry, guideOptions: { ...entry.guideOptions, resonanceSlots: [{ slot: 1, choices: entry.id === firstMemory.memoryId ? [a, b] : second }] } };
    });
    member.memoryResonance.upper = [{ resonanceId: a.resonanceId, count: 2 }, { resonanceId: b.resonanceId, count: 2 }, { resonanceId: c.resonanceId, count: 2 }];
    expect(validateGuideTeam(current.team, replacePools([c])).some(issue => issue.path.endsWith('memoryResonance.upper'))).toBe(true);
    member.memoryResonance.upper = [{ resonanceId: a.resonanceId, count: 4 }, { resonanceId: b.resonanceId, count: 2 }];
    expect(validateGuideTeam(current.team, replacePools([a]))).toEqual([]);
  });

  it('未完成草稿可保存缺项，但明确QTE在场冲突、重复站位和超额意识仍拒绝', () => {
    const draft = structuredClone(guide);
    draft.status = 'draft';
    draft.stageIds = [];
    draft.team.members[0].evolutionId = '';
    expect(validateGuide(draft, snapshot.entries)).toEqual([]);
    draft.flow.nodes[0].branches[0][0].qteMemberIds = [draft.team.starterMemberId];
    expect(validateGuide(draft, snapshot.entries).some(issue => issue.message.includes('可能在场'))).toBe(true);
    draft.team.members[1].position = draft.team.members[0].position;
    expect(validateGuide(draft, snapshot.entries).some(issue => issue.message.includes('每个站位'))).toBe(true);
    draft.team.members[0].memories[0].count = 6;
    expect(validateGuide(draft, snapshot.entries).some(issue => issue.message.includes('基础意识应为 6 件'))).toBe(true);
  });
});
