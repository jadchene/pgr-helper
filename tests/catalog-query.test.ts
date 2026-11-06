import { describe, expect, it } from 'vitest';
import type { EntryView } from '../src/shared/types';
import { facetOptions, facetValues, matchesCatalogFilters } from '../src/renderer/catalog-query';

/** 构造已导入但允许本地编辑的多值辅助机资料。 */
const pet = (): EntryView => ({
  id: 'pet:1', category: 'pet', sourceKey: '1', name: '测试辅助机', subtitle: '', description: '', aliases: [], tags: [],
  element: '物理 / 雷', profession: '', rarity: 'S', image: '', attributes: {}, sections: [], relatedIds: [],
  origin: 'source', modified: false, hidden: false, retired: false, updatedAt: '',
  catalog: { order: [100], basis: 'source-priority', facets: { element: ['物理', '雷'], character: ['露西亚·深红囚影', '比安卡·真理'], rarity: ['S'] } },
});

describe('资料筛选的多值与本地编辑', () => {
  it('同一辅助机可分别按两个推荐属性命中，多个维度必须同时满足', () => {
    const entry = pet();
    expect(matchesCatalogFilters(entry, { element: '雷', character: '比安卡·真理' }, 'source')).toBe(true);
    expect(matchesCatalogFilters(entry, { element: '物理' }, 'all')).toBe(true);
    expect(matchesCatalogFilters(entry, { element: '冰', character: '比安卡·真理' }, 'all')).toBe(false);
    expect(matchesCatalogFilters(entry, { element: '雷' }, 'modified')).toBe(false);
    expect(facetOptions([entry], 'element').map(option => option.value).sort()).toEqual(['物理', '雷'].sort());
  });

  it('已编辑的可见字段优先于原始派生值，缺少推荐关系显示未提供', () => {
    const entry = pet();
    entry.element = '冰';
    entry.rarity = 'A';
    expect(facetValues(entry, 'element')).toEqual(['冰']);
    expect(facetValues(entry, 'rarity')).toEqual(['A']);
    delete entry.catalog;
    entry.origin = 'local';
    expect(facetValues(entry, 'character')).toEqual(['未提供']);
    expect(matchesCatalogFilters(entry, { character: '未提供', element: '冰' }, 'local')).toBe(true);
  });
});
