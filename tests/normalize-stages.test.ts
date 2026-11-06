import { describe, expect, it } from 'vitest';
import { normalizeStages, stageTablePaths } from '../src/main/sources/normalize-stages';

/** 构造覆盖模式、复合主键与天气关联的独立源表样本。 */
const fixture = (): Record<string, Record<string, unknown>[]> => ({
  'share/fuben/Stage.json': [{ StageId: 101 }, { StageId: 201 }, { StageId: 202 }],
  'share/fuben/arena/AreaDistributeType.json': [{ Id: 1, Name: '机械工厂', Desc: '物理区', FormationType: 1 }],
  'share/fuben/arena/AreaStage.json': [{ Id: 1, Name: '机械工厂', DistributeTypes: [1], StageId: [101], BuffName: ['增益'], BuffDesc: ['物理伤害提升'], Desc: '合军聚众' }],
  'share/fuben/arena/ArenaGroupFightEvent.json': [{ Id: 1, FightEvents: [4001] }],
  'client/fuben/arena/ArenaStage.json': [{ StageId: 102 }],
  'client/fuben/arena/ArenaAreaBuffDetails.json': [{ Id: 4001, Name: '测试天气', Desc: '角色出场获得增益' }],
  'share/fuben/bosssingle/BossSingleGrade.json': [{ LevelType: 1, LevelName: '终级区', GroupId: [1], AfreshId: 0 }],
  'share/fuben/bosssingle/BossSingleChallengeGrade.json': [{ LevelType: 9, BossGroupId: 12 }],
  'share/fuben/bosssingle/BossSingleGroup.json': [{ Id: 1, SectionId: [10] }, { Id: 12, SectionId: [10] }],
  'share/fuben/bosssingle/BossSingleSection.json': [{ Id: 1, SectionId: 10, AfreshId: 0, StageId: [201] }, { Id: 2, SectionId: 10, AfreshId: 1, StageId: [202] }],
  'share/fuben/bosssingle/BossSingleStage.json': [{ StageId: 201, BossName: 'Boss', DifficultyDesc: '地狱', BuffDetailsId: [90000], FeaturesId: [1] }, { StageId: 202, BossName: 'Boss', DifficultyDesc: '鏖战' }],
  'share/fuben/bosssingle/BossSingleChallengeFeature.json': [{ Id: 1, Name: '词缀', Desc: 'Boss受到伤害提升' }],
  'share/fuben/bosssingle/BossSingleChallengeFeatureGroup.json': [{ Id: 1, FeatureIds: [1], BuffGroupIds: [7] }],
  'share/fuben/bosssingle/BossSingleChallengeBuffGroup.json': [{ Id: 1, BuffGroupId: 7, Index: 1, Buff: [1] }],
  'client/fuben/bosssingle/BossSingleChallengeBuffGroupIndex.json': [{ BuffGroupId: 7, Index: [1] }],
  'client/fuben/BabelTowerBuffDetails.json': [{ Id: 90000, Name: '融甲', Desc: '受到装甲型伤害提升' }],
  'client/fuben/FubenFeatures.json': [{ Id: 1, Name: '对立', Desc: '受到特定机体伤害提升' }],
});

describe('副本资料规范化', () => {
  it('保留同一 Section 不同版本和普通鏖战模式，正确连接固有机制', () => {
    const source = fixture();
    expect(Object.keys(source).sort()).toEqual([...stageTablePaths].sort());
    const { entries, warnings } = normalizeStages(source);
    const normal = entries.find(row => row.id === 'stage:boss-10-v0');
    const challenge = entries.find(row => row.id === 'stage:boss-10-v1');
    expect(normal?.tags).toEqual(expect.arrayContaining(['普通', '历史配置']));
    expect(challenge?.tags).toEqual(expect.arrayContaining(['鏖战', '配置候选']));
    expect(normal?.relatedIds).toEqual(['weather:boss-buff-90000', 'weather:boss-trait-1']);
    expect(challenge?.relatedIds).toEqual([]);
    expect(entries.find(row => row.id === 'weather:boss-1')?.description).toBe('Boss受到伤害提升');
    expect(warnings.some(message => message.includes('本周'))).toBe(true);
  });

  it('仅缺少专用表现记录时仍保留战区，但真实关卡引用缺失会拒绝更新', () => {
    const source = fixture();
    const result = normalizeStages(source);
    expect(result.entries.some(row => row.id === 'stage:arena-1')).toBe(true);
    expect(result.warnings.some(message => message.includes('1 个关卡'))).toBe(true);
    source['share/fuben/Stage.json'] = [{ StageId: 201 }, { StageId: 202 }];
    expect(() => normalizeStages(source)).toThrow('战区区域关卡 引用不存在');
  });

  it('拒绝重复复合主键和失效词缀引用，不把上游结构问题转换为静默遗漏', () => {
    const duplicate = fixture();
    duplicate['share/fuben/bosssingle/BossSingleSection.json'].push({ Id: 3, SectionId: 10, AfreshId: 1, StageId: [202] });
    expect(() => normalizeStages(duplicate)).toThrow('复合主键重复');
    const broken = fixture();
    broken['share/fuben/bosssingle/BossSingleChallengeFeatureGroup.json'][0].FeatureIds = [999];
    expect(() => normalizeStages(broken)).toThrow('鏖战词缀组合 引用不存在');
  });

  it('仅关联唯一的战区大图；缺展示行仍可使用其他明确关联，歧义时不猜封面', () => {
    const source = fixture();
    source['share/fuben/Stage.json'].push({ StageId: 102 });
    source['share/fuben/arena/AreaStage.json'][0].StageId = [101, 102];
    source['client/fuben/arena/ArenaStage.json'] = [
      { StageId: 101, BgIconSmall: 'small.png', BgIconBig: 'cover.png' },
      { StageId: 102, BgIconSmall: 'small.png', BgIconBig: 'cover.png' },
    ];
    expect(normalizeStages(source).entries.find(item => item.id === 'stage:arena-1')?.attributes['封面资源']).toBe('cover.png');
    source['client/fuben/arena/ArenaStage.json'].shift();
    expect(normalizeStages(source).entries.find(item => item.id === 'stage:arena-1')?.attributes['封面资源']).toBe('cover.png');
    source['client/fuben/arena/ArenaStage.json'].push({ StageId: 101, BgIconBig: 'different.png' });
    const ambiguous = normalizeStages(source);
    expect(ambiguous.entries.find(item => item.id === 'stage:arena-1')?.attributes['封面资源']).toBeUndefined();
    expect(ambiguous.warnings.some(warning => warning.includes('1 个区域关联多个不同封面'))).toBe(true);
    source['client/fuben/arena/ArenaStage.json'] = [{ StageId: 101 }];
    expect(normalizeStages(source).entries.find(item => item.id === 'stage:arena-1')?.attributes['封面资源']).toBeUndefined();
  });
});
