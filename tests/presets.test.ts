import { describe, expect, it } from 'vitest';
import { createPreset, createPresetMemorySet } from '../src/shared/presets';
import { createGuideMember } from '../src/shared/guides';
import { applyPresetConfiguration, updateCharacterPresetFromMember } from '../src/renderer/preset-config';
import { presetSchema } from '../src/main/preset-schema';
import { reactive } from 'vue';

describe('三类独立预设', () => {
  it('关闭共享谐振会清理全部方案的隐藏绑定，不更改其他意识搭配', () => {
    const preset = createPreset('character');
    preset.memorySets = [createPresetMemorySet('一'), createPresetMemorySet('二')];
    for (const set of preset.memorySets) { set.harmonizationMemoryId = 'memory:extra'; set.memories = [{ memoryId: 'memory:base', count: 6 }]; }
    const member = createGuideMember('blue');
    member.memories = [{ memoryId: 'memory:changed', count: 6 }];
    updateCharacterPresetFromMember(preset, member, preset.memorySets[0].id, []);
    expect(preset.memorySets.map(set => set.harmonizationMemoryId)).toEqual(['', '']);
    expect(preset.memorySets[1].memories).toEqual([{ memoryId: 'memory:base', count: 6 }]);
  });
  it('意识和辅助机各自保存，不接受旧组合通用预设', () => {
    const memory = { ...createPreset('memory'), name: '意识搭配' };
    const pet = { ...createPreset('pet'), name: '辅助机技能' };
    expect(presetSchema.parse(memory)).toEqual(memory);
    expect(presetSchema.parse(pet)).toEqual(pet);
    expect(presetSchema.safeParse({ ...memory, kind: 'general' }).success).toBe(false);
    expect(presetSchema.safeParse({ ...memory, pet: pet.pet }).success).toBe(false);
    expect(presetSchema.safeParse({ ...pet, memory: memory.memory }).success).toBe(false);
  });
  it('机体保留多套独立意识方案，拒绝重复方案标识', () => {
    const value = { ...createPreset('character'), name: '机体', characterId: 'character:1', memorySets: [createPresetMemorySet('方案一'), createPresetMemorySet('方案二')] };
    expect(presetSchema.safeParse(value).success).toBe(true);
    value.memorySets[1].id = value.memorySets[0].id;
    expect(presetSchema.safeParse(value).success).toBe(false);
  });
  it('引入意识不会覆盖辅助机、机体培养或武器', () => {
    const target = { ...createGuideMember('red', 'stable'), characterId: 'character:a', evolutionId: '6:3', weaponId: 'weapon:a', pet: { petId: 'pet:a', quality: 3, activeSkillId: 'active', passiveSkillIds: ['passive'] } };
    const preset = reactive(createPreset('memory'));
    const result = applyPresetConfiguration(preset, '', target, []);
    expect(result.issues).toEqual([]);
    expect(result.member).toMatchObject({ id: 'stable', position: 'red', characterId: target.characterId, evolutionId: target.evolutionId, weaponId: target.weaponId, pet: target.pet });
    result.member.pet.passiveSkillIds.push('changed');
    expect(target.pet.passiveSkillIds).toEqual(['passive']);
  });
  it('引入辅助机不会覆盖意识、共鸣和谐振', () => {
    const target = createGuideMember('blue');
    target.memories = [{ memoryId: 'memory:1', count: 6 }];
    target.memoryResonance.lower = [{ resonanceId: 'resonance:1', count: 6 }];
    target.harmonization = { level: 1, memoryId: 'memory:2' };
    const preset = reactive(createPreset('pet'));
    preset.pet.petId = 'pet:1';
    const result = applyPresetConfiguration(preset, '', target, []);
    expect(result.member.pet.petId).toBe('pet:1');
    expect(result.member.memories).toEqual(target.memories);
    expect(result.member.memoryResonance).toEqual(target.memoryResonance);
    expect(result.member.harmonization).toEqual(target.harmonization);
    result.member.pet.passiveSkillIds.push('changed');
    expect(preset.pet.passiveSkillIds).toEqual([]);
  });
  it('通用类型没有匹配时报告问题，不生成猜测技能', () => {
    const preset = createPreset('memory');
    preset.memory.resonance.lower = [{ kind: 'skillType', value: '必杀技能', count: 6 }];
    const result = applyPresetConfiguration(preset, '', createGuideMember('blue'), []);
    expect(result.issues[0]).toContain('不适用');
    expect(result.member.memoryResonance.lower).toEqual([]);
  });
});
