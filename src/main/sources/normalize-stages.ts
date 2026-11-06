import type { CatalogEntry, EntrySection } from '../../shared/types';

/** 副本规范化所需表，相对 cn/bytes，不读取其他区域。 */
export const stageTablePaths = [
  'share/fuben/Stage.json',
  'share/fuben/arena/AreaDistributeType.json',
  'share/fuben/arena/AreaStage.json',
  'share/fuben/arena/ArenaGroupFightEvent.json',
  'client/fuben/arena/ArenaStage.json',
  'client/fuben/arena/ArenaAreaBuffDetails.json',
  'share/fuben/bosssingle/BossSingleGrade.json',
  'share/fuben/bosssingle/BossSingleChallengeGrade.json',
  'share/fuben/bosssingle/BossSingleGroup.json',
  'share/fuben/bosssingle/BossSingleSection.json',
  'share/fuben/bosssingle/BossSingleStage.json',
  'share/fuben/bosssingle/BossSingleChallengeFeature.json',
  'share/fuben/bosssingle/BossSingleChallengeFeatureGroup.json',
  'share/fuben/bosssingle/BossSingleChallengeBuffGroup.json',
  'client/fuben/bosssingle/BossSingleChallengeBuffGroupIndex.json',
  'client/fuben/BabelTowerBuffDetails.json',
  'client/fuben/FubenFeatures.json',
] as const;

/** 上游 JSON 记录。 */
type Row = Record<string, unknown>;
/** 数据表集合。 */
type Tables = Record<string, Row[]>;
/** 读取原生数组，兼容可解析的数值 JSON 数组，不执行上游文本。 */
const list = (value: unknown): unknown[] => {
  if (value == null || value === '') return [];
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* 非 JSON 文本由调用方按类型拒绝。 */ }
  }
  throw new Error('副本资料包含无法解析的数组字段');
};
/** 转换纯文本，去除游戏颜色标签而不解释 HTML。 */
const text = (value: unknown): string => {
  if (value == null) return '';
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join('、');
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  return String(value).replace(/<br\s*\/?\s*>/gi, '\n').replace(/<[^>]*>/g, '').trim();
};
/** 检查必需主键，防止缺键记录覆盖正常资料。 */
const numberKey = (value: unknown, context: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${context} 缺少有效主键`);
  return value;
};
/** 解析可选的引用数组并检查引用类型。 */
const refs = (value: unknown, context: string): number[] => list(value).map(id => numberKey(id, context));
/** 为源表建立唯一主键索引。 */
const index = (rows: Row[], key: string, context: string): Map<number, Row> => {
  const result = new Map<number, Row>();
  for (const row of rows) {
    const id = numberKey(row[key], context);
    if (result.has(id)) throw new Error(`${context} 存在重复主键 ${id}`);
    result.set(id, row);
  }
  return result;
};
/** 必需关联不存在时拒绝候选包，避免带入残缺数据。 */
const linked = (map: Map<number, Row>, id: number, context: string): Row => {
  const row = map.get(id);
  if (!row) throw new Error(`${context} 引用不存在：${id}`);
  return row;
};
/** 必需名称不能为空。 */
const named = (value: unknown, context: string): string => {
  const result = text(value);
  if (!result) throw new Error(`${context} 缺少名称`);
  return result;
};
/** 创建稳定且可编辑的基础条目。 */
const entry = (category: 'stage' | 'weather', key: string, name: string, values: Partial<CatalogEntry>): CatalogEntry => ({
  id: `${category}:${key}`, category, name, subtitle: '', description: '', aliases: [], tags: [],
  element: '', profession: '', rarity: '', image: '', attributes: {}, sections: [], relatedIds: [], sourceKey: key,
  ...values,
});
/** 生成非空的纯文本详情段落。 */
const section = (title: string, body: string): EntrySection[] => body ? [{ title, body }] : [];
/** 去重且保留源顺序。 */
const unique = <T>(values: T[]): T[] => [...new Set(values)];
/** 保留有来源依据的多值筛选，空维度不推断为通用或全属性。 */
const facets = (values: Record<string, string[]>): Record<string, string[]> => Object.fromEntries(
  Object.entries(values).map(([key, items]) => [key, unique(items.filter(Boolean))]).filter(([, items]) => items.length),
);

/** 将战区与囚笼源表转为资料条目，仅表示配置候选，不推断当前周轮换。 */
export const normalizeStages = (tables: Tables): { entries: CatalogEntry[]; warnings: string[] } => {
  /** 只接受非空的已验证表集合。 */
  const table = (path: typeof stageTablePaths[number]): Row[] => {
    const rows = tables[path];
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`缺少副本基础表：${path}`);
    if (rows.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`副本表格式错误：${path}`);
    return rows;
  };
  const allStages = index(table('share/fuben/Stage.json'), 'StageId', '关卡');
  const arenaDisplay = index(table('client/fuben/arena/ArenaStage.json'), 'StageId', '战区展示');
  const distribute = index(table('share/fuben/arena/AreaDistributeType.json'), 'Id', '战区分类');
  const weather = index(table('client/fuben/arena/ArenaAreaBuffDetails.json'), 'Id', '战区天气');
  const arenaGroups = index(table('share/fuben/arena/ArenaGroupFightEvent.json'), 'Id', '战区天气组合');
  const bosses = index(table('share/fuben/bosssingle/BossSingleStage.json'), 'StageId', '囚笼关卡');
  const bossGroups = index(table('share/fuben/bosssingle/BossSingleGroup.json'), 'Id', '囚笼分组');
  const bossSections = table('share/fuben/bosssingle/BossSingleSection.json');
  index(bossSections, 'Id', '囚笼区域');
  const features = index(table('share/fuben/bosssingle/BossSingleChallengeFeature.json'), 'Id', '鏖战词缀');
  const featureGroups = index(table('share/fuben/bosssingle/BossSingleChallengeFeatureGroup.json'), 'Id', '鏖战词缀组合');
  const buffRows = table('share/fuben/bosssingle/BossSingleChallengeBuffGroup.json');
  const buffs = index(buffRows, 'Id', '鏖战模组');
  const buffIndexes = index(table('client/fuben/bosssingle/BossSingleChallengeBuffGroupIndex.json'), 'BuffGroupId', '鏖战模组索引');
  const mechanics = index(table('client/fuben/BabelTowerBuffDetails.json'), 'Id', 'Boss 机制');
  const traits = index(table('client/fuben/FubenFeatures.json'), 'Id', 'Boss 特性');
  // 队伍效应表由核心资料共同读取；存在推荐引用时必须能解析名称。
  const generalSkills = index(tables['share/character/CharacterGeneralSkill.json'] || [], 'Id', '队伍效应');
  const entries: CatalogEntry[] = [];
  const warnings: string[] = [];

  const areaRows = table('share/fuben/arena/AreaStage.json');
  index(areaRows, 'Id', '战区区域');
  const absentDisplay = new Set<number>();
  const ambiguousCovers = new Set<number>();
  for (const row of areaRows) {
    const id = numberKey(row.Id, '战区区域');
    const types = refs(row.DistributeTypes, '战区区域分类').map(type => linked(distribute, type, '战区区域分类'));
    const stageIds = refs(row.StageId, '战区区域关卡');
    for (const stageId of stageIds) {
      linked(allStages, stageId, '战区区域关卡');
      if (!arenaDisplay.has(stageId)) absentDisplay.add(stageId);
    }
    // 游戏关卡图标取 BgIconBig；仅使用同一区域已有关卡的唯一封面，不按名称猜图。
    const covers = unique(stageIds.map(stageId => text(arenaDisplay.get(stageId)?.BgIconBig)).filter(Boolean));
    if (covers.length > 1) ambiguousCovers.add(id);
    const typeNames = types.map(type => named(type.Name, '战区分类'));
    const elements = types.filter(type => type.FormationType === 1).map(type => text(type.Desc).replace(/区$/, ''));
    const effects = types.filter(type => type.FormationType === 2).map(type => text(type.Desc).replace(/区$/, ''));
    const status = row.IsAbandoned ? '已废弃' : '配置候选';
    const buffsText = list(row.BuffDesc).map(text).filter(Boolean);
    const buffNames = list(row.BuffName).map(text).filter(Boolean);
    const rule = text(row.Desc);
    entries.push(entry('stage', `arena-${id}`, named(row.Name, '战区区域'), {
      subtitle: `纷争战区 · ${typeNames.join(' / ')}`,
      description: [rule, ...buffsText].filter(Boolean).join('\n'),
      aliases: unique([...typeNames, ...buffNames]),
      tags: unique(['战区', ...types.map(type => text(type.Desc)), ...(row.IsAbandoned ? ['已废弃'] : ['配置候选'])]),
      element: elements.join(' / '),
      attributes: { '玩法': '纷争战区', '区域': typeNames.join(' / '), '状态': status, '关卡编号': stageIds.join('、'), ...(covers.length === 1 ? { '封面资源': covers[0] } : {}) },
      sections: [...section('区域规则', rule), ...buffsText.flatMap((body, i) => section(buffNames[i] || `增益 ${i + 1}`, body))],
      catalog: { order: [3, id], basis: 'configuration', facets: facets({ gameplay: ['纷争战区'], area: typeNames, element: elements, effect: effects, configStatus: [status] }) },
    }));
  }
  if (absentDisplay.size) warnings.push(`战区有 ${absentDisplay.size} 个关卡缺少专用展示记录，但通用关卡记录存在，已按区域配置展示。`);
  if (ambiguousCovers.size) warnings.push(`战区有 ${ambiguousCovers.size} 个区域关联多个不同封面，未自动选图。`);

  const arenaWeatherMembership = new Map<number, number[]>();
  for (const [groupId, row] of arenaGroups) {
    for (const id of refs(row.FightEvents, '战区天气组合')) {
      linked(weather, id, '战区天气组合');
      arenaWeatherMembership.set(id, [...(arenaWeatherMembership.get(id) || []), groupId]);
    }
  }
  for (const [id, row] of weather) {
    entries.push(entry('weather', `arena-${id}`, named(row.Name, '战区天气'), {
      subtitle: '纷争战区天气', description: named(row.Desc, '战区天气说明'), tags: ['战区', '天气'],
      attributes: { '适用玩法': '纷争战区', '组合编号': (arenaWeatherMembership.get(id) || []).join('、'), '图标资源': text(row.Icon) },
      catalog: { order: [5, id], basis: 'configuration', facets: { gameplay: ['纷争战区'], weatherType: ['战区天气'] } },
    }));
  }

  const sectionIds = new Set(bossSections.map(row => numberKey(row.SectionId, '囚笼区域')));
  for (const row of bossGroups.values()) for (const id of refs(row.SectionId, '囚笼分组')) {
    if (!sectionIds.has(id)) throw new Error(`囚笼分组引用不存在：${id}`);
  }
  const grades = table('share/fuben/bosssingle/BossSingleGrade.json');
  index(grades, 'LevelType', '囚笼分区');
  for (const grade of grades) for (const groupId of refs(grade.GroupId, '囚笼分区')) linked(bossGroups, groupId, '囚笼分区');
  const challengeGrades = table('share/fuben/bosssingle/BossSingleChallengeGrade.json');
  for (const grade of challengeGrades) {
    linked(bossGroups, numberKey(grade.BossGroupId, '鏖战分区'), '鏖战分区');
  }
  const latestSection = new Map<number, number>();
  for (const row of bossSections) {
    const id = numberKey(row.SectionId, '囚笼区域');
    const version = row.AfreshId == null || row.AfreshId === 0 ? 0 : numberKey(row.AfreshId, '囚笼重置代次');
    latestSection.set(id, Math.max(latestSection.get(id) || 0, version));
  }
  const referencedMechanics = new Set<number>();
  const referencedTraits = new Set<number>();
  const mechanicBosses = new Map<number, string[]>();
  const traitBosses = new Map<number, string[]>();
  for (const [stageId, boss] of bosses) {
    linked(allStages, stageId, '囚笼关卡');
    const bossName = named(boss.BossName, '囚笼 Boss');
    for (const id of refs(boss.BuffDetailsId, 'Boss 机制')) {
      linked(mechanics, id, 'Boss 机制');
      referencedMechanics.add(id);
      mechanicBosses.set(id, [...(mechanicBosses.get(id) || []), bossName]);
    }
    for (const id of refs(boss.FeaturesId, 'Boss 特性')) {
      linked(traits, id, 'Boss 特性');
      referencedTraits.add(id);
      traitBosses.set(id, [...(traitBosses.get(id) || []), bossName]);
    }
  }
  const bossEntryIds = new Set<string>();
  for (const row of bossSections) {
    const id = numberKey(row.SectionId, '囚笼区域');
    const version = row.AfreshId == null || row.AfreshId === 0 ? 0 : numberKey(row.AfreshId, '囚笼重置代次');
    const sourceKey = `boss-${id}-v${version}`;
    if (bossEntryIds.has(sourceKey)) throw new Error(`囚笼区域复合主键重复：${sourceKey}`);
    bossEntryIds.add(sourceKey);
    const stageIds = refs(row.StageId, '囚笼区域关卡');
    if (!stageIds.length) throw new Error(`囚笼区域没有关卡：${id}`);
    const stages = stageIds.map(stageId => linked(bosses, stageId, '囚笼区域关卡'));
    const names = unique(stages.map(stage => named(stage.BossName, '囚笼 Boss')));
    const difficulties = unique(stages.map(stage => named(stage.DifficultyDesc, '囚笼难度')));
    const mode = difficulties.includes('鏖战') ? '鏖战' : '普通';
    const historical = version < (latestSection.get(id) || 0);
    const groups = [...bossGroups.values()].filter(group => refs(group.SectionId, '囚笼分组').includes(id)).map(group => numberKey(group.Id, '囚笼分组'));
    const gradeNames = unique(grades.filter(grade => (grade.AfreshId || 0) === version && refs(grade.GroupId, '囚笼分区').some(groupId => groups.includes(groupId))).map(grade => text(grade.LevelName)));
    const areas = unique([...gradeNames, ...challengeGrades.filter(grade => groups.includes(Number(grade.BossGroupId))).map(grade => text(grade.LevelName))].filter(Boolean));
    const status = historical ? '历史配置' : '配置候选';
    const relatedIds = unique(stages.flatMap(stage => [
      ...refs(stage.BuffDetailsId, 'Boss 机制').map(key => `weather:boss-buff-${key}`),
      ...refs(stage.FeaturesId, 'Boss 特性').map(key => `weather:boss-trait-${key}`),
    ]));
    const summary = text(row.Desc);
    entries.push(entry('stage', sourceKey, names.join(' / '), {
      subtitle: `幻痛囚笼 · ${mode}${historical ? ' · 历史配置' : ''}`,
      description: summary, aliases: names,
      tags: ['囚笼', mode, ...gradeNames, historical ? '历史配置' : '配置候选'],
      attributes: { '玩法': '幻痛囚笼', '模式': mode, '难度': difficulties.join('、'), '分区': areas.join('、') || '未归入当前分区', '配置代次': String(version), '关卡编号': stageIds.join('、'), '头像资源': text(row.BossHeadIcon) },
      sections: [...section('Boss 简介', summary), { title: '难度与关卡', body: stages.map(stage => `${text(stage.DifficultyDesc)} · ${text(stage.StageId)}${stage.Score ? ` · 关卡分数 ${text(stage.Score)}` : ''}`).join('\n') }],
      relatedIds,
      catalog: { order: [mode === '普通' ? 2 : 1, version, numberKey(row.Id, '囚笼区域')], basis: 'configuration', facets: facets({ gameplay: ['幻痛囚笼'], mode: [mode], boss: names, difficulty: difficulties, area: areas.length ? areas : ['未归入当前分区'], configStatus: [status] }) },
    }));
  }

  for (const [prefix, ids, map, label] of [
    ['boss-buff', referencedMechanics, mechanics, '固有机制'], ['boss-trait', referencedTraits, traits, '特殊特性'],
  ] as const) {
    for (const id of ids) {
      const row = linked(map, id, label);
      entries.push(entry('weather', `${prefix}-${id}`, named(row.Name, label), {
        subtitle: `幻痛囚笼 · ${label}`, description: named(row.Desc, `${label}说明`), tags: ['囚笼', label],
        attributes: { '适用玩法': '幻痛囚笼', '类型': label, '图标资源': text(row.BuffBg || row.Icon) },
        catalog: { order: [prefix === 'boss-buff' ? 2 : 1, id], basis: 'configuration', facets: facets({ gameplay: ['幻痛囚笼'], weatherType: [label], boss: (prefix === 'boss-buff' ? mechanicBosses : traitBosses).get(id) || [] }) },
      }));
    }
  }
  const featureMembership = new Map<number, number[]>();
  for (const [groupId, row] of featureGroups) {
    const featureIds = refs(row.FeatureIds, '鏖战词缀组合');
    const buffGroupIds = refs(row.BuffGroupIds, '鏖战模组组合');
    for (const id of featureIds) {
      linked(features, id, '鏖战词缀组合');
      featureMembership.set(id, [...(featureMembership.get(id) || []), groupId]);
    }
    for (const id of buffGroupIds) linked(buffIndexes, id, '鏖战模组组合');
  }
  for (const [groupId, row] of buffIndexes) {
    for (const id of refs(row.Index, '鏖战模组索引')) {
      const buff = linked(buffs, id, '鏖战模组索引');
      if (buff.BuffGroupId !== groupId) throw new Error(`鏖战模组索引归属不符：${id}`);
    }
  }
  const featureModules = new Map<number, string[]>();
  const featureModuleNames = new Map<number, string[]>();
  for (const row of buffs.values()) for (const id of refs(row.Buff, '鏖战模组词缀')) {
    linked(features, id, '鏖战模组词缀');
    featureModules.set(id, [...(featureModules.get(id) || []), `${text(row.BuffGroupId)} / ${text(row.IndexName) || `模组 ${text(row.Index)}`}`]);
    featureModuleNames.set(id, [...(featureModuleNames.get(id) || []), text(row.IndexName) || `模组 ${text(row.Index)}`]);
  }
  for (const [id, row] of features) {
    // 游戏对缺省 Type 使用固定词缀；新类型不能混入现有编号分组。
    const featureType = row.Type ?? 1;
    if (featureType !== 1 && featureType !== 2) throw new Error(`鏖战词缀类型无法识别：${id}`);
    const effects = refs(row.ShowRecommendIds, '鏖战推荐效应').map(effectId => named(linked(generalSkills, effectId, '鏖战推荐效应').Name, '队伍效应'));
    entries.push(entry('weather', `boss-${id}`, named(row.Name, '鏖战词缀'), {
      subtitle: '幻痛囚笼 · 鏖战词缀', description: named(row.Desc, '鏖战词缀说明'), tags: ['囚笼', '鏖战', '词缀'],
      attributes: { '适用玩法': '鏖战点', '词缀组合': (featureMembership.get(id) || []).join('、'), '模组': unique(featureModules.get(id) || []).join('、'), '图标资源': text(row.Icon) },
      catalog: { order: [featureType === 1 ? 4 : 3, id], basis: 'configuration', facets: facets({ gameplay: ['幻痛囚笼'], weatherType: ['鏖战词缀'], affixType: [featureType === 1 ? '固定词缀' : '可选词缀'], effect: effects, module: featureModuleNames.get(id) || [] }) },
    }));
  }
  const finalIds = new Set(entries.map(item => item.id));
  for (const item of entries) for (const relatedId of item.relatedIds) {
    if (!finalIds.has(relatedId)) throw new Error(`副本关联资料缺失：${relatedId}`);
  }
  warnings.push('副本、天气与词缀为来源版本的配置候选，不代表本周开放内容；当前周组合需要另行确认。');
  return { entries, warnings };
};
