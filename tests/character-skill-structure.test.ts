import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/shared/types';
import { entrySchema } from '../src/main/schemas';
import { coreTablePaths, normalizeCore } from '../src/main/sources/normalize-core';
import { plainText, type SourceTables } from '../src/main/sources/common';
import { readMyssalHttpFixture } from './helpers/myssal-http-fixture';

const repository = process.env.PGR_DATA_REPOSITORY;
const revision = '170abcceee1fdbdee00a8770830ef80680a6ceca';
let tables: SourceTables;
let characters: CatalogEntry[];

/** 使用真实源主键定位样本，不按名称猜测机体或技能分类。 */
const character = (id: number): CatalogEntry => {
  const result = characters.find(item => item.id === `character:${id}`);
  if (!result) throw new Error(`真实版本缺少机体：${id}`);
  return result;
};

describe.skipIf(!repository || !existsSync(repository))('真实机体技能源结构', () => {
  beforeAll(async () => {
    const source = await readMyssalHttpFixture(repository!);
    tables = Object.fromEntries(await Promise.all(coreTablePaths.map(async file => {
      const response = await source.fetch(`https://raw.githubusercontent.com/myssal/PGR_Data/${revision}/cn/bytes/${file}`);
      return [file, await response.json()];
    }))) as SourceTables;
    characters = normalizeCore(tables).entries.filter(item => item.category === 'character');
  }, 30_000);

  it('86机体的全部1535段保留源分类、名称、等级与有效契约', () => {
    expect(characters).toHaveLength(86);
    const sections = characters.flatMap(item => item.sections);
    expect(sections).toHaveLength(1535);
    expect(sections.filter(item => item.skill?.id.startsWith('character-skill:'))).toHaveLength(1131);
    expect(sections.filter(item => item.skill?.id.startsWith('character-quality:'))).toHaveLength(308);
    expect(sections.filter(item => item.skill?.id.startsWith('character-enhancement:'))).toHaveLength(96);
    const sourceNames = new Map<number, { name: string; level: number }>();
    for (const row of tables['client/character/skill/CharacterSkillUpgradeDes.json']) {
      const id = row.SkillId as number;
      const level = (row.Level as number | undefined) ?? 0;
      if (!sourceNames.has(id) || sourceNames.get(id)!.level < level) sourceNames.set(id, { name: plainText(row.Name), level });
    }
    for (const item of characters) {
      expect(() => entrySchema.parse(item), item.id).not.toThrow();
      expect(new Set(item.sections.map(section => section.skill?.id)).size, item.id).toBe(item.sections.length);
      for (const groupId of [1, 2, 3, 4]) expect(item.sections.some(section => section.skill?.groupId === `character-gate:${groupId}`), item.id).toBe(true);
      for (const section of item.sections) {
        expect(section.skill?.kind, item.id).toBe('character');
        if (section.skill!.id.startsWith('character-skill:')) {
          const source = sourceNames.get(Number(section.skill!.id.split(':')[1]))!;
          expect(section.title).toBe(source.name);
          expect(section.skill!.level).toBe(source.level);
        }
      }
    }
    expect(character(1011002).sections.slice(0, 4).map(section => section.skill?.groupName)).toEqual(Array(4).fill('基础技能'));
    expect(character(1011002).sections[12].skill).toMatchObject({ groupId: 'character-gate:3', groupName: '通用效果', typeName: '终阶解放' });
  });

  it('同名切换配置按源数组保留，不按名称合并或按技能ID排序', () => {
    const qte = character(1031005).sections.filter(section => section.skill?.familyId === 'character-skill-group:1035180');
    expect(qte.map(section => section.skill?.id)).toEqual(['character-skill:103528', 'character-skill:103518']);
    expect(qte.map(section => section.title)).toEqual(['于寰宇中清歌', '于寰宇中清歌']);
    expect(qte.every(section => section.skill?.groupName === '特殊技能' && section.skill.typeName === 'QTE技能')).toBe(true);
    const leap = character(1021005).sections.filter(section => section.skill?.familyId === 'character-enhancement-group:1025280');
    expect(leap.map(section => section.skill?.id)).toEqual(['character-enhancement:102531', 'character-enhancement:102528']);
    expect(leap.map(section => section.title)).toEqual(['疾光掣岚', '疾光掣岚']);
    expect(leap[0].body).not.toBe(leap[1].body);
  });

  it('升阶阶段保留到母技能族，正文不丢且不把阶段标成普通等级', () => {
    const sourceRows = tables['client/character/quality/CharacterSkillQualityApart.json'].filter(row => row.CharacterId === 1071004);
    const quality = character(1071004).sections.filter(section => section.skill?.id.startsWith('character-quality:'));
    expect(quality.map(section => section.skill?.typeName)).toEqual(['升阶 · S5', '升阶 · SS', '升阶 · SS3', '升阶 · SSS', '升阶 · SSS3', '升阶 · SSS6', '升阶 · SSS+']);
    expect(quality.every(section => section.skill?.groupName === '进化效果' && section.skill.level === undefined)).toBe(true);
    for (const [index, section] of quality.entries()) {
      expect(section.title).toBe(sourceRows[index].Name);
      expect(section.body).toBe(plainText(sourceRows[index].Intro));
      expect(character(1071004).sections.some(base => base.skill?.id.startsWith('character-skill:') && base.skill.familyId === section.skill!.familyId)).toBe(true);
    }
  });

  it('区分20机体跃升与7独域技能，属性和筛选计数不再混用', () => {
    const leaps = characters.filter(item => item.catalog?.facets.enhancement.includes('有跃升技能'));
    const uniframes = characters.filter(item => item.attributes['独域技能']);
    expect(leaps).toHaveLength(20);
    expect(leaps.reduce((count, item) => count + Number(item.attributes['跃升技能']), 0)).toBe(61);
    expect(uniframes).toHaveLength(7);
    expect(uniframes.reduce((count, item) => count + Number(item.attributes['独域技能']), 0)).toBe(35);
    for (const item of uniframes) {
      expect(item.attributes['跃升技能']).toBeUndefined();
      expect(item.catalog?.facets.enhancement).toEqual(['无跃升技能']);
      const skills = item.sections.filter(section => section.skill?.id.startsWith('character-enhancement:'));
      expect(skills).toHaveLength(5);
      expect(skills.every(section => section.skill?.groupId === 'character-gate:5' && section.skill.groupName === '独域技能')).toBe(true);
    }
  });

  it('来源改名及新增有定义的增强类型仍可分类，不依赖标题正则', () => {
    const changed = structuredClone(tables);
    changed['client/character/skill/CharacterSkillGate.json'].find(row => row.Id === 1)!.Name = '来源定义的新类别';
    for (const row of changed['client/character/skill/CharacterSkillUpgradeDes.json'].filter(row => row.SkillId === 101201)) row.Name = '任意技能名称';
    changed['share/character/enhanceskill/EnhanceSkillType.json'].find(row => row.Id === 101228)!.Type = 99;
    changed['client/character/enhanceskill/EnhanceSkillTypeInfo.json'].push({ Type: 99, Name: '来源新增增强类型' });
    const result = normalizeCore(changed).entries.find(item => item.id === 'character:1011002')!;
    expect(result.sections[0]).toMatchObject({ title: '任意技能名称', skill: { groupId: 'character-gate:1', groupName: '来源定义的新类别' } });
    expect(result.sections.find(section => section.skill?.id === 'character-enhancement:101228')?.skill).toMatchObject({ groupId: 'character-enhancement-type:99', groupName: '来源新增增强类型', groupOrder: 199 });
    expect(result.attributes['跃升技能']).toBe('2');
  });

  it('缺失分类、错位Pos及升阶断链拒绝候选，原有QTE校验继续生效', () => {
    const missingGate = structuredClone(tables);
    missingGate['client/character/skill/CharacterSkillGate.json'] = missingGate['client/character/skill/CharacterSkillGate.json'].filter(row => row.Id !== 1);
    expect(() => normalizeCore(missingGate)).toThrow(/机体技能分类/);
    const mismatch = structuredClone(tables);
    (mismatch['share/character/skill/CharacterSkill.json'][0].Pos as number[]).pop();
    expect(() => normalizeCore(mismatch)).toThrow(/位置数量不匹配/);
    const brokenQuality = structuredClone(tables);
    brokenQuality['client/character/quality/CharacterSkillQualityApart.json'][0].SkillId = 999999;
    expect(() => normalizeCore(brokenQuality)).toThrow(/升阶说明缺少机体技能关联/);
    const noQte = structuredClone(tables);
    noQte['share/character/skill/CharacterSkillType.json'].find(row => row.Id === 101218)!.Type = 5;
    expect(() => normalizeCore(noQte)).toThrow(/QTE 类型缺失/);
  });
});
