import type { GuideEntryOptions, GuideEvolutionStage, GuideResonanceChoice, GuideResonanceSlot } from '../../shared/guide-options';
import { arrayField, idList, linked, numberField, plainText, requireRow, rowIndex, table, unique, type SourceRow, type SourceTables } from './common';

/** 攻略选项新增依赖；其余字段复用既有基础资料所需表。 */
export const guideOptionTablePaths = ['share/equip/EquipConfig.json'] as const;

/** 从明确的源引用生成配置选项，名称与描述只用于展示。 */
export const normalizeGuideOptions = (tables: SourceTables): Map<string, GuideEntryOptions> => {
  const read = (name: string): SourceRow[] => table(tables, name);
  const result = new Map<string, GuideEntryOptions>();
  const characters = rowIndex(read('share/character/Character.json'));
  const qualityNames = rowIndex(read('client/character/CharacterQualityIcon.json'), 'Quality');
  const qualities = read('share/character/quality/CharacterQuality.json');
  const qualityEffects = read('client/character/quality/CharacterSkillQualityApart.json');
  const characterSkills = rowIndex(read('share/character/skill/CharacterSkill.json'), 'CharacterId');
  const skillGroups = rowIndex(read('share/character/skill/CharacterSkillGroup.json'));
  const characterSkillPools = read('share/character/skill/CharacterSkillPool.json');
  const attributePools = read('share/attrib/AttribPool.json');
  const weaponSkillPools = read('share/equip/WeaponSkillPool.json');
  const weaponSkills = rowIndex(read('share/equip/WeaponSkill.json'));
  const effects = rowIndex(read('share/character/CharacterGeneralSkill.json'));
  const equipment = [...rowIndex(read('share/equip/Equip.json')).values()].filter(row => numberField(row, 'Type', 0) !== 99);
  const suits = rowIndex(read('share/equip/EquipSuit.json'), 'Id', true);
  const resonance = rowIndex(read('share/equip/EquipResonance.json'));
  const overruns = read('share/equip/WeaponOverrun.json');
  const overrunSkills = rowIndex(read('client/equip/WeaponOverrunSkill.json'));
  const config = read('share/equip/EquipConfig.json');
  const bonusConfig = config.filter(row => row.Key === 'WeaponOverrunActiveSuitNum');
  if (bonusConfig.length !== 1) throw new Error('谐振意识件数配置缺失或重复');
  const bonusValues = arrayField(bonusConfig[0], 'Values');
  const bonusPieces = bonusValues[0];
  if (bonusValues.length !== 1 || typeof bonusPieces !== 'number' || !Number.isSafeInteger(bonusPieces) || bonusPieces < 1) throw new Error('谐振意识件数配置无效');

  const skillOwners = new Map<number, string[]>();
  for (const [characterId, row] of characterSkills) {
    requireRow(characters, characterId, '攻略技能所属机体');
    for (const group of linked(row, 'SkillGroupId', skillGroups, '攻略机体技能组')) {
      for (const skillId of idList(group, 'SkillId')) skillOwners.set(skillId, unique([...(skillOwners.get(skillId) ?? []), `character:${characterId}`]));
    }
  }

  for (const [id, row] of characters) {
    const stages: GuideEvolutionStage[] = [];
    const rankRows = qualities.filter(rank => rank.CharacterId === id).sort((a, b) => numberField(a, 'Quality') - numberField(b, 'Quality'));
    if (!rankRows.length) throw new Error(`攻略机体进化品级缺失：${id}`);
    for (const rank of rankRows) {
      const quality = numberField(rank, 'Quality');
      const label = plainText(requireRow(qualityNames, quality, '攻略进化品级名称').Desc);
      // AttrId 包含达到品级时的第零段；终阶没有阶段数组，仍保留其基础阶段。
      const attributes = idList(rank, 'AttrId');
      if (attributes.length !== arrayField(rank, 'AttrId').length) throw new Error(`进化阶段属性引用无效：${id}/${quality}`);
      for (let phase = 0; phase < Math.max(1, attributes.length); phase++) {
        stages.push({ id: `${quality}:${phase}`, label: `${label}${phase || ''}`, quality, phase,
          effectSectionIds: qualityEffects.filter(effect => effect.CharacterId === id && effect.Quality === quality && numberField(effect, 'Phase', 0) === phase).map(effect => `character-quality:${numberField(effect, 'Id')}`),
        });
      }
    }
    if (new Set(stages.map(stage => stage.id)).size !== stages.length) throw new Error(`机体进化阶段重复：${id}`);
    for (const effect of qualityEffects.filter(effect => effect.CharacterId === id)) {
      if (!stages.some(stage => stage.quality === effect.Quality && stage.phase === numberField(effect, 'Phase', 0))) throw new Error(`机体技能进化阶段越界：${id}/${numberField(effect, 'Id')}`);
    }
    const effectIds = idList(row, 'GeneralSkillIds').map(effectId => {
      requireRow(effects, effectId, '攻略队伍效应');
      return `dictionary:effect-${effectId}`;
    });
    result.set(`character:${id}`, { evolutionStages: stages, weaponType: numberField(row, 'EquipType'), characterType: numberField(row, 'Type'), effectIds });
  }

  /** 每个装备的共鸣池数组位置即槽位，属性共鸣与机体限定技能分开保留。 */
  const resonanceSlots = (equipId: number): GuideResonanceSlot[] => {
    const row = resonance.get(equipId);
    if (!row) return [];
    const fields = ['AttribPoolId', 'CharacterSkillPoolId', 'WeaponSkillPoolId'];
    const slots = Math.max(...fields.map(field => arrayField(row, field).length));
    const output: GuideResonanceSlot[] = [];
    for (let index = 0; index < slots; index++) {
      const choices = new Map<string, GuideResonanceChoice>();
      /** 合并同一技能的明确适用机体，不把其他槽位的池混入。 */
      const add = (resonanceId: string, characterIds: string[]): void => {
        const previous = choices.get(resonanceId);
        choices.set(resonanceId, { resonanceId, characterIds: unique([...(previous?.characterIds ?? []), ...characterIds]) });
      };
      for (const field of fields) {
        const pool = arrayField(row, field)[index];
        if (pool === undefined || pool === null || pool === '' || pool === 0) continue;
        if (typeof pool !== 'number' || !Number.isSafeInteger(pool) || pool <= 0) throw new Error(`攻略共鸣槽位池无效：${equipId}/${index + 1}`);
        const poolRows = (field === 'AttribPoolId' ? attributePools : field === 'CharacterSkillPoolId' ? characterSkillPools : weaponSkillPools).filter(choice => choice.PoolId === pool);
        if (!poolRows.length) throw new Error(`攻略共鸣池缺失：${equipId}/${pool}`);
        for (const choice of poolRows) {
          if (field === 'AttribPoolId') add(`resonance:attribute-${numberField(choice, 'Id')}`, []);
          else if (field === 'CharacterSkillPoolId') {
            const owners = skillOwners.get(numberField(choice, 'SkillId'));
            if (!owners?.length) throw new Error(`攻略意识共鸣缺少机体：${numberField(choice, 'Id')}`);
            add(`resonance:character-skill-${numberField(choice, 'Id')}`, owners);
          } else {
            const owner = numberField(choice, 'CharacterId');
            requireRow(characters, owner, '攻略武器共鸣机体');
            for (const skillId of idList(choice, 'SkillId')) {
              requireRow(weaponSkills, skillId, '攻略武器共鸣技能');
              add(`resonance:weapon-skill-${skillId}`, [`character:${owner}`]);
            }
          }
        }
      }
      if (choices.size) output.push({ slot: index + 1, choices: [...choices.values()] });
    }
    return output;
  };

  const memories = new Map<number, SourceRow[]>();
  for (const piece of equipment.filter(row => numberField(row, 'Site', 0) > 0)) {
    const id = numberField(piece, 'SuitId');
    memories.set(id, [...(memories.get(id) ?? []), piece]);
  }
  for (const [id, pieces] of memories) {
    pieces.sort((a, b) => numberField(a, 'Site') - numberField(b, 'Site'));
    const suit = requireRow(suits, id, '攻略意识套装');
    const slots = resonanceSlots(numberField(pieces[0], 'Id'));
    const signature = JSON.stringify(slots);
    for (const piece of pieces) {
      if (JSON.stringify(resonanceSlots(numberField(piece, 'Id'))) !== signature) throw new Error(`意识各号位的共鸣池不一致，需核查攻略配置：${id}`);
    }
    result.set(`memory:${id}`, {
      characterType: numberField(pieces[0], 'CharacterType', 0), memoryStar: numberField(pieces[0], 'Star'),
      memorySites: pieces.map(piece => numberField(piece, 'Site')), memorySetSizes: arrayField(suit, 'SkillEffect').flatMap((value, index) => typeof value === 'number' && value > 0 ? [index + 1] : []),
      resonanceSlots: slots,
    });
  }

  for (const weapon of equipment.filter(row => numberField(row, 'Site', 0) === 0)) {
    const id = numberField(weapon, 'Id');
    const rows = overruns.filter(row => row.WeaponId === id).sort((a, b) => numberField(a, 'Level') - numberField(b, 'Level'));
    const harmonizationLevels = rows.map(row => {
      const level = numberField(row, 'Level');
      const binding = rows.find(candidate => numberField(candidate, 'Level') <= level && candidate.ChipBindType !== undefined);
      const bindType = binding ? numberField(binding, 'ChipBindType') : 0;
      const memoryIds = binding ? [...memories].filter(([, pieces]) => {
        const piece = pieces[0];
        // 客户端只允许品质至少六、类型匹配、非禁止谐振的意识套装；不从描述文字推算。
        return numberField(piece, 'Quality') >= 6 && (bindType === 0 || piece.CharacterType === bindType) && numberField(piece, 'Type', 0) === 0 && numberField(piece, 'OverrunNoShow', 0) !== 1;
      }).map(([suitId]) => `memory:${suitId}`) : [];
      const owner = numberField(row, 'CharacterId', 0);
      if (owner) requireRow(characters, owner, '谐振觉醒机体');
      const skill = row.ShowOverrunSkillId ? requireRow(overrunSkills, numberField(row, 'ShowOverrunSkillId'), '谐振觉醒说明') : undefined;
      return { level, label: plainText(row.Name) || `谐振 ${plainText(row.LevelName || level)}`, description: [plainText(row.Desc), skill ? plainText(skill.Desc) : ''].filter(Boolean).join('\n'), bonusPieces: binding ? bonusPieces : 0, memoryIds, characterIds: owner ? [`character:${owner}`] : [] };
    });
    if (new Set(harmonizationLevels.map(level => level.level)).size !== harmonizationLevels.length) throw new Error(`武器谐振阶段重复：${id}`);
    result.set(`weapon:${id}`, { weaponType: numberField(weapon, 'Type'), resonanceSlots: resonanceSlots(id), harmonizationLevels });
  }

  const partners = rowIndex(read('share/partner/Partner.json'));
  const partnerSkills = rowIndex(read('share/partner/PartnerSkill.json'), 'PartnerId');
  const mainGroups = rowIndex(read('share/partner/PartnerMainSkillGroup.json'));
  const passiveGroups = rowIndex(read('share/partner/PartnerPassiveSkillGroup.json'));
  const partnerQualities = read('share/partner/PartnerQuality.json');
  for (const [id] of partners) {
    const skills = requireRow(partnerSkills, id, '攻略辅助机技能');
    const activeSkillGroups = linked(skills, 'MainSkillGroupId', mainGroups, '攻略辅助机主动组').map(group => ({ id: `main:${numberField(group, 'Id')}`, skillIds: idList(group, 'SkillId').map(String) }));
    const passiveSkillIds = linked(skills, 'PassiveSkillGroupId', passiveGroups, '攻略辅助机被动组').flatMap(group => idList(group, 'SkillId').map(String));
    const ranks = partnerQualities.filter(rank => rank.PartnerId === id).sort((a, b) => numberField(a, 'Quality') - numberField(b, 'Quality')).map(rank => {
      const quality = numberField(rank, 'Quality');
      const passiveSlots = numberField(rank, 'SkillColumnCount');
      if (!Number.isSafeInteger(passiveSlots) || passiveSlots < 0 || passiveSlots > passiveSkillIds.length) throw new Error(`辅助机品级被动槽数无效：${id}/${quality}`);
      return { quality, label: plainText(requireRow(qualityNames, quality, '攻略辅助机品级').Desc), passiveSlots };
    });
    if (!ranks.length || !activeSkillGroups.length || !passiveSkillIds.length) throw new Error(`攻略辅助机配置不完整：${id}`);
    // XPartnerConfigs.MainSkillCount 明确为一；被动数则由每个品级的源行确定。
    result.set(`pet:${id}`, { partnerQualities: ranks, activeSkillGroups, passiveSkillIds, activeSkillSlots: 1 });
  }
  return result;
};
