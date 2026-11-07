import { computed, h } from 'vue';
import type { SelectOption } from 'naive-ui';
import type { CatalogEntry } from '../shared/types';
import CatalogSelectLabel from './components/CatalogSelectLabel.vue';
/** 共用资料选项图标，保留字符串 label 以兼容搜索、键盘选择和多选标签。 */
export const useCatalogSelectLabel = (entries: () => readonly CatalogEntry[], resolve?: (value: string) => CatalogEntry | undefined) => {
  const byId = computed(() => new Map(entries().map(entry => [entry.id, entry])));
  /** 资料条目和技能图标统一走本地缓存；普通选项继续显示原文字。 */
  const renderCatalogLabel = (option: SelectOption) => {
    const value = String(option.entryId || option.value || '');
    const entry = resolve?.(value) || byId.value.get(value.startsWith('entry:') ? value.slice(6) : value);
    const label = String(option.label || '');
    return entry ? h(CatalogSelectLabel, { entry, label }) : label;
  };
  /** 根据字段所属字典分类匹配，防止相同文字借用其他分类的图标。 */
  const renderFacetLabel = (field: string, option: SelectOption) => {
    const types: Record<string, string> = { element: '属性', profession: '职业', effect: '队伍效应', rarity: '角色品级' };
    const type = types[field];
    const entry = type ? entries().find(entry => entry.category === 'dictionary' && entry.image && entry.catalog?.facets.dictionaryType?.includes(type) && (entry.name === option.value || entry.aliases.includes(String(option.value)))) : field === 'character' ? entries().find(entry => entry.category === 'character' && entry.name === option.value) : undefined;
    return entry ? h(CatalogSelectLabel, { entry, label: String(option.label || '') }) : renderCatalogLabel(option);
  };
  return { renderCatalogLabel, renderFacetLabel };
};
