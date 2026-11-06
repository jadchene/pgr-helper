import { categories, categoryLabels, type CatalogEntry, type Category, type EntryView } from '../shared/types';

/** 各分类筛选条件及实际排序依据。 @author chenjd @created 2026-11-06 16:25:00 */
export interface CatalogQueryConfig {
  /** 默认排序的可读名称。 */ orderLabel: string;
  /** 用户判断新旧时需要知道的范围和限制。 */ orderHelp: string;
  /** 该分类允许选择的专属条件。 */ filters: { key: string; label: string }[];
}

/** 分类独立配置，避免把机体的职业等条件套用到其他资料。 */
export const catalogQueryConfig: Record<Category | 'all', CatalogQueryConfig> = {
  character: {
    orderLabel: '来源顺序倒序',
    orderHelp: '按机体在来源中的排序值倒序，新机体通常靠前；来源未提供逐条推出日期。',
    filters: [{ key: 'element', label: '属性' }, { key: 'profession', label: '职业' }, { key: 'rarity', label: '初始品级' }, { key: 'frameType', label: '机体类型' }, { key: 'effect', label: '队伍效应' }, { key: 'enhancement', label: '跃升技能' }, { key: 'collaboration', label: '联动机体' }],
  },
  memory: {
    orderLabel: '套装分组倒序',
    orderHelp: '按星级、图鉴类别和编号系列分组，同系列按套装编号倒序；不同系列不代表统一的推出先后。',
    filters: [{ key: 'rarity', label: '星级' }, { key: 'archiveGroup', label: '图鉴类别' }, { key: 'purpose', label: '用途' }, { key: 'character', label: '推荐机体' }, { key: 'setSize', label: '套装件数' }],
  },
  weapon: {
    orderLabel: '推荐机体顺序',
    orderHelp: '有明确推荐机体的武器按该机体的来源顺序倒序，其余按类型、星级与编号排列；时装或特殊配置置后。这是关联参考，非武器推出日期。',
    filters: [{ key: 'rarity', label: '星级' }, { key: 'weaponType', label: '武器类型' }, { key: 'character', label: '推荐机体' }, { key: 'configKind', label: '资料性质' }],
  },
  resonance: {
    orderLabel: '共鸣分组顺序',
    orderHelp: '意识技能共鸣按所属机体的来源顺序倒序；共享武器技能与属性共鸣单独分组，不随新机体改变新旧。',
    filters: [{ key: 'resonanceType', label: '共鸣类型' }, { key: 'character', label: '适用机体' }, { key: 'profession', label: '适用职业' }, { key: 'skillType', label: '技能类型' }, { key: 'slot', label: '共鸣槽位' }],
  },
  pet: {
    orderLabel: '来源顺序倒序',
    orderHelp: '按辅助机在来源中的排序值倒序，新辅助机通常靠前；来源未提供逐条推出日期。',
    filters: [{ key: 'rarity', label: '初始品级' }, { key: 'element', label: '推荐属性' }, { key: 'character', label: '推荐机体' }, { key: 'partnerType', label: '辅助机类型' }, { key: 'function', label: '功能' }],
  },
  stage: {
    orderLabel: '玩法分组倒序',
    orderHelp: '按战区、普通囚笼、鏖战分组，组内按配置代次与编号倒序。配置代次不等于游戏版本，也不表示本周开放。',
    filters: [{ key: 'gameplay', label: '玩法' }, { key: 'mode', label: '模式' }, { key: 'boss', label: 'Boss' }, { key: 'difficulty', label: '难度' }, { key: 'area', label: '区域／分区' }, { key: 'element', label: '推荐属性' }, { key: 'effect', label: '推荐效应' }, { key: 'configStatus', label: '配置状态' }],
  },
  weather: {
    orderLabel: '类型分组倒序',
    orderHelp: '天气、固定词缀、可选词缀、固有机制、特殊特性分别按编号倒序；不同类型的编号无法比较推出先后。',
    filters: [{ key: 'gameplay', label: '适用玩法' }, { key: 'weatherType', label: '资料类型' }, { key: 'affixType', label: '词缀类型' }, { key: 'effect', label: '推荐效应' }, { key: 'boss', label: '关联 Boss' }, { key: 'module', label: '模组' }],
  },
  dictionary: {
    orderLabel: '字典分类顺序',
    orderHelp: '按属性、职业、品级、效应、技能类型分组，以定义顺序展示；字典编号不代表推出时间。',
    filters: [{ key: 'dictionaryType', label: '字典类型' }],
  },
  all: {
    orderLabel: '分类默认顺序',
    orderHelp: '按资料分类分组，每类使用各自的默认顺序；没有统一的推出日期。',
    filters: [{ key: 'category', label: '资料分类' }],
  },
};

/** 当前可读字段优先于派生值，编辑后的属性、职业和星级立即参与筛选。 */
export const facetValues = (entry: CatalogEntry, key: string): string[] => {
  if (key === 'category') return [categoryLabels[entry.category]];
  if (key === 'rarity' || (entry.category === 'character' && (key === 'element' || key === 'profession'))) {
    return entry[key] ? [entry[key]] : ['未提供'];
  }
  if (entry.category === 'pet' && key === 'element') {
    return entry.element ? entry.element.split(/\s*\/\s*/).filter(Boolean) : ['未提供'];
  }
  return entry.catalog?.facets[key]?.length ? entry.catalog.facets[key] : ['未提供'];
};

/** 条件来自当前分类真实资料；多值关联按单个值选择。 */
export const facetOptions = (entries: CatalogEntry[], key: string) =>
  [...new Set(entries.flatMap(entry => facetValues(entry, key)))]
    .sort((a, b) => a === '未提供' ? 1 : b === '未提供' ? -1 : a.localeCompare(b, 'zh-CN', { numeric: true }))
    .map(value => ({ label: value, value }));

/** 未提供来源顺序的手动条目置后；所有同分条目使用稳定名称与标识排序。 */
export const compareCatalogEntries = (a: CatalogEntry, b: CatalogEntry, order: 'source' | 'name' = 'source'): number => {
  if (order === 'source') {
    const category = categories.indexOf(a.category) - categories.indexOf(b.category);
    if (category) return category;
    if (!!a.catalog !== !!b.catalog) return a.catalog ? -1 : 1;
    const left = a.catalog?.order ?? [];
    const right = b.catalog?.order ?? [];
    for (let index = 0; index < Math.max(left.length, right.length); index++) {
      const delta = (right[index] ?? 0) - (left[index] ?? 0);
      if (delta) return delta;
    }
  }
  return a.name.localeCompare(b.name, 'zh-CN', { numeric: true }) || a.id.localeCompare(b.id, 'en', { numeric: true });
};

/** 所有已应用条件取交集；选择一项即可命中多值资料。 */
export const matchesCatalogFilters = (entry: EntryView, facets: Record<string, string | null>, status: string): boolean =>
  Object.entries(facets).every(([key, value]) => !value || facetValues(entry, key).includes(value)) &&
  (status === 'all' || (status === 'modified' && entry.modified) || (status === 'local' && entry.origin === 'local') ||
    (status === 'source' && entry.origin === 'source') || (status === 'retired' && entry.retired));
