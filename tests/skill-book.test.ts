import { describe, expect, it } from 'vitest';
import type { EntrySection, SkillSectionMetadata } from '../src/shared/types';
import { groupSkillSections, resolveSkillSelection, skillSelectionKeys } from '../src/renderer/skill-book';

/** 使用小型源关系构造不同组、家族和变体，正文包含需要完整保留的差异。 */
const section = (id: string, metadata: Partial<SkillSectionMetadata> = {}, body = `技能 ${id} 的完整说明`): EntrySection => ({
  title: '同名技能', body,
  skill: { kind: 'character', id, groupId: 'source-group', groupName: '来源大类', groupOrder: 1, familyId: 'source-family', familyName: '来源技能组', typeName: '普通攻击', level: 35, ...metadata },
});

describe('技能书按源关系组织与选择', () => {
  it('大类只按来源顺序排列，类内家族及同名技能保留输入顺序', () => {
    const input = [
      section('900', { groupId: 'later', groupName: '独域技能', groupOrder: 9, familyId: 'family-z' }),
      section('30', { familyId: 'family-b' }),
      section('2', { familyId: 'family-a' }),
      section('1', { familyId: 'family-b' }),
      section('40', { groupId: 'same-order', groupName: '其他来源大类', groupOrder: 1 }),
    ];
    const original = structuredClone(input);
    const grouped = groupSkillSections(input);
    expect(grouped.map(group => group.name)).toEqual(['来源大类', '其他来源大类', '独域技能']);
    expect(grouped[0].families.map(family => family.id)).toEqual(['family-b', 'family-a']);
    expect(grouped[0].families[0].variants.map(variant => variant.section.skill.id)).toEqual(['30', '1']);
    expect(grouped[0].families[0].variants.map(variant => variant.label)).toEqual(['技能版本 1', '技能版本 2']);
    expect(input).toEqual(original);
  });

  it('两个主动家族的属性版本全部可访问，持续时间差异不合并', () => {
    const input = [
      section('101', { kind: 'pet-active', familyId: 'first', element: { id: 1, name: '物理' }, level: 5 }, '造成750%物理伤害。\n持续8秒。'),
      section('102', { kind: 'pet-active', familyId: 'first', element: { id: 2, name: '火' }, level: 5 }, '造成750%火属性伤害。\n持续4秒。'),
      section('201', { kind: 'pet-active', familyId: 'second', element: { id: 1, name: '物理' }, level: 5 }, '格挡成功造成1000%伤害。'),
    ];
    const grouped = groupSkillSections(input);
    expect(grouped[0].families).toHaveLength(2);
    expect(grouped[0].families[0].variants.map(variant => variant.label)).toEqual(['物理', '火']);
    expect(grouped.flatMap(group => group.families.flatMap(family => family.variants.map(variant => variant.section.body)))).toEqual(input.map(item => item.body));
    expect(new Set(grouped[0].families.flatMap(family => family.variants.map(variant => variant.key))).size).toBe(3);
  });

  it('不同升阶阶段用真实类型命名，同阶段不同记录仍有独立版本按钮', () => {
    const grouped = groupSkillSections([
      section('phase-1', { typeName: 'S5升阶效果' }),
      section('phase-2', { typeName: 'SS升阶效果' }),
      section('phase-3', { typeName: 'SS升阶效果' }),
    ]);
    expect(grouped[0].families[0].variants.map(variant => variant.label)).toEqual(['S5升阶效果', 'SS升阶效果 · 技能版本 1', 'SS升阶效果 · 技能版本 2']);
  });

  it('重复属性或源标识也不会静默丢失某一份说明', () => {
    const input = [section('same', { kind: 'pet-active', element: { id: 1, name: '物理' } }, '第一份'), section('same', { kind: 'pet-active', element: { id: 1, name: '物理' } }, '第二份')];
    const variants = groupSkillSections(input)[0].families[0].variants;
    expect(variants.map(variant => variant.label)).toEqual(['物理 · 技能版本 1', '物理 · 技能版本 2']);
    expect(new Set(variants.map(variant => variant.key)).size).toBe(2);
    expect(variants.map(variant => variant.section.body)).toEqual(['第一份', '第二份']);
  });

  it('同一选择在改名和替换正文后使用最新段落，而不缓存旧内容', () => {
    const initial = groupSkillSections([section('first'), section('chosen')]);
    const old = { group: initial[0], family: initial[0].families[0], variant: initial[0].families[0].variants[1] };
    const edited = section('chosen', {}, '数值100%\n\n持续8秒\n<script>只是纯文本</script>');
    edited.title = '本地修订名称';
    const selected = resolveSkillSelection(groupSkillSections([section('first'), edited]), skillSelectionKeys(old));
    expect(selected?.variant.section).toBe(edited);
    expect(selected?.variant.section.title).toBe('本地修订名称');
    expect(selected?.variant.section.body).toBe(edited.body);
  });

  it('当前变体、家族或大类移除时回退到现存项，空输入不残留选择', () => {
    const source = [section('first'), section('chosen'), section('other-family', { familyId: 'other' }), section('other-group', { groupId: 'other-group', groupOrder: 2 })];
    const initial = groupSkillSections(source);
    const previous = skillSelectionKeys({ group: initial[0], family: initial[0].families[0], variant: initial[0].families[0].variants[1] });
    expect(resolveSkillSelection(groupSkillSections([source[0], source[2], source[3]]), previous)?.variant.section.skill.id).toBe('first');
    expect(resolveSkillSelection(groupSkillSections([source[2], source[3]]), previous)?.variant.section.skill.id).toBe('other-family');
    expect(resolveSkillSelection(groupSkillSections([source[3]]), previous)?.variant.section.skill.id).toBe('other-group');
    expect(resolveSkillSelection([], previous)).toBeNull();
  });

  it('没有技能元数据的自定义正文不按标题归类，交给详情页原样展示', () => {
    const notes = [{ title: '主动技能 · 我的说明', body: '自定义内容' }, { title: '红色信号', body: '普通段落' }];
    expect(groupSkillSections(notes)).toEqual([]);
    expect(resolveSkillSelection(groupSkillSections(notes), null)).toBeNull();
  });
});
