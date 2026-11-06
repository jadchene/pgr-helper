import type { CatalogEntry } from './types';
import type { GuideDocument, GuideIssue, GuideMember, GuideTeam, ResonanceAllocation } from './guides';
import { isGuideDateTime } from './guides';
import { validateGuideFlow } from './guide-flow';

/** 依次匹配每个共鸣需求到可用意识件，处理混搭意识共鸣池交叠。 */
const canAllocateResonance = (member: GuideMember, slot: number, allocations: ResonanceAllocation[], entries: Map<string, CatalogEntry>): boolean => {
  const pieces = member.memories.flatMap(memory => Array.from({ length: memory.count }, () => new Set(
    entries.get(memory.memoryId)?.guideOptions?.resonanceSlots?.find(value => value.slot === slot)?.choices
      .filter(choice => !choice.characterIds.length || choice.characterIds.includes(member.characterId)).map(choice => choice.resonanceId) ?? [],
  )));
  const requested = allocations.filter(value => value.resonanceId).flatMap(value => Array<string>(value.count).fill(value.resonanceId));
  const assigned = Array<number>(pieces.length).fill(-1);
  const match = (request: number, visited: Set<number>): boolean => {
    for (const [index, choices] of pieces.entries()) {
      if (visited.has(index) || !choices.has(requested[request])) continue;
      visited.add(index);
      if (assigned[index] < 0 || match(assigned[index], visited)) { assigned[index] = request; return true; }
    }
    return false;
  };
  return requested.every((_, index) => match(index, new Set()));
};

/** 验证队伍培养和装备关系；来源缺失时明确提示重新选择或同步。 */
export const validateGuideTeam = (team: GuideTeam, source: readonly CatalogEntry[], requireComplete = true): GuideIssue[] => {
  const issues: GuideIssue[] = [];
  const entries = new Map(source.map(entry => [entry.id, entry]));
  const issue = (path: string, message: string): void => { issues.push({ path: `team.${path}`, message }); };
  const lookup = (id: string, category: CatalogEntry['category'], path: string): CatalogEntry | undefined => {
    const entry = entries.get(id);
    if (id && (!entry || entry.category !== category)) issue(path, `所选${category === 'character' ? '机体' : category === 'memory' ? '意识' : category === 'pet' ? '辅助机' : '资料'}已不可用，请重新选择。`);
    return entry?.category === category ? entry : undefined;
  };
  const memberIds = new Set(team.members.map(member => member.id));
  if (memberIds.size !== team.members.length) issue('members', '队伍成员标识不能重复。');
  if (new Set(team.members.map(member => member.position)).size !== team.members.length) issue('members', '每个站位只能配置一名成员。');
  const characters = team.members.map(member => member.characterId).filter(Boolean);
  if (new Set(characters).size !== characters.length) issue('members', '同一机体不能重复加入队伍。');
  if (requireComplete && !team.members.length) issue('members', '请至少配置一名机体。');
  for (const [key, label] of [['starterMemberId', '首发机体'], ['captainMemberId', '队长机体']] as const) {
    if ((requireComplete || team[key]) && !memberIds.has(team[key])) issue(key, `请选择队伍中的${label}。`);
  }
  for (const [index, member] of team.members.entries()) {
    const path = `members.${index}`;
    const character = lookup(member.characterId, 'character', `${path}.characterId`);
    const label = character?.name || `成员 ${index + 1}`;
    if (requireComplete && !member.characterId) issue(path, `${label}：请选择机体。`);
    if (character && (requireComplete || member.evolutionId) && !character.guideOptions?.evolutionStages?.some(stage => stage.id === member.evolutionId)) issue(`${path}.evolutionId`, `${label}：请选择实际进化阶段；缺少选项时请同步基础资料。`);
    const weapon = lookup(member.weaponId, 'weapon', `${path}.weaponId`);
    const weaponSkillResonances = member.weaponResonanceIds.filter(id => id.startsWith('resonance:weapon-skill-'));
    if (new Set(weaponSkillResonances).size !== weaponSkillResonances.length) issue(`${path}.weaponResonanceIds`, `${label}：同一武器技能共鸣不能重复配置在多个槽位。`);
    if (weapon && character?.guideOptions?.weaponType !== undefined && weapon.guideOptions?.weaponType !== character.guideOptions.weaponType) issue(`${path}.weaponId`, `${label}：武器类型与机体不匹配。`);
    for (const [slot, id] of member.weaponResonanceIds.entries()) {
      if (!id) continue;
      lookup(id, 'resonance', `${path}.weaponResonanceIds.${slot}`);
      if (!weapon?.guideOptions?.resonanceSlots?.find(value => value.slot === slot + 1)?.choices.some(choice => choice.resonanceId === id && (!choice.characterIds.length || choice.characterIds.includes(member.characterId)))) issue(`${path}.weaponResonanceIds.${slot}`, `${label}：第 ${slot + 1} 槽武器共鸣不适用。`);
    }
    if (member.harmonization.level) {
      const level = weapon?.guideOptions?.harmonizationLevels?.find(level => level.level === member.harmonization.level);
      if (!level || level.characterIds.length && !level.characterIds.includes(member.characterId)) issue(`${path}.harmonization`, `${label}：谐振阶段不适用。`);
      if ((requireComplete || member.harmonization.memoryId) && !level?.memoryIds.includes(member.harmonization.memoryId)) issue(`${path}.harmonization.memoryId`, `${label}：请选择此谐振阶段可绑定的意识。`);
      const boundMemory = lookup(member.harmonization.memoryId, 'memory', `${path}.harmonization.memoryId`);
      if (boundMemory?.guideOptions?.characterType && boundMemory.guideOptions.characterType !== character?.guideOptions?.characterType) issue(`${path}.harmonization.memoryId`, `${label}：谐振意识的适用机体类型不匹配。`);
    } else if (member.harmonization.memoryId) issue(`${path}.harmonization`, `${label}：绑定谐振意识前请选择谐振阶段。`);
    const total = member.memories.reduce((sum, memory) => sum + memory.count, 0);
    if (total > 6 || requireComplete && total !== 0 && total !== 6) issue(`${path}.memories`, `${label}：基础意识应为 6 件；谐振提供的额外件数单独计算。`);
    const memoryIds = member.memories.map(memory => memory.memoryId).filter(Boolean);
    if (new Set(memoryIds).size !== memoryIds.length) issue(`${path}.memories`, `${label}：相同意识请合并件数。`);
    for (const memory of member.memories) {
      const item = lookup(memory.memoryId, 'memory', `${path}.memories`);
      if (requireComplete && !memory.memoryId) issue(`${path}.memories`, `${label}：请选择意识名称。`);
      if (item?.guideOptions?.characterType && item.guideOptions.characterType !== character?.guideOptions?.characterType) issue(`${path}.memories`, `${label}：${item.name}的适用机体类型不匹配。`);
      if (item?.guideOptions?.memorySites && memory.count > item.guideOptions.memorySites.length) issue(`${path}.memories`, `${label}：${item.name}没有足够的实际号位。`);
    }
    for (const [side, slot, sideLabel] of [['upper', 1, '上位'], ['lower', 2, '下位']] as const) {
      const allocations = member.memoryResonance[side];
      if (allocations.reduce((sum, value) => sum + value.count, 0) > 6) issue(`${path}.memoryResonance.${side}`, `${label}：${sideLabel}意识共鸣最多 6 次。`);
      if (requireComplete && allocations.some(value => !value.resonanceId)) issue(`${path}.memoryResonance.${side}`, `${label}：请选择${sideLabel}共鸣。`);
      if (!canAllocateResonance(member, slot, allocations, entries)) issue(`${path}.memoryResonance.${side}`, `${label}：${sideLabel}共鸣不能分配到当前意识组合，请核对数量及适用范围。`);
    }
    const pet = lookup(member.pet.petId, 'pet', `${path}.pet`);
    if (pet) {
      const quality = pet.guideOptions?.partnerQualities?.find(value => value.quality === member.pet.quality);
      if ((requireComplete || member.pet.quality) && !quality) issue(`${path}.pet.quality`, `${label}：请选择辅助机实际品级。`);
      if (member.pet.activeSkillId && !pet.guideOptions?.activeSkillGroups?.some(group => group.skillIds.includes(member.pet.activeSkillId))) issue(`${path}.pet.activeSkillId`, `${label}：辅助机主动技能不匹配。`);
      if (member.pet.passiveSkillIds.some(id => !pet.guideOptions?.passiveSkillIds?.includes(id))) issue(`${path}.pet.passiveSkillIds`, `${label}：辅助机被动技能不匹配。`);
      if (new Set(member.pet.passiveSkillIds).size !== member.pet.passiveSkillIds.length) issue(`${path}.pet.passiveSkillIds`, `${label}：同一被动技能不能重复携带。`);
      if (member.pet.passiveSkillIds.length > (quality?.passiveSlots ?? 0)) issue(`${path}.pet.passiveSkillIds`, `${label}：辅助机携带的被动技能超过当前品级槽数。`);
    } else if (member.pet.quality || member.pet.activeSkillId || member.pet.passiveSkillIds.length) issue(`${path}.pet`, `${label}：请先选择辅助机。`);
  }
  if (new Set(team.effectIds).size !== team.effectIds.length) issue('effectIds', '同一队伍效应不能重复配置。');
  const availableEffects = new Set(team.members.flatMap(member => entries.get(member.characterId)?.guideOptions?.effectIds ?? []));
  for (const id of team.effectIds) {
    lookup(id, 'dictionary', 'effectIds');
    if (!availableEffects.has(id)) issue('effectIds', '所选队伍效应不在当前机体提供的效应中。');
  }
  return issues;
};

/** 验证攻略语义，结构上限另由主进程格式校验处理。 */
export const validateGuide = (guide: GuideDocument, entries: readonly CatalogEntry[]): GuideIssue[] => {
  const complete = guide.status === 'ready';
  const issues = validateGuideTeam(guide.team, entries, complete);
  if (!guide.name.trim()) issues.unshift({ path: 'name', message: '请填写攻略名称。' });
  if (!isGuideDateTime(guide.recordedAt)) issues.push({ path: 'recordedAt', message: '请输入有效的攻略记录时间。' });
  for (const [index, value] of guide.videoUrls.entries()) {
    let valid = false;
    try { const url = new URL(value); valid = url.protocol === 'https:' && !url.username && !url.password; } catch { /* 错误在表单中显示。 */ }
    if (!valid) issues.push({ path: `videoUrls.${index}`, message: `参考视频 ${index + 1} 请输入完整的 HTTPS 网页地址。` });
  }
  if (new Set(guide.stageIds).size !== guide.stageIds.length) issues.push({ path: 'stageIds', message: '关联副本不能重复。' });
  if (complete && !guide.stageIds.length) issues.push({ path: 'stageIds', message: '请至少关联一个副本。' });
  for (const id of guide.stageIds) if (!entries.some(entry => entry.id === id && entry.category === 'stage')) issues.push({ path: 'stageIds', message: '关联副本已不可用，请重新选择。' });
  if (complete && !guide.flow.nodes.length) issues.push({ path: 'flow.nodes', message: '请添加操作流程节点。' });
  issues.push(...validateGuideFlow(guide.flow, guide.team, { allowIncomplete: !complete }));
  return issues;
};
