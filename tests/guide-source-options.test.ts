import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GuideEntryOptions } from '../src/shared/guide-options';
import { coreTablePaths, normalizeCore } from '../src/main/sources/normalize-core';
import { guideOptionTablePaths, normalizeGuideOptions } from '../src/main/sources/normalize-guide-options';
import { type SourceTables } from '../src/main/sources/common';

const repository = process.env.PGR_DATA_REPOSITORY;
const revision = '170abcceee1fdbdee00a8770830ef80680a6ceca';
const execute = promisify(execFile);
let tables: SourceTables;
let options: Map<string, GuideEntryOptions>;

describe.skipIf(!repository || !existsSync(repository))('攻略选项真实源表', () => {
  beforeAll(async () => {
    const files = [...new Set([...coreTablePaths, ...guideOptionTablePaths])];
    tables = {};
    let next = 0;
    // 审计仓库只供测试读取固定对象；生产同步仍逐表走远程协议。
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < files.length) {
        const file = files[next++];
        const { stdout } = await execute('git', ['-C', repository!, 'show', `${revision}:cn/bytes/${file}`], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 });
        tables[file] = JSON.parse(stdout);
      }
    }));
    options = normalizeGuideOptions(tables);
  }, 30_000);

  it('四类配置选项覆盖当前全部资料且所有引用指向实际条目与技能', () => {
    const entries = normalizeCore(tables).entries;
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const expected = entries.filter(entry => ['character', 'memory', 'weapon', 'pet'].includes(entry.category)).map(entry => entry.id).sort();
    expect([...options.keys()].sort()).toEqual(expected);
    expect(options.size).toBe(486);
    for (const [id, option] of options) {
      const entry = byId.get(id)!;
      const skillIds = new Set(entry.sections.map(section => section.skill?.id));
      for (const stage of option.evolutionStages ?? []) for (const effect of stage.effectSectionIds) expect(skillIds.has(effect), `${id}/${effect}`).toBe(true);
      for (const group of option.activeSkillGroups ?? []) for (const skill of group.skillIds) expect(skillIds.has(skill), `${id}/${skill}`).toBe(true);
      for (const skill of option.passiveSkillIds ?? []) expect(skillIds.has(skill), `${id}/${skill}`).toBe(true);
      for (const effect of option.effectIds ?? []) expect(byId.get(effect)?.category).toBe('dictionary');
      for (const slot of option.resonanceSlots ?? []) for (const choice of slot.choices) {
        expect(byId.get(choice.resonanceId)?.category, `${id}/${choice.resonanceId}`).toBe('resonance');
        for (const characterId of choice.characterIds) expect(byId.get(characterId)?.category).toBe('character');
      }
      for (const level of option.harmonizationLevels ?? []) for (const memoryId of level.memoryIds) expect(byId.get(memoryId)?.category).toBe('memory');
    }
  });

  it('进化以品级和阶段独立定位，SSS与SSS3保留不同的实际技能效果', () => {
    const stages = options.get('character:1071004')!.evolutionStages!;
    const sss = stages.find(stage => stage.label === 'SSS')!;
    const sss3 = stages.find(stage => stage.label === 'SSS3')!;
    expect(sss).toMatchObject({ id: '5:0', quality: 5, phase: 0 });
    expect(sss3).toMatchObject({ id: '5:3', quality: 5, phase: 3 });
    expect(sss.effectSectionIds.length).toBeGreaterThan(0);
    expect(sss3.effectSectionIds.length).toBeGreaterThan(0);
    expect(sss.effectSectionIds).not.toEqual(sss3.effectSectionIds);
    expect(stages.some(stage => stage.label === 'S5')).toBe(true);
    expect(stages.at(-1)?.label).toBe('SSS+');
    expect([...options.values()].reduce((count, option) => count + (option.evolutionStages ?? []).reduce((sum, stage) => sum + stage.effectSectionIds.length, 0), 0)).toBe(308);
  });

  it('辅助机只携一个主动，品级控制被动槽数，属性版本保持原技能标识', () => {
    const pet = options.get('pet:16010000')!;
    expect(pet.activeSkillSlots).toBe(1);
    expect(pet.activeSkillGroups).toHaveLength(2);
    expect(pet.activeSkillGroups![0]).toEqual({ id: 'main:101', skillIds: ['1011', '1012', '1013', '1014', '1015', '1016'] });
    expect(pet.passiveSkillIds).toHaveLength(5);
    expect(pet.partnerQualities!.map(rank => [rank.label, rank.passiveSlots])).toEqual([['A', 1], ['S', 2], ['SS', 3], ['SSS', 4], ['SSS+', 5]]);
  });

  it('意识上下位分别取源槽池，机体技能共鸣保留明确适用者', () => {
    const slots = options.get('memory:1601')!.resonanceSlots!;
    expect(slots.map(slot => slot.slot)).toEqual([1, 2]);
    const upper = slots[0].choices.filter(choice => choice.characterIds.includes('character:1011002'));
    const lower = slots[1].choices.filter(choice => choice.characterIds.includes('character:1011002'));
    expect(upper.map(choice => choice.resonanceId)).toEqual(['resonance:character-skill-1', 'resonance:character-skill-2', 'resonance:character-skill-3', 'resonance:character-skill-4']);
    expect(lower.map(choice => choice.resonanceId)).toEqual(['resonance:character-skill-5', 'resonance:character-skill-6', 'resonance:character-skill-7', 'resonance:character-skill-8']);
    expect(slots[0].choices.some(choice => choice.resonanceId.startsWith('resonance:attribute-') && !choice.characterIds.length)).toBe(true);
    expect(options.get('memory:1601')!.memorySites).toEqual([1, 2, 3, 4, 5, 6]);
    expect(options.get('memory:1601')!.memorySetSizes).toEqual([2, 4]);
  });

  it('武器共鸣逐槽和机体限定，谐振等级不当作额外意识件数', () => {
    const weapon = options.get('weapon:2016001')!;
    expect(weapon.resonanceSlots!.map(slot => slot.slot)).toEqual([1, 2, 3]);
    expect(weapon.resonanceSlots!.every(slot => slot.choices.some(choice => choice.characterIds.includes('character:1011002')))).toBe(true);
    expect(weapon.harmonizationLevels![0]).toMatchObject({ level: 1, bonusPieces: 2 });
    const awakened = options.get('weapon:2526001')!.harmonizationLevels!;
    expect(awakened.length).toBeGreaterThan(2);
    expect(awakened.every(level => level.bonusPieces === 2)).toBe(true);
    expect(awakened.find(level => level.level === 2)).toMatchObject({ label: '谐振觉醒', characterIds: ['character:1531005'] });
    expect(awakened[0].memoryIds).toContain('memory:1601');
    expect(awakened[0].memoryIds).not.toContain('memory:1616');
    expect(awakened[0].memoryIds.every(id => options.get(id)!.memoryStar! >= 6)).toBe(true);
  });

  it('源品级改名及谐振件数改变时跟随来源，拒绝不存在的阶段和共鸣池', () => {
    const changed = structuredClone(tables);
    changed['client/character/CharacterQualityIcon.json'].find(row => row.Quality === 5)!.Desc = '新进化名称';
    changed['share/equip/EquipConfig.json'].find(row => row.Key === 'WeaponOverrunActiveSuitNum')!.Values = [3];
    const next = normalizeGuideOptions(changed);
    expect(next.get('character:1071004')!.evolutionStages!.find(stage => stage.id === '5:3')?.label).toBe('新进化名称3');
    expect(next.get('weapon:2016001')!.harmonizationLevels![0].bonusPieces).toBe(3);
    const badPhase = structuredClone(tables);
    badPhase['client/character/quality/CharacterSkillQualityApart.json'][0].Phase = 999;
    expect(() => normalizeGuideOptions(badPhase)).toThrow(/进化阶段越界/);
    const badPool = structuredClone(tables);
    badPool['share/equip/EquipResonance.json'].find(row => row.Id === 3016001)!.CharacterSkillPoolId = [99999, 2];
    expect(() => normalizeGuideOptions(badPool)).toThrow(/共鸣池缺失/);
  });
});
