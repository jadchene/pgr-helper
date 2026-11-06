import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import type { CatalogEntry } from '../src/shared/types';
import { coreTablePaths, normalizeCore } from '../src/main/sources/normalize-core';
import { plainText, type SourceTables } from '../src/main/sources/common';
import { readMyssalHttpFixture } from './helpers/myssal-http-fixture';

const repository = process.env.PGR_DATA_REPOSITORY;
const revision = '170abcceee1fdbdee00a8770830ef80680a6ceca';
let tables: SourceTables;
let pets: CatalogEntry[];

/** 固定真实条目和技能标识用于验证变体正文，缺失时立即失败。 */
const petSkill = (partnerId: number, skillId: number) => {
  const section = pets.find(entry => entry.id === `pet:${partnerId}`)?.sections.find(section => section.skill?.id === String(skillId));
  if (!section) throw new Error(`测试辅助机技能缺失：${partnerId}/${skillId}`);
  return section;
};

describe.skipIf(!repository || !existsSync(repository))('真实辅助机技能源分组', () => {
  beforeAll(async () => {
    const source = await readMyssalHttpFixture(repository!);
    tables = Object.fromEntries(await Promise.all(coreTablePaths.map(async file => {
      const response = await source.fetch(`https://raw.githubusercontent.com/myssal/PGR_Data/${revision}/cn/bytes/${file}`);
      return [file, await response.json()];
    }))) as SourceTables;
    pets = normalizeCore(tables).entries.filter(entry => entry.category === 'pet');
  }, 30_000);

  it('保留528个主动变体和220个被动正文，以88个明确源主动组组织展示', () => {
    expect(pets).toHaveLength(44);
    const sections = pets.flatMap(entry => entry.sections);
    const active = sections.filter(section => section.skill?.kind === 'pet-active');
    const passive = sections.filter(section => section.skill?.kind === 'pet-passive');
    expect(active).toHaveLength(528);
    expect(passive).toHaveLength(220);
    expect(new Set(active.map(section => section.skill!.familyId)).size).toBe(88);
    expect(new Set(passive.map(section => section.skill!.familyId)).size).toBe(220);
    expect(passive.every(section => !section.skill!.element)).toBe(true);
    const original = tables['client/partner/PartnerSkillInfo.json'];
    for (const section of sections) {
      const source = original.find(row => row.SkillId === Number(section.skill!.id) && row.Level === 5)!;
      expect(section.skill!.level).toBe(5);
      expect(section.title).toBe(source.Name);
      expect(section.body).toBe(plainText(source.Desc));
    }
    expect(petSkill(16040000, 1071).skill).toEqual({
      kind: 'pet-active', id: '1071', groupId: 'pet-active', groupName: '主动技能', groupOrder: 1,
      familyId: 'main:107', familyName: '主动技能 1', typeName: '主动', level: 5,
      element: { id: 1, name: '物理' },
    });
    expect(petSkill(16040000, 1081).skill?.familyName).toBe('主动技能 2');
  });

  it('保留持续时间、倍率、专属机制和源文可疑数值，不能合成为一个属性占位正文', () => {
    expect(petSkill(16040000, 1071).body).toContain('持续8秒。附加高级数据攻击');
    expect(petSkill(16040000, 1073).body).toContain('持续4秒。附加数据攻击');
    expect(petSkill(16080000, 1151).body).toContain('1500%物理伤害');
    expect(petSkill(16080000, 1153).body).toContain('750%冰属性伤害');
    expect(petSkill(16080000, 1153).body).toContain('额外伤害加成提高3%');
    expect(petSkill(16020000, 1035).body).toContain('引爆时造成200%暗属性伤害');
    expect(petSkill(16020000, 1031).body).not.toContain('引爆印记');
    expect(petSkill(16350000, 1701).body).toContain('1次650%物理伤害');
    expect(petSkill(16350000, 1706).body).toContain('10次650%空属性伤害');
  });

  it('按显式数组位置关联属性和组顺序，同名技能仍保留独立变体', () => {
    const changed = structuredClone(tables);
    const pet = changed['share/partner/PartnerSkill.json'].find(row => row.PartnerId === 16010000)!;
    pet.MainSkillGroupId = [102, 101];
    const group = changed['share/partner/PartnerMainSkillGroup.json'].find(row => row.Id === 102)!;
    group.SkillId = [1026, 1021];
    group.Element = [6, 1];
    for (const row of changed['client/partner/PartnerSkillInfo.json']) {
      if (row.SkillId === 1026 || row.SkillId === 1021) row.Name = '同名测试技能';
    }
    const sections = normalizeCore(changed).entries.find(entry => entry.id === 'pet:16010000')!.sections;
    expect(sections.slice(0, 2).map(section => ({ name: section.title, id: section.skill!.id, element: section.skill!.element }))).toEqual([
      { name: '同名测试技能', id: '1026', element: { id: 6, name: '空' } },
      { name: '同名测试技能', id: '1021', element: { id: 1, name: '物理' } },
    ]);
    expect(sections[0].skill?.familyId).toBe('main:102');
    expect(sections[0].skill?.familyName).toBe('主动技能 1');
    expect(sections[2].skill?.familyName).toBe('主动技能 2');
  });

  it.each([
    ['属性数组少一项', 'Element', [1, 2, 3, 4, 5]],
    ['属性空槽不能压缩后错位', 'Element', [1, 2, 0, 4, 5, 6]],
    ['属性重复', 'Element', [1, 2, 3, 4, 5, 5]],
    ['属性未定义', 'Element', [1, 2, 3, 4, 5, 999]],
    ['技能引用重复', 'SkillId', [1011, 1012, 1013, 1014, 1015, 1015]],
    ['技能空槽不能压缩后错位', 'SkillId', [1011, 1012, 0, 1014, 1015, 1016]],
    ['技能引用未定义', 'SkillId', [1011, 1012, 1013, 1014, 1015, 999999]],
  ])('拒绝%s，不能发布部分缺失的技能组', (_name, field, values) => {
    const changed = structuredClone(tables);
    changed['share/partner/PartnerMainSkillGroup.json'].find(row => row.Id === 101)![field] = values;
    expect(() => normalizeCore(changed)).toThrow(/辅助机技能/);
  });

  it('拒绝同一辅助机重复组引用及重复的最高等级定义', () => {
    const repeatedGroup = structuredClone(tables);
    repeatedGroup['share/partner/PartnerSkill.json'].find(row => row.PartnerId === 16010000)!.MainSkillGroupId = [101, 101];
    expect(() => normalizeCore(repeatedGroup)).toThrow(/辅助机技能组引用重复/);
    const repeatedLevel = structuredClone(tables);
    repeatedLevel['client/partner/PartnerSkillInfo.json'].push({ ...repeatedLevel['client/partner/PartnerSkillInfo.json'].find(row => row.SkillId === 1011 && row.Level === 5)! });
    expect(() => normalizeCore(repeatedLevel)).toThrow(/辅助机技能最高等级重复/);
  });
});
