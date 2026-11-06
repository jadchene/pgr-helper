import type { CatalogEntry, EntrySection } from '../../shared/types';
import { arrayField, entry, idList, linked, numberField, plainText, requireRow, rowIndex, table, unique, type SourceRow, type SourceTables } from './common';

/** 基础模块依赖的固定相对路径，大小由传输层限制。 */
export const coreTablePaths = [
  'share/character/Character.json', 'client/character/CharacterDetail.json', 'client/character/CharacterElement.json',
  'share/character/CharacterCareer.json', 'client/character/CharacterQualityIcon.json', 'share/character/quality/CharacterQuality.json',
  'client/character/quality/CharacterSkillQualityApart.json', 'share/character/skill/CharacterSkill.json',
  'share/character/skill/CharacterSkillGroup.json', 'share/character/skill/CharacterSkillType.json',
  'client/character/skill/CharacterSkillTypeInfo.json', 'client/character/skill/CharacterSkillGate.json', 'client/character/skill/CharacterSkillUpgradeDes.json',
  'client/character/skill/CharacterSkillUpgradeDetail.json', 'share/character/CharacterGeneralSkill.json',
  'share/character/enhanceskill/EnhanceSkill.json', 'share/character/enhanceskill/EnhanceSkillGroup.json',
  'client/character/enhanceskill/EnhanceSkillUpgradeDes.json', 'share/character/enhanceskill/EnhanceSkillType.json',
  'client/character/enhanceskill/EnhanceSkillTypeInfo.json',
  'share/fashion/Fashion.json', 'share/equip/Equip.json', 'share/equip/EquipSuit.json', 'share/equip/EquipSuitEffect.json',
  'share/equip/WeaponSkill.json', 'share/equip/WeaponSkillPool.json', 'share/equip/EquipResonance.json',
  'share/equip/WeaponOverrun.json', 'client/equip/EquipRes.json', 'client/equip/WeaponOverrunSkill.json',
  'share/attrib/AttribPool.json', 'share/character/skill/CharacterSkillPool.json',
  'share/teamrecommend/teamrecommendbasecharacter.json', 'share/teamrecommend/teamrecommendcharactertarget.json',
  'share/partner/Partner.json', 'share/partner/PartnerSkill.json', 'share/partner/PartnerMainSkillGroup.json',
  'share/partner/PartnerPassiveSkillGroup.json', 'client/partner/PartnerSkillInfo.json', 'share/partner/PartnerQuality.json',
  'client/archive/ArchiveWeaponGroup.json', 'client/archive/ArchiveAwarenessGroup.json', 'client/archive/ArchiveAwarenessGroupType.json',
] as const;

/** 生成角色、装备、共鸣、辅助机及基础字典。 */
export const normalizeCore = (tables: SourceTables): { entries: CatalogEntry[]; warnings: string[] } => {
  const entries: CatalogEntry[] = [];
  const warnings: string[] = ['资料为固定版本的候选配置，包含历史内容，不能据此认定当前服务器开放状态。'];
  const read = (name: string): SourceRow[] => table(tables, name);
  const chars = rowIndex(read('share/character/Character.json'));
  const details = rowIndex(read('client/character/CharacterDetail.json'));
  const elements = rowIndex(read('client/character/CharacterElement.json'));
  const careers = rowIndex(read('share/character/CharacterCareer.json'), 'Type');
  const quality = read('share/character/quality/CharacterQuality.json');
  const qualityNames = rowIndex(read('client/character/CharacterQualityIcon.json'), 'Quality');
  const parts = read('client/character/quality/CharacterSkillQualityApart.json');
  const characterSkills = rowIndex(read('share/character/skill/CharacterSkill.json'), 'CharacterId');
  const skillGroups = rowIndex(read('share/character/skill/CharacterSkillGroup.json'));
  const skillTypes = rowIndex(read('share/character/skill/CharacterSkillType.json'));
  const skillTypeNames = rowIndex(read('client/character/skill/CharacterSkillTypeInfo.json'), 'Type');
  const skillGates = rowIndex(read('client/character/skill/CharacterSkillGate.json'));
  const skillDescriptions = rowIndex(read('client/character/skill/CharacterSkillUpgradeDetail.json'), 'RefId');
  const upgrade = read('client/character/skill/CharacterSkillUpgradeDes.json');
  const highestSkills = new Map<number, SourceRow>();
  for (const row of upgrade) {
    const id = numberField(row, 'SkillId');
    requireRow(skillDescriptions, numberField(row, 'RefId'), '技能说明');
    if (numberField(row, 'Level', 0) > numberField(highestSkills.get(id) ?? {}, 'Level', -1)) highestSkills.set(id, row);
  }
  const general = rowIndex(read('share/character/CharacterGeneralSkill.json'));
  const enhance = rowIndex(read('share/character/enhanceskill/EnhanceSkill.json'), 'CharacterId');
  const enhanceGroups = rowIndex(read('share/character/enhanceskill/EnhanceSkillGroup.json'));
  const enhanceTypes = rowIndex(read('share/character/enhanceskill/EnhanceSkillType.json'));
  const enhanceTypeNames = rowIndex(read('client/character/enhanceskill/EnhanceSkillTypeInfo.json'), 'Type');
  const enhanceDescriptions = read('client/character/enhanceskill/EnhanceSkillUpgradeDes.json');
  const highestEnhance = new Map<number, SourceRow>();
  for (const skill of enhanceDescriptions) { const id = numberField(skill, 'SkillId'); if (numberField(skill, 'Level', 0) > numberField(highestEnhance.get(id) ?? {}, 'Level', -1)) highestEnhance.set(id, skill); }
  const fashion = rowIndex(read('share/fashion/Fashion.json'));
  const equip = rowIndex(read('share/equip/Equip.json'));
  const suit = rowIndex(read('share/equip/EquipSuit.json'), 'Id', true);
  const suitEffects = rowIndex(read('share/equip/EquipSuitEffect.json'));
  const weaponSkills = rowIndex(read('share/equip/WeaponSkill.json'));
  const weaponPools = read('share/equip/WeaponSkillPool.json');
  const resonanceRows = rowIndex(read('share/equip/EquipResonance.json'));
  const overruns = read('share/equip/WeaponOverrun.json');
  const overrunSkills = rowIndex(read('client/equip/WeaponOverrunSkill.json'));
  const equipImages = rowIndex(read('client/equip/EquipRes.json'));
  const weaponTypes = rowIndex(read('client/archive/ArchiveWeaponGroup.json'));
  const awarenessGroups = rowIndex(read('client/archive/ArchiveAwarenessGroup.json'));
  const awarenessGroupTypes = rowIndex(read('client/archive/ArchiveAwarenessGroupType.json'), 'GroupId');
  const attribPools = read('share/attrib/AttribPool.json');
  const charPools = read('share/character/skill/CharacterSkillPool.json');
  const presets = rowIndex(read('share/teamrecommend/teamrecommendbasecharacter.json'));
  const targets = rowIndex(read('share/teamrecommend/teamrecommendcharactertarget.json'), 'CharacterId');
  const weapons = [...equip.values()].filter(row => numberField(row, 'Site', 0) === 0 && numberField(row, 'Type', 0) !== 99);
  const memories = [...equip.values()].filter(row => numberField(row, 'Site', 0) > 0 && numberField(row, 'Type', 0) !== 99);
  const memorySuitIds = unique(memories.map(row => numberField(row, 'SuitId')));
  const usableEquip = new Set([...weapons, ...memories].map(row => numberField(row, 'Id')));
  const activeResonance = [...resonanceRows.values()].filter(row => usableEquip.has(numberField(row, 'Id')));
  const usedAttribPools = new Set(activeResonance.flatMap(row => idList(row, 'AttribPoolId')));
  const usedCharPools = new Set(activeResonance.flatMap(row => idList(row, 'CharacterSkillPoolId')));
  const usedWeaponPools = new Set(activeResonance.flatMap(row => idList(row, 'WeaponSkillPoolId')));
  for (const pool of usedAttribPools) if (!attribPools.some(row => row.PoolId === pool)) throw new Error(`属性共鸣池缺失：${pool}`);
  for (const pool of usedCharPools) if (!charPools.some(row => row.PoolId === pool)) throw new Error(`技能共鸣池缺失：${pool}`);
  for (const pool of usedWeaponPools) if (!weaponPools.some(row => row.PoolId === pool)) throw new Error(`武器共鸣池缺失：${pool}`);

  /** 来源字段允许单个数值或客户端约定的竖线分隔引用，不猜测其他格式。 */
  const multipleReferences = (row: SourceRow, key: string): number[] => {
    const value = row[key];
    if (value == null || value === '' || value === 0) return [];
    if ((typeof value !== 'number' && typeof value !== 'string') || !/^\d+(?:\|\d+)*$/.test(String(value))) throw new Error(`多值引用字段无效：${key}`);
    const ids = String(value).split('|').map(Number);
    if (ids.some(id => !Number.isSafeInteger(id) || id <= 0)) throw new Error(`多值引用字段无效：${key}`);
    return unique(ids);
  };
  /** 保存可解释的排序与多值筛选，空维度明确标为来源未提供。 */
  const catalog = (item: CatalogEntry, order: number[], basis: NonNullable<CatalogEntry['catalog']>['basis'], facets: Record<string, string[]>): void => {
    item.catalog = { order, basis, facets: Object.fromEntries(Object.entries(facets).map(([key, values]) => [key, values.length ? unique(values) : ['未提供']])) };
  };
  /** 机体推荐关系只用于来源明确声明的推荐，不扩展为所有可装备机体。 */
  const characterNames = (ids: number[]): string[] => unique(ids.map(id => plainText(requireRow(chars, id, '推荐机体').LogName)));
  const characterProfessions = (ids: number[]): string[] => unique(ids.map(id => plainText(requireRow(careers, numberField(requireRow(chars, id, '共鸣机体'), 'Career'), '共鸣职业').Name)));
  /** 共鸣池数组的位置就是共鸣槽位；意识与武器编号空间分开标注。 */
  const resonanceSlots = (field: string, pools: Set<number>): string[] => unique(activeResonance.flatMap(row => {
    const isMemory = numberField(requireRow(equip, numberField(row, 'Id'), '共鸣装备'), 'Site', 0) > 0;
    return arrayField(row, field).flatMap((pool, index) => typeof pool === 'number' && pools.has(pool) ? [isMemory ? `意识${index === 0 ? '上排' : index === 1 ? '下排' : `${index + 1}号位`}` : `武器${index + 1}号位`] : []);
  }));

  /** 生成保留分段、清除富文本的最高技能等级说明。 */
  const skillSection = (skillId: number): EntrySection => {
    const level = requireRow(highestSkills, skillId, '技能等级');
    const detail = requireRow(skillDescriptions, numberField(level, 'RefId'), '技能详情');
    const nums = arrayField(level, 'SpecificDesNum');
    const longDescriptions = arrayField(detail, 'SpecificDes').map((value, i) => {
      const values = plainText(nums[i]).split('|');
      return plainText(value).replace(/\{(\d+)\}/g, (match, index: string) => values[Number(index)] || match);
    });
    const body = longDescriptions.some(value => /\{\d+\}/.test(value)) ? arrayField(detail, 'BriefDes').map(plainText).join('\n') : longDescriptions.join('\n');
    return { title: plainText(level.Name), body: body || plainText(detail.Desc) };
  };

  /** 按源数组配对技能组与展示位置，拒绝空槽造成的错位，不按编号重新排序。 */
  const positionedSkillGroups = (row: SourceRow, groups: Map<number, SourceRow>, context: string): { group: SourceRow; position: number }[] => {
    const ids = idList(row, 'SkillGroupId');
    const positions = idList(row, 'Pos');
    if (ids.length !== positions.length || ids.length !== arrayField(row, 'SkillGroupId').length || positions.length !== arrayField(row, 'Pos').length) throw new Error(`${context} 与位置数量不匹配`);
    return ids.map((id, index) => {
      const group = requireRow(groups, id, context);
      const skillIds = idList(group, 'SkillId');
      if (!skillIds.length || skillIds.length !== arrayField(group, 'SkillId').length) throw new Error(`${context} 中技能为空或存在无效槽位：${id}`);
      return { group, position: positions[index] };
    });
  };

  /** 优先明确专武字段，再采用唯一六星推荐关系或角色目标预设。 */
  const signatureWeapon = (character: SourceRow): SourceRow => {
    const id = numberField(character, 'Id');
    let candidates: number[];
    if (character.ExclusiveEquipId) candidates = [numberField(character, 'ExclusiveEquipId')];
    else candidates = weapons.filter(row => row.Star === 6 && row.RecommendCharacterId === id).map(row => numberField(row, 'Id'));
    if (!candidates.length) {
      const target = requireRow(targets, id, '角色培养目标');
      candidates = unique(linked(target, 'BaseCharacterIds', presets, '角色配装预设').map(row => numberField(row, 'WeaponId')).filter(weaponId => requireRow(equip, weaponId, '预设武器').Star === 6));
    }
    if (candidates.length !== 1) throw new Error(`机体 ${id} 的专武映射不唯一，请核查来源`);
    const weapon = requireRow(equip, candidates[0], '默认专武');
    if (weapon.Type !== character.EquipType || weapon.Star !== 6) throw new Error(`机体 ${id} 的默认专武类型不匹配`);
    return weapon;
  };

  const characterWeapons = new Map<number, number>();
  for (const [id, row] of chars) {
    const item = entry('character', id, row.LogName);
    const detail = requireRow(details, id, '机体详情');
    const qualityRows = quality.filter(value => value.CharacterId === id);
    if (!qualityRows.length) throw new Error(`机体品级缺失：${id}`);
    const initQuality = Math.min(...qualityRows.map(value => numberField(value, 'Quality')));
    const rank = requireRow(qualityNames, initQuality, '机体初始品级');
    const weapon = signatureWeapon(row);
    const weaponId = numberField(weapon, 'Id');
    characterWeapons.set(id, weaponId);
    const skin = requireRow(fashion, numberField(row, 'DefaultNpcFashtionId'), '默认涂装');
    if (skin.CharacterId !== id) throw new Error(`机体头像关联错误：${id}`);
    item.element = plainText(requireRow(elements, numberField(row, 'Element'), '机体属性').ElementName);
    item.profession = plainText(requireRow(careers, numberField(row, 'Career'), '机体职业').Name);
    item.rarity = `${plainText(rank.Desc2)}（${plainText(rank.Desc)}）`;
    item.subtitle = `${item.element} · ${item.profession}`;
    item.description = plainText(detail.DetailDes || row.Intro);
    item.aliases = unique([plainText(row.Name), plainText(row.TradeName), plainText(row.EnName)].filter(Boolean));
    item.tags = [item.element, item.profession, numberField(row, 'Type') === 2 ? '独域机体' : '泛用机体'];
    item.attributes = { '初始品级': item.rarity, '默认专武': plainText(weapon.Name), '头像资源': plainText(skin.SmallHeadIcon), '可用品级': qualityRows.map(value => { const label = requireRow(qualityNames, numberField(value, 'Quality'), '品级名称'); return `${plainText(label.Desc2)}（${plainText(label.Desc)}）`; }).join(' / ') };
    const mixedIds = idList(detail, 'ObtainElementList');
    const percentages = arrayField(detail, 'ObtainElementValueList');
    if (mixedIds.length !== percentages.length) throw new Error(`机体属性比例数量不匹配：${id}`);
    item.attributes['能量参数'] = mixedIds.map((elementId, i) => `${plainText(requireRow(elements, elementId, '混合属性').ElementName)} ${plainText(percentages[i])}%`).join(' / ');
    item.relatedIds = [`weapon:${weaponId}`, `dictionary:element-${numberField(row, 'Element')}`, `dictionary:career-${numberField(row, 'Career')}`];
    for (const effect of linked(row, 'GeneralSkillIds', general, '机体效应')) {
      item.tags.push(plainText(effect.Name));
      item.relatedIds.push(`dictionary:effect-${numberField(effect, 'Id')}`);
    }
    const skills = requireRow(characterSkills, id, '机体技能');
    const characterSkillMetadata = new Map<number, NonNullable<EntrySection['skill']>>();
    let hasQte = false;
    for (const { group, position } of positionedSkillGroups(skills, skillGroups, '机体技能组')) {
      const gate = requireRow(skillGates, position, '机体技能分类');
      const skillIds = idList(group, 'SkillId');
      const familyName = unique(skillIds.map(skillId => plainText(requireRow(skillTypeNames, numberField(requireRow(skillTypes, skillId, '技能类型'), 'Type'), '技能类型名称').Name))).join(' / ');
      for (const skillId of skillIds) {
        const type = numberField(requireRow(skillTypes, skillId, '技能类型'), 'Type');
        hasQte ||= type === 6;
        const metadata: NonNullable<EntrySection['skill']> = {
          kind: 'character', id: `character-skill:${skillId}`, groupId: `character-gate:${position}`,
          groupName: plainText(gate.Name), groupOrder: position, familyId: `character-skill-group:${numberField(group, 'Id')}`,
          familyName, typeName: plainText(requireRow(skillTypeNames, type, '技能类型名称').Name),
          level: numberField(requireRow(highestSkills, skillId, '技能等级'), 'Level', 0),
        };
        if (characterSkillMetadata.has(skillId)) throw new Error(`机体技能重复归组：${id}/${skillId}`);
        characterSkillMetadata.set(skillId, metadata);
        item.sections.push({ ...skillSection(skillId), skill: metadata });
      }
    }
    if (!hasQte) throw new Error(`机体 QTE 类型缺失：${id}`);
    for (const part of parts.filter(value => value.CharacterId === id)) {
      const parent = characterSkillMetadata.get(numberField(part, 'SkillId'));
      if (!parent) throw new Error(`升阶说明缺少机体技能关联：${id}/${numberField(part, 'Id')}`);
      const rankName = plainText(requireRow(qualityNames, numberField(part, 'Quality'), '细分品级').Desc);
      const phase = numberField(part, 'Phase', 0);
      item.sections.push({
        title: plainText(part.Name), body: plainText(part.Intro),
        skill: {
          kind: 'character', id: `character-quality:${numberField(part, 'Id')}`, groupId: parent.groupId,
          groupName: parent.groupName, groupOrder: parent.groupOrder, familyId: parent.familyId, familyName: parent.familyName,
          typeName: `升阶 · ${rankName}${phase || ''}`,
        },
      });
    }
    const enhanced = requireRow(enhance, id, '增强入口');
    let leapCount = 0;
    let uniframeCount = 0;
    for (const { group } of positionedSkillGroups(enhanced, enhanceGroups, '增强技能组')) {
      const skillIds = idList(group, 'SkillId');
      const familyName = unique(skillIds.map(skillId => plainText(requireRow(enhanceTypeNames, numberField(requireRow(enhanceTypes, skillId, '增强技能类型'), 'Type'), '增强技能类型名称').Name))).join(' / ');
      for (const skillId of skillIds) {
        const skill = requireRow(highestEnhance, skillId, '增强技能说明');
        const type = numberField(requireRow(enhanceTypes, skillId, '增强技能类型'), 'Type');
        const typeName = plainText(requireRow(enhanceTypeNames, type, '增强技能类型名称').Name);
        // 客户端明确将跃升类型14放入口6、独域类型15放入口5，其他已定义类型保留独立分类。
        const gateId = type === 14 ? 6 : type === 15 ? 5 : undefined;
        const gate = gateId === undefined ? undefined : requireRow(skillGates, gateId, '增强技能分类');
        if (type === 14) leapCount++;
        if (type === 15) uniframeCount++;
        item.sections.push({
          title: plainText(skill.Name), body: plainText(skill.Intro),
          skill: {
            kind: 'character', id: `character-enhancement:${skillId}`,
            groupId: gateId === undefined ? `character-enhancement-type:${type}` : `character-gate:${gateId}`,
            groupName: gate ? plainText(gate.Name) : typeName, groupOrder: gateId ?? 100 + type,
            familyId: `character-enhancement-group:${numberField(group, 'Id')}`, familyName, typeName,
            level: numberField(skill, 'Level', 0),
          },
        });
      }
    }
    if (leapCount) item.attributes['跃升技能'] = leapCount.toString();
    if (uniframeCount) item.attributes['独域技能'] = uniframeCount.toString();
    catalog(item, [numberField(row, 'Priority'), id], 'source-priority', {
      element: [item.element], profession: [item.profession], rarity: [item.rarity], frameType: [numberField(row, 'Type') === 2 ? '独域机体' : '泛用机体'],
      effect: idList(row, 'GeneralSkillIds').length ? linked(row, 'GeneralSkillIds', general, '机体效应').map(effect => plainText(effect.Name)) : ['无效应'],
      enhancement: [leapCount ? '有跃升技能' : '无跃升技能'], collaboration: [numberField(row, 'LinkageType', 0) ? '联动机体' : '非联动机体'],
    });
    entries.push(item);
  }

  for (const id of memorySuitIds) {
    const row = requireRow(suit, id, '意识套装');
    const pieces = memories.filter(piece => piece.SuitId === id).sort((a, b) => numberField(a, 'Site') - numberField(b, 'Site'));
    const item = entry('memory', id, row.Name);
    item.description = plainText(row.Description);
    item.rarity = `${numberField(pieces[0], 'Star')}星`;
    item.subtitle = `${item.rarity} · ${item.description}`;
    item.tags = [item.rarity, '意识套装'];
    item.attributes = { '实际号位': pieces.map(piece => numberField(piece, 'Site')).join('、'), '资源路径': plainText(row.ClearIconPath || row.IconPath), '装备编号': pieces.map(piece => `${numberField(piece, 'Site')}号位：${numberField(piece, 'Id')}`).join('\n') };
    const effects = arrayField(row, 'SkillEffect');
    const descriptions = arrayField(row, 'SkillDescription');
    const setSizes: string[] = [];
    if (effects.length !== descriptions.length) throw new Error(`意识套装效果数量不匹配：${id}`);
    effects.forEach((effect, i) => {
      if (effect === '' || effect == null || effect === 0) return;
      if (typeof effect !== 'number') throw new Error(`意识套装效果编号无效：${id}`);
      requireRow(suitEffects, effect, '意识效果');
      const body = plainText(descriptions[i]);
      if (!body) throw new Error(`意识套装缺少效果说明：${id}`);
      item.sections.push({ title: `${i + 1}件套`, body });
      setSizes.push(`${i + 1}件套`);
    });
    if (!item.sections.length) { item.sections.push({ title: '套装效果', body: '此来源版本未提供套装效果说明。' }); warnings.push(`意识 ${item.name} 未提供套装效果说明，已保留实际号位。`); }
    const archiveGroup = numberField(awarenessGroups.get(id) ?? {}, 'Type', 0);
    const archiveName = archiveGroup ? plainText(requireRow(awarenessGroupTypes, archiveGroup, '意识图鉴类别').GroupName) : '未提供';
    const purposes = multipleReferences(row, 'EquipType').map(type => {
      if (type >= 1 && type <= 6) return plainText(requireRow(elements, type, '意识元素用途').ElementName);
      const label = ({ 7: '独域', 8: '辅助', 9: '通用', 10: '效应' } as Record<number, string>)[type];
      if (!label) throw new Error(`意识用途枚举未识别：${type}`);
      return label;
    });
    const recommended = multipleReferences(row, 'RecommendCharacterId');
    item.relatedIds.push(...recommended.map(characterId => `character:${characterId}`));
    item.attributes['图鉴类别'] = archiveName;
    item.attributes['意识用途'] = purposes.join('、') || '未提供';
    if (recommended.length) item.attributes['推荐机体'] = characterNames(recommended).join('、');
    // 星级和图鉴类别先分组；活动20000段与常规段分开，避免冒充全局推出日期。
    catalog(item, [numberField(pieces[0], 'Star'), ({ 1: 3, 2: 2, 3: 1 } as Record<number, number>)[archiveGroup] ?? 0, id < 20_000 ? 1 : 0, id], 'configuration', {
      rarity: [item.rarity], archiveGroup: [archiveName], purpose: purposes, character: characterNames(recommended), setSize: setSizes,
    });
    entries.push(item);
  }

  const weaponResonanceIds = unique(weaponPools.filter(row => usedWeaponPools.has(numberField(row, 'PoolId'))).flatMap(row => idList(row, 'SkillId')));
  for (const id of weaponResonanceIds) {
    const row = requireRow(weaponSkills, id, '武器共鸣技能');
    const item = entry('resonance', `weapon-skill-${id}`, row.Name);
    item.subtitle = '武器技能共鸣';
    item.description = plainText(row.Description);
    item.tags = ['武器共鸣'];
    item.attributes = { '资源路径': plainText(row.Icon) };
    const related = weaponPools.filter(pool => idList(pool, 'SkillId').includes(id)).map(pool => numberField(pool, 'CharacterId', 0)).filter(Boolean);
    item.relatedIds = unique(related.map(characterId => { requireRow(chars, characterId, '共鸣适用角色'); return `character:${characterId}`; }));
    const pools = new Set(weaponPools.filter(pool => idList(pool, 'SkillId').includes(id)).map(pool => numberField(pool, 'PoolId')));
    // 共享共鸣不会因为新机体进入适用名单而获得更高的新旧排序。
    catalog(item, [2, -id], 'definition', { resonanceType: ['武器技能共鸣'], character: characterNames(related), profession: characterProfessions(related), skillType: ['武器技能'], slot: resonanceSlots('WeaponSkillPoolId', pools) });
    entries.push(item);
  }
  for (const row of attribPools.filter(value => usedAttribPools.has(numberField(value, 'PoolId')))) {
    const id = numberField(row, 'Id');
    const item = entry('resonance', `attribute-${id}`, row.Name || row.Description);
    item.subtitle = '属性共鸣';
    item.description = plainText(row.Description);
    if (!item.description) throw new Error(`共鸣属性说明缺失：${id}`);
    item.tags = ['属性共鸣'];
    item.attributes = { '效果': item.description, '属性池': String(numberField(row, 'PoolId')), '资源路径': plainText(row.Icon) };
    const slots = resonanceSlots('AttribPoolId', new Set([numberField(row, 'PoolId')]));
    catalog(item, [1, -numberField(row, 'PoolId'), -id], 'definition', { resonanceType: unique(slots.map(slot => slot.startsWith('意识') ? '意识属性共鸣' : '武器属性共鸣')), character: [], profession: [], skillType: ['属性加成'], slot: slots });
    entries.push(item);
  }
  for (const row of charPools.filter(value => usedCharPools.has(numberField(value, 'PoolId')))) {
    const id = numberField(row, 'Id');
    const skillId = numberField(row, 'SkillId');
    requireRow(skillTypes, skillId, '意识共鸣技能');
    const item = entry('resonance', `character-skill-${id}`, row.Name);
    item.subtitle = '意识技能共鸣';
    item.description = plainText(row.Description);
    item.tags = ['意识共鸣', '技能共鸣'];
    item.attributes = { '效果': item.description, '技能编号': String(skillId), '资源路径': plainText(row.Icon) };
    const owners = [...characterSkills].filter(([, skills]) => linked(skills, 'SkillGroupId', skillGroups, '技能组').some(group => idList(group, 'SkillId').includes(skillId))).map(([characterId]) => characterId);
    if (owners.length !== 1) throw new Error(`意识技能共鸣 ${id} 的所属机体不唯一`);
    item.relatedIds = owners.map(characterId => `character:${characterId}`);
    const skillType = numberField(requireRow(skillTypes, skillId, '意识共鸣技能类型'), 'Type');
    catalog(item, [3, numberField(requireRow(chars, owners[0], '意识共鸣机体'), 'Priority'), -skillType, -id], 'related-character', { resonanceType: ['意识技能共鸣'], character: characterNames(owners), profession: characterProfessions(owners), skillType: [plainText(requireRow(skillTypeNames, skillType, '意识共鸣技能类型名称').Name)], slot: resonanceSlots('CharacterSkillPoolId', new Set([numberField(row, 'PoolId')])) });
    entries.push(item);
  }

  for (const row of weapons) {
    const id = numberField(row, 'Id');
    const item = entry('weapon', id, row.Name);
    item.description = plainText(row.Description);
    item.rarity = `${numberField(row, 'Star')}星`;
    item.subtitle = plainText(row.LogName);
    item.tags = [item.rarity, '武器'];
    const image = equipImages.get(id);
    const weaponType = numberField(row, 'Type');
    const weaponTypeName = plainText(requireRow(weaponTypes, weaponType, '武器类型').GroupName);
    item.attributes = { '资源路径': plainText(image?.BigIconPath || image?.IconPath), '武器类型编号': String(weaponType), '武器类型': weaponTypeName };
    if (!image) warnings.push(`武器 ${item.name} 缺少图片配置，已保留文字资料。`);
    if (row.WeaponSkillId) {
      const skill = requireRow(weaponSkills, numberField(row, 'WeaponSkillId'), '武器技能');
      item.sections.push({ title: plainText(skill.Name), body: plainText(skill.Description) });
    }
    const ownerIds = unique([...characterWeapons].filter(([, weaponId]) => weaponId === id).map(([characterId]) => characterId).concat(numberField(row, 'RecommendCharacterId', 0) || []));
    item.relatedIds = ownerIds.map(characterId => { requireRow(chars, characterId, '推荐机体'); return `character:${characterId}`; });
    if (ownerIds.length) item.attributes['推荐机体'] = ownerIds.map(characterId => plainText(requireRow(chars, characterId, '推荐机体').LogName)).join('、');
    // 已核对来源的298xxxx独立编号段为时装或特殊展示配置，不混入普通武器新旧顺序。
    const special = id >= 2_980_000 && id < 2_990_000;
    const ownerPriority = ownerIds.length ? Math.max(...ownerIds.map(characterId => numberField(requireRow(chars, characterId, '武器推荐机体'), 'Priority'))) : 0;
    const weaponOrder = special ? [0, weaponType, numberField(row, 'Star'), id] : ownerIds.length ? [2, ownerPriority, numberField(row, 'Star'), weaponType, id] : [1, weaponType, numberField(row, 'Star'), id];
    catalog(item, weaponOrder, !special && ownerIds.length ? 'related-character' : 'configuration', { rarity: [item.rarity], weaponType: [weaponTypeName], character: characterNames(ownerIds), configKind: [special ? '时装或特殊配置' : '普通武器'] });
    const r = resonanceRows.get(id);
    if (r) {
      const attrs = attribPools.filter(pool => idList(r, 'AttribPoolId').includes(numberField(pool, 'PoolId')));
      item.relatedIds.push(...attrs.map(pool => `resonance:attribute-${numberField(pool, 'Id')}`));
      const common = weaponPools.filter(pool => idList(r, 'WeaponSkillPoolId').includes(numberField(pool, 'PoolId')) && (!ownerIds.length || ownerIds.includes(numberField(pool, 'CharacterId', 0))));
      item.relatedIds.push(...unique(common.flatMap(pool => idList(pool, 'SkillId'))).map(skillId => `resonance:weapon-skill-${skillId}`));
    }
    for (const overrun of overruns.filter(value => value.WeaponId === id)) {
      item.sections.push({ title: `谐振 ${numberField(overrun, 'Level')}`, body: plainText(overrun.Desc) });
      if (overrun.ShowOverrunSkillId) { const skill = requireRow(overrunSkills, numberField(overrun, 'ShowOverrunSkillId'), '谐振觉醒'); item.sections.push({ title: plainText(skill.Name), body: plainText(skill.Desc) }); }
    }
    item.relatedIds = unique(item.relatedIds);
    entries.push(item);
  }

  const partners = rowIndex(read('share/partner/Partner.json'));
  const partnerSkills = rowIndex(read('share/partner/PartnerSkill.json'), 'PartnerId');
  const mainGroups = rowIndex(read('share/partner/PartnerMainSkillGroup.json'));
  const passiveGroups = rowIndex(read('share/partner/PartnerPassiveSkillGroup.json'));
  const petSkills = read('client/partner/PartnerSkillInfo.json');
  const petQuality = read('share/partner/PartnerQuality.json');
  const highestPet = new Map<number, SourceRow>();
  for (const skill of petSkills) { const id = numberField(skill, 'SkillId'); if (numberField(skill, 'Level') > numberField(highestPet.get(id) ?? {}, 'Level', 0)) highestPet.set(id, skill); }
  for (const [id, row] of partners) {
    const item = entry('pet', id, row.Name);
    const skill = requireRow(partnerSkills, id, '辅助机技能');
    const ranks = petQuality.filter(rank => rank.PartnerId === id);
    if (!ranks.length) throw new Error(`辅助机品级缺失：${id}`);
    item.description = plainText(row.Desc);
    item.rarity = plainText(requireRow(qualityNames, numberField(row, 'InitQuality'), '辅助机初始品级').Desc);
    item.subtitle = `${item.rarity} · ${item.description}`;
    item.tags = ['辅助机', item.rarity];
    item.attributes = { '可用品级': ranks.map(rank => plainText(requireRow(qualityNames, numberField(rank, 'Quality'), '辅助机品级').Desc)).join(' / '), '资源路径': plainText(row.Icon), '技能说明': '展示各技能当前表中最高等级；攻略实际技能等级需单独记录。' };
    const usedSkillIds = new Set<number>();
    /** 保留来源组与同位置属性引用，各变体正文独立存储，不按名称合并。 */
    const appendSkills = (kind: 'pet-active' | 'pet-passive', groupIds: string, groupMap: Map<number, SourceRow>): void => {
      const active = kind === 'pet-active';
      const groupName = active ? '主动技能' : '被动技能';
      const references = idList(skill, groupIds);
      if (references.length !== arrayField(skill, groupIds).length || new Set(references).size !== references.length) throw new Error(`辅助机技能组引用重复或无效：${id}/${groupIds}`);
      for (const [groupOrder, groupId] of references.entries()) {
        const group = requireRow(groupMap, groupId, '辅助机技能组');
        const skillIds = idList(group, 'SkillId');
        if (!skillIds.length || skillIds.length !== arrayField(group, 'SkillId').length || new Set(skillIds).size !== skillIds.length) throw new Error(`辅助机技能引用重复或无效：${groupId}`);
        const elementIds = active ? idList(group, 'Element') : [];
        if (active && (elementIds.length !== skillIds.length || elementIds.length !== arrayField(group, 'Element').length || new Set(elementIds).size !== elementIds.length)) throw new Error(`辅助机技能属性引用错位或重复：${groupId}`);
        for (const [index, skillId] of skillIds.entries()) {
          if (usedSkillIds.has(skillId)) throw new Error(`辅助机技能引用重复：${id}/${skillId}`);
          usedSkillIds.add(skillId);
          const text = requireRow(highestPet, skillId, '辅助机技能文本');
          const level = numberField(text, 'Level');
          if (!Number.isSafeInteger(level) || level <= 0 || petSkills.filter(row => row.SkillId === skillId && row.Level === level).length !== 1) throw new Error(`辅助机技能最高等级重复或无效：${skillId}`);
          const element = active ? { id: elementIds[index], name: plainText(requireRow(elements, elementIds[index], '辅助机技能属性').ElementName) } : undefined;
          if (element && !element.name) throw new Error(`辅助机技能属性缺少名称：${element.id}`);
          item.sections.push({
            title: plainText(text.Name), body: plainText(text.Desc),
            skill: {
              kind, id: String(skillId), groupId: kind, groupName, groupOrder: active ? 1 : 2,
              familyId: `${active ? 'main' : 'passive'}:${groupId}`,
              familyName: active ? `主动技能 ${groupOrder + 1}` : plainText(text.Name),
              typeName: active ? '主动' : '被动', level,
              ...(element ? { element } : {}),
            },
          });
        }
      }
    };
    appendSkills('pet-active', 'MainSkillGroupId', mainGroups);
    appendSkills('pet-passive', 'PassiveSkillGroupId', passiveGroups);
    if (!item.sections.length) throw new Error(`辅助机缺少技能：${id}`);
    if (row.RecommendCharacterId) { const owner = requireRow(chars, numberField(row, 'RecommendCharacterId'), '辅助机推荐角色'); item.relatedIds.push(`character:${numberField(owner, 'Id')}`); item.attributes['推荐机体'] = plainText(owner.LogName); }
    const petElements = idList(row, 'RecommendElement');
    item.element = petElements.map(elementId => plainText(requireRow(elements, elementId, '辅助机属性').ElementName)).join(' / ');
    const recommended = multipleReferences(row, 'RecommendCharacterId');
    const partnerType = numberField(row, 'PartnerType');
    catalog(item, [numberField(row, 'Priority'), id], 'source-priority', { rarity: [item.rarity], element: petElements.map(elementId => plainText(requireRow(elements, elementId, '辅助机属性').ElementName)), character: characterNames(recommended), partnerType: [partnerType === 1 ? '普通辅助机' : partnerType === 2 ? '联动辅助机' : '未提供'], function: item.description.split(/[，、,]/).map(value => value.trim()).filter(Boolean) });
    entries.push(item);
  }

  for (const [id, row] of elements) { const item = entry('dictionary', `element-${id}`, row.ElementName); item.subtitle = '属性'; item.tags = ['属性']; item.description = plainText(row.Description); item.attributes['图标资源'] = plainText(row.Icon); entries.push(item); }
  for (const [id, row] of careers) { const item = entry('dictionary', `career-${id}`, row.Name); item.subtitle = '职业'; item.tags = ['职业']; item.description = plainText(row.Des); item.attributes['图标资源'] = plainText(row.Icon); entries.push(item); }
  for (const [id, row] of qualityNames) { const item = entry('dictionary', `quality-${id}`, `${plainText(row.Desc2)}（${plainText(row.Desc)}）`); item.subtitle = '角色品级'; item.tags = ['品级']; item.aliases = [plainText(row.Desc), plainText(row.Desc2)]; item.attributes['图标资源'] = plainText(row.IconCharacter); entries.push(item); }
  for (const [id, row] of general) { const item = entry('dictionary', `effect-${id}`, row.Name); item.subtitle = '队伍效应'; item.tags = ['效应']; item.description = plainText(row.Desc); item.attributes['图标资源'] = plainText(row.Icon); entries.push(item); }
  for (const [id, row] of skillTypeNames) { const item = entry('dictionary', `skill-type-${id}`, row.Name); item.subtitle = '技能类型'; item.tags = ['技能类型']; entries.push(item); }
  const dictionaryGroups: Record<string, number> = { '属性': 5, '职业': 4, '角色品级': 3, '队伍效应': 2, '技能类型': 1 };
  for (const item of entries) {
    item.relatedIds = unique(item.relatedIds);
    if (item.category === 'dictionary') {
      const id = Number(item.sourceKey.split('-').at(-1));
      const placeholder = item.name === '无' || id === 0 || (item.subtitle === '队伍效应' && general.get(id)?.IsSkipSkillCheck === true);
      catalog(item, [placeholder ? 0 : 1, dictionaryGroups[item.subtitle], -id], 'definition', { dictionaryType: [item.subtitle] });
    }
    if (!item.catalog) throw new Error(`基础资料缺少排序和筛选信息：${item.id}`);
  }
  return { entries, warnings: unique(warnings) };
};
