import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/shared/types';
import { coreTablePaths, normalizeCore } from '../src/main/sources/normalize-core';
import type { SourceTables } from '../src/main/sources/common';
import { readMyssalHttpFixture } from './helpers/myssal-http-fixture';

const repository = process.env.PGR_DATA_REPOSITORY;
const revision = '170abcceee1fdbdee00a8770830ef80680a6ceca';
let tables: SourceTables;
let entries: CatalogEntry[];

/** 按产品契约比较排序元组，测试断言使用独立的真实名称与类别。 */
const ordered = (category: CatalogEntry['category']): CatalogEntry[] => entries.filter(item => item.category === category).sort((left, right) => {
  const a = left.catalog!.order;
  const b = right.catalog!.order;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference) return difference;
  }
  return left.id.localeCompare(right.id);
});
/** 查找实际源条目，缺少样本立即失败。 */
const actual = (id: string): CatalogEntry => {
  const item = entries.find(row => row.id === id);
  if (!item) throw new Error(`真实固定版本缺少测试条目：${id}`);
  return item;
};

describe.skipIf(!repository || !existsSync(repository))('真实基础资料排序与专属筛选', () => {
  beforeAll(async () => {
    const source = await readMyssalHttpFixture(repository!);
    tables = Object.fromEntries(await Promise.all(coreTablePaths.map(async file => {
      const response = await source.fetch(`https://raw.githubusercontent.com/myssal/PGR_Data/${revision}/cn/bytes/${file}`);
      return [file, await response.json()];
    }))) as SourceTables;
    entries = normalizeCore(tables).entries;
  }, 30_000);

  it('六类全部提供有限排序元组和各自完整筛选维度', () => {
    const required: Record<string, string[]> = {
      character: ['element', 'profession', 'rarity', 'frameType', 'effect', 'enhancement', 'collaboration'],
      memory: ['rarity', 'archiveGroup', 'purpose', 'character', 'setSize'],
      weapon: ['rarity', 'weaponType', 'character', 'configKind'],
      resonance: ['resonanceType', 'character', 'profession', 'skillType', 'slot'],
      pet: ['rarity', 'element', 'character', 'partnerType', 'function'],
      dictionary: ['dictionaryType'],
    };
    expect(entries).toHaveLength(1259);
    for (const item of entries) {
      expect(item.catalog?.order.length, item.id).toBeGreaterThan(0);
      expect(item.catalog?.order.every(Number.isFinite), item.id).toBe(true);
      expect(Object.keys(item.catalog!.facets).sort(), item.id).toEqual(required[item.category].sort());
      for (const values of Object.values(item.catalog!.facets)) expect(values.length && values.every(value => typeof value === 'string' && value.trim()), item.id).toBeTruthy();
    }
  });

  it('机体按Priority而非人物家族ID排，辅助机按自身Priority排', () => {
    expect(ordered('character').slice(0, 3).map(item => item.name)).toEqual(['莱亚·祈星', '阿德莱德·破渊', '时崎狂三']);
    const characters = ordered('character');
    expect(characters.findIndex(item => item.id === 'character:1021007')).toBeLessThan(characters.findIndex(item => item.id === 'character:1571003'));
    expect(Number(actual('character:1021007').sourceKey)).toBeLessThan(Number(actual('character:1571003').sourceKey));
    expect(ordered('pet').slice(0, 3).map(item => item.name)).toEqual(['聆璃', '凯尔派', '刻刻帝']);
    expect(actual('pet:16420000').catalog?.facets.partnerType).toEqual(['联动辅助机']);
    expect(actual('character:1411003').catalog?.facets.collaboration).toEqual(['联动机体']);
  });

  it('常规六星意识按同序列倒序，活动独立编号不会挤到前面', () => {
    const memories = ordered('memory');
    expect(memories.slice(0, 5).map(item => item.name)).toEqual(['莫斯梅', '裴桑朵', '圣地亚哥', '柯绮朵', '克卢修丝']);
    expect(memories.findIndex(item => item.id === 'memory:20002')).toBeGreaterThan(memories.findIndex(item => item.id === 'memory:1666'));
    expect(actual('memory:1616').catalog?.facets.purpose).toEqual(['独域']);
    expect(actual('memory:1645').catalog?.facets.purpose).toEqual(['效应']);
    expect(actual('memory:1621').catalog?.facets.archiveGroup).toEqual(['未提供']);
    expect(actual('memory:1607').catalog?.facets.setSize).toEqual(['2件套', '4件套', '6件套']);
  });

  it('意识多值推荐按源引用分开保留，断链不会静默吞掉', () => {
    // 使用真实套装和机体，仅将客户端支持的竖线字段扩展为两个真实推荐对象。
    const multiple = structuredClone(tables);
    multiple['share/equip/EquipSuit.json'].find(row => row.Id === 1666)!.RecommendCharacterId = '1431003|1421003';
    multiple['share/equip/EquipSuit.json'].find(row => row.Id === 1666)!.EquipType = '3|8';
    const result = normalizeCore(multiple).entries.find(item => item.id === 'memory:1666')!;
    expect(result.catalog?.facets.character).toEqual(['莱亚·祈星', '阿德莱德·破渊']);
    expect(result.catalog?.facets.purpose).toEqual(['冰', '辅助']);
    expect(result.relatedIds).toEqual(['character:1431003', 'character:1421003']);
    multiple['share/equip/EquipSuit.json'].find(row => row.Id === 1666)!.RecommendCharacterId = '1431003|9999999';
    expect(() => normalizeCore(multiple)).toThrow(/推荐机体/);
  });

  it('武器只使用明确推荐关系，并将时装或特殊配置放后', () => {
    expect(ordered('weapon')[0].name).toBe('扭曲缎带的边陲');
    expect(actual('weapon:2706001').catalog?.facets.weaponType).toEqual(['遣光鞭绳']);
    expect(actual('weapon:2126001').catalog?.facets.character).toEqual(['2B']);
    expect(actual('weapon:2026003').catalog?.basis).toBe('configuration');
    expect(actual('weapon:2026003').catalog?.facets.character).toEqual(['未提供']);
    expect(ordered('weapon').slice(-13).every(item => item.catalog?.facets.configKind.includes('时装或特殊配置'))).toBe(true);
  });

  it('共享共鸣不会因最新机体排序变化变新，技能和槽位仍保留多值适用信息', () => {
    const shared = actual('resonance:weapon-skill-101');
    expect(shared.catalog?.basis).toBe('definition');
    expect(shared.catalog?.facets.character).toHaveLength(79);
    expect(shared.catalog?.facets.slot).toEqual(['武器1号位', '武器2号位', '武器3号位']);
    const changed = structuredClone(tables);
    changed['share/character/Character.json'].find(row => row.Id === 1431003)!.Priority = 999999;
    const newer = normalizeCore(changed).entries.find(item => item.id === shared.id)!;
    expect(newer.catalog?.order).toEqual(shared.catalog?.order);
    expect(ordered('resonance')[0].catalog?.facets.character).toEqual(['莱亚·祈星']);
    expect(actual('resonance:character-skill-1').catalog?.facets.slot).toEqual(['意识上排']);
    expect(actual('resonance:character-skill-6').catalog?.facets.skillType).toEqual(['QTE技能']);
    expect(actual('resonance:attribute-30').catalog?.facets.resonanceType).toEqual(['意识属性共鸣']);
  });

  it('字典按定义类型分组，效应占位项放在最后', () => {
    const dictionaries = ordered('dictionary');
    expect([...new Set(dictionaries.filter(item => item.name !== '无效应').map(item => item.subtitle))]).toEqual(['属性', '职业', '角色品级', '队伍效应', '技能类型']);
    expect(dictionaries[0].name).toBe('物理');
    expect(dictionaries.at(-1)?.name).toBe('无效应');
  });
});
