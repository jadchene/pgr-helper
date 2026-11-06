import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/shared/types';
import { normalizeStages, stageTablePaths } from '../src/main/sources/normalize-stages';

const repository = process.env.PGR_DATA_REPOSITORY;
const revision = '170abcceee1fdbdee00a8770830ef80680a6ceca';
const execute = promisify(execFile);
let tables: Record<string, Record<string, unknown>[]>;
let entries: CatalogEntry[];

/** 按约定的数值元组降序比较，不把不同来源的编号拼成时间戳。 */
const byCatalogOrder = (left: CatalogEntry, right: CatalogEntry): number => {
  const a = left.catalog!.order;
  const b = right.catalog!.order;
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    const difference = (b[index] ?? 0) - (a[index] ?? 0);
    if (difference) return difference;
  }
  return left.id.localeCompare(right.id);
};

/** 要求指定真实条目存在，避免可选链掩盖样本缺失。 */
const findEntry = (id: string): CatalogEntry => {
  const item = entries.find(value => value.id === id);
  if (!item) throw new Error(`固定版本缺少测试条目：${id}`);
  return item;
};

describe.skipIf(!repository)('固定国服源表的副本与天气目录信息', () => {
  beforeAll(async () => {
    const paths = [...stageTablePaths, 'share/character/CharacterGeneralSkill.json'];
    const result = await Promise.all(paths.map(async path => {
      const { stdout } = await execute('git', ['-C', repository!, 'show', `${revision}:cn/bytes/${path}`], {
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, timeout: 30_000, windowsHide: true,
      });
      return [path, JSON.parse(stdout)] as const;
    }));
    tables = Object.fromEntries(result);
    entries = normalizeStages(tables).entries;
  });

  it('540 条资料全部有配置排序及有效的专属多值条件，不声称推出日期', () => {
    expect(entries).toHaveLength(540);
    const stageKeys = new Set(['gameplay', 'mode', 'boss', 'difficulty', 'area', 'element', 'effect', 'configStatus']);
    const weatherKeys = new Set(['gameplay', 'weatherType', 'affixType', 'effect', 'boss', 'module']);
    for (const item of entries) {
      expect(item.catalog?.basis).toBe('configuration');
      expect(item.catalog!.order.every(Number.isSafeInteger)).toBe(true);
      expect(Object.keys(item.catalog!).sort()).toEqual(['basis', 'facets', 'order']);
      const allowed = item.category === 'stage' ? stageKeys : weatherKeys;
      for (const [key, values] of Object.entries(item.catalog!.facets)) {
        expect(allowed.has(key)).toBe(true);
        expect(values.length).toBeGreaterThan(0);
        expect(values.every(value => typeof value === 'string' && !!value.trim())).toBe(true);
        expect(new Set(values).size).toBe(values.length);
      }
      expect(item.catalog!.facets.gameplay).toHaveLength(1);
    }
  });

  it('玩法分组先于编号，战区倒序后是普通囚笼和鏖战', () => {
    const sorted = entries.filter(item => item.category === 'stage').sort(byCatalogOrder);
    expect(sorted).toHaveLength(367);
    expect(sorted.slice(0, 3).map(item => item.id)).toEqual(['stage:arena-259', 'stage:arena-258', 'stage:arena-257']);
    expect(sorted[258].id).toBe('stage:arena-1');
    expect(sorted.slice(0, 259).every(item => item.catalog!.facets.gameplay.includes('纷争战区'))).toBe(true);
    expect(sorted.slice(259, 360).every(item => item.catalog!.facets.mode.includes('普通'))).toBe(true);
    expect(sorted.slice(360).every(item => item.catalog!.facets.mode.includes('鏖战'))).toBe(true);
    expect(sorted[259].id).toBe('stage:boss-2044-v1');
    const current = findEntry('stage:boss-101-v1');
    const historical = findEntry('stage:boss-2022-v0');
    expect(sorted.indexOf(current)).toBeLessThan(sorted.indexOf(historical));
    expect(current.catalog!.order).toEqual([2, 1, 44]);
  });

  it('保留多元素、多效应和完整难度，历史配置代次不误称游戏版本', () => {
    const mixed = findEntry('stage:arena-32');
    expect(mixed.catalog!.facets.element).toEqual(['火', '物理']);
    expect(findEntry('stage:arena-259').catalog!.facets.effect).toEqual(['黯衍', '紊乱']);
    expect(findEntry('stage:arena-259').catalog!.facets.element).toBeUndefined();
    expect(findEntry('stage:arena-16').catalog!.facets.configStatus).toEqual(['已废弃']);
    const historical = findEntry('stage:boss-101-v0');
    expect(historical.catalog!.facets.difficulty).toEqual(['实验', '精英', '骑士', '混沌', '地狱', '隐藏']);
    expect(historical.catalog!.facets.configStatus).toEqual(['历史配置']);
    expect(historical.attributes['配置代次']).toBe('0');
    expect(findEntry('stage:boss-101-v1').attributes['配置代次']).toBe('1');
    expect(findEntry('stage:boss-2025-v1').catalog!.facets).toMatchObject({ mode: ['鏖战'], boss: ['拉弥亚'], difficulty: ['鏖战'], area: ['鏖战点'] });
    expect(entries.every(item => !Object.hasOwn(item.attributes, '配置版本'))).toBe(true);
  });

  it('固定与可选词缀使用独立编号分组，新增 71/72 不被旧 1001 压后', () => {
    const sorted = entries.filter(item => item.category === 'weather').sort(byCatalogOrder);
    expect(sorted[0].id).toBe('weather:arena-4233');
    expect(sorted.slice(0, 54).every(item => item.catalog!.facets.weatherType.includes('战区天气'))).toBe(true);
    expect(sorted.slice(54, 57).map(item => item.id)).toEqual(['weather:boss-72', 'weather:boss-71', 'weather:boss-70']);
    expect(sorted.slice(54, 126).every(item => item.catalog!.facets.affixType.includes('固定词缀'))).toBe(true);
    expect(sorted.slice(126, 141).every(item => item.catalog!.facets.affixType.includes('可选词缀'))).toBe(true);
    expect(sorted.indexOf(findEntry('weather:boss-71'))).toBeLessThan(sorted.indexOf(findEntry('weather:boss-1001')));
    expect(sorted.slice(141, 170).every(item => item.catalog!.facets.weatherType.includes('固有机制'))).toBe(true);
    expect(sorted.slice(170).every(item => item.catalog!.facets.weatherType.includes('特殊特性'))).toBe(true);
  });

  it('推荐效应和模组来自明确引用，不从描述猜元素或当前周 Boss', () => {
    expect(findEntry('weather:boss-72').catalog!.facets.effect).toEqual(['覆冰']);
    expect(findEntry('weather:boss-1001').catalog!.facets.module).toContain('模组Ⅱ');
    expect(findEntry('weather:boss-buff-90001').catalog!.facets.boss).toContain('喷涂机械');
    expect(findEntry('weather:arena-4233').catalog!.facets).toEqual({ gameplay: ['纷争战区'], weatherType: ['战区天气'] });
    const challenge = entries.filter(item => item.id.startsWith('weather:boss-') && !item.id.startsWith('weather:boss-buff-') && !item.id.startsWith('weather:boss-trait-'));
    expect(challenge.filter(item => item.catalog!.facets.effect)).toHaveLength(27);
    expect(challenge.every(item => !item.catalog!.facets.boss)).toBe(true);
  });

  it('推荐效应断链和未知词缀类型拒绝导入，避免产生猜测的筛选信息', () => {
    const missing = { ...tables, 'share/character/CharacterGeneralSkill.json': [] };
    expect(() => normalizeStages(missing)).toThrow('鏖战推荐效应 引用不存在');
    const unexpected = structuredClone(tables);
    unexpected['share/fuben/bosssingle/BossSingleChallengeFeature.json'][0].Type = 3;
    expect(() => normalizeStages(unexpected)).toThrow('鏖战词缀类型无法识别');
  });

  it('259 个战区只从真实关卡对应的 BgIconBig 取得 6 张共享封面', () => {
    const areas = entries.filter(item => item.id.startsWith('stage:arena-'));
    expect(areas).toHaveLength(259);
    for (const item of areas) {
      const source = tables['share/fuben/arena/AreaStage.json'].find(row => row.Id === Number(item.sourceKey.slice(6)))!;
      const stageIds = source.StageId as number[];
      const paths = [...new Set(tables['client/fuben/arena/ArenaStage.json'].filter(row => stageIds.includes(Number(row.StageId))).map(row => row.BgIconBig))];
      expect(paths).toHaveLength(1);
      expect(item.attributes['封面资源']).toBe(paths[0]);
    }
    expect(new Set(areas.map(item => item.attributes['封面资源'])).size).toBe(6);
    expect(findEntry('stage:arena-1').attributes['封面资源']).toBe('Assets/Product/Texture/Image/UiArena/UiArenaGqxqTab001.png');
    expect(findEntry('stage:boss-101-v0').attributes['头像资源']).toBe('Assets/Product/Texture/Image/UiFubenBossSingle/BossSingleTab10.png');
    expect(findEntry('weather:boss-1').attributes['图标资源']).toBe('Assets/Product/Texture/Image/IconAffix/AffixIconNewMod1001.png');
  });
});
