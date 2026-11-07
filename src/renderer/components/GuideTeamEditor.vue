<script setup lang="ts">
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NInput, NInputNumber, NSelect, useDialog } from 'naive-ui';
import { Crown, Flag, Plus, Trash2 } from 'lucide-vue-next';
import type { EntryView } from '../../shared/types';
import { createGuideMember, teamPositions, teamPositionLabels, type GuideMember, type GuideTeam, type TeamPosition } from '../../shared/guides';
import { cloneGuideTeam, filterGuideChoices, guideCatalogChoices, guideOptions, guidePetSkillLabel, memoryResonanceChoices, preserveGuideChoices, swapGuidePosition, weaponResonanceChoices, type GuideChoice, type GuideFilters } from '../guide-team';
import './guide-team.css';
import PresetImport from './PresetImport.vue';
import GuideChoiceFilter from './GuideChoiceFilter.vue';
import type { PresetRecord } from '../../shared/presets';
import { useGuideSelectMenus } from '../guide-select-menus';

const props = defineProps<{ modelValue: GuideTeam; entries: EntryView[]; disabled?: boolean; presets?: PresetRecord[]; presetMode?: 'character' | 'memory' | 'pet'; memorySetId?: string }>();
const { renderCatalogLabel } = useCatalogSelectLabel(() => props.entries, value => {
  const member = props.modelValue.members.find(item => item.id === value);
  if (member) return props.entries.find(entry => entry.id === member.characterId);
  const currentPet = props.entries.find(entry => entry.id === active.value?.pet.petId);
  const skill = currentPet?.sections.find(section => section.skill?.id === value);
  return currentPet && skill ? { ...currentPet, id: value, name: skill.title, image: skill.skill?.image || '', category: 'resonance' } : undefined;
});
const emit = defineEmits<{ 'update:modelValue': [team: GuideTeam] }>();
const dialog = useDialog();
const editorRoot = ref<HTMLElement | null>(null);
/** 直接定位配装分区，避免在长表单中来回寻找。 */
const jumpToConfig = (section: string): void => {
  closeSelectMenus();
  editorRoot.value?.querySelector('[data-config-section="' + section + '"]')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
};
const activeId = ref(props.modelValue.members[0]?.id || '');
const filters = ref({ character: {} as GuideFilters, memory: {} as GuideFilters, weapon: {} as GuideFilters, pet: {} as GuideFilters });
const memoryResonanceFilters = ref<GuideFilters>({});
const weaponResonanceFilters = ref<GuideFilters>({});
const { selectMenu, closeSelectMenus } = useGuideSelectMenus();
watch([activeId, () => props.disabled], closeSelectMenus);
watch(() => props.memorySetId, () => {
  closeSelectMenus();
  filters.value.memory = {};
  memoryResonanceFilters.value = {};
});
const active = computed(() => props.modelValue.members.find(member => member.id === activeId.value));
const byId = computed(() => new Map(props.entries.map(entry => [entry.id, entry])));
const character = computed(() => byId.value.get(active.value?.characterId || ''));
const weapon = computed(() => byId.value.get(active.value?.weaponId || ''));
const pet = computed(() => byId.value.get(active.value?.pet.petId || ''));
const positionOptions = teamPositions.map(position => ({ value: position, label: teamPositionLabels[position] }));
const roleOptions = computed(() => props.modelValue.members.map(member => ({ value: member.id, label: `${teamPositionLabels[member.position]} · ${byId.value.get(member.characterId)?.name || '未选择机体'}` })));
const characterOptions = computed(() => guideCatalogChoices(props.entries, 'character', [active.value?.characterId || ''], undefined, { facets: filters.value.character }).map(choice => ({ ...choice, disabled: choice.disabled || props.modelValue.members.some(member => member.id !== activeId.value && member.characterId === choice.value) })));
const evolutionOptions = computed(() => preserveGuideChoices((guideOptions(character.value)?.evolutionStages ?? []).map(stage => ({ value: stage.id, label: stage.label })), [active.value?.evolutionId || '']));
const currentEvolution = computed(() => guideOptions(character.value)?.evolutionStages?.find(stage => stage.id === active.value?.evolutionId));
const evolutionEffects = computed(() => character.value?.sections.filter(section => section.skill && currentEvolution.value?.effectSectionIds.includes(section.skill.id)) ?? []);
const weaponOptions = computed(() => {
  const type = guideOptions(character.value)?.weaponType;
  return guideCatalogChoices(props.entries, 'weapon', [active.value?.weaponId || ''], entry => type === undefined || guideOptions(entry)?.weaponType === type, { characterId: active.value?.characterId, facets: filters.value.weapon });
});
const memoryOptions = computed(() => {
  const type = guideOptions(character.value)?.characterType;
  return guideCatalogChoices(props.entries, 'memory', active.value?.memories.map(item => item.memoryId) ?? [], entry => !type || !guideOptions(entry)?.characterType || guideOptions(entry)?.characterType === type, { characterId: active.value?.characterId, facets: filters.value.memory });
});
const memoryCount = computed(() => active.value?.memories.reduce((sum, allocation) => sum + allocation.count, 0) ?? 0);
const harmonizationLevels = computed(() => (guideOptions(weapon.value)?.harmonizationLevels ?? []).filter(level => !level.characterIds.length || level.characterIds.includes(active.value?.characterId || '')));
const harmonizationOptions = computed(() => {
  const result = [{ value: 0, label: '无谐振', disabled: false }, ...harmonizationLevels.value.map(level => ({ value: level.level, label: `${level.label} · 额外意识 ${level.bonusPieces} 件`, disabled: false }))];
  const selected = active.value?.harmonization.level;
  if (selected && !result.some(option => option.value === selected)) result.push({ value: selected, label: '原谐振阶段（当前不可用）', disabled: true });
  return result;
});
const currentHarmonization = computed(() => harmonizationLevels.value.find(level => level.level === active.value?.harmonization.level));
const harmonizationMemoryOptions = computed(() => guideCatalogChoices(props.entries, 'memory', [active.value?.harmonization.memoryId || ''], entry => {
  const characterType = guideOptions(character.value)?.characterType;
  const memoryType = guideOptions(entry)?.characterType;
  return !!currentHarmonization.value?.memoryIds.includes(entry.id) && (!characterType || !memoryType || characterType === memoryType);
}));
const petOptions = computed(() => guideCatalogChoices(props.entries, 'pet', [active.value?.pet.petId || ''], undefined, { characterId: active.value?.characterId, facets: filters.value.pet }));
const petQualities = computed(() => guideOptions(pet.value)?.partnerQualities ?? []);
const petQualityOptions = computed(() => {
  const result = [{ value: 0, label: '未选择品级', disabled: false }, ...petQualities.value.map(quality => ({ value: quality.quality, label: `${quality.label} · ${quality.passiveSlots} 个被动槽`, disabled: false }))];
  const selected = active.value?.pet.quality;
  if (selected && !result.some(option => option.value === selected)) result.push({ value: selected, label: '原品级（当前不可用）', disabled: true });
  return result;
});
const passiveSlots = computed(() => petQualities.value.find(quality => quality.quality === active.value?.pet.quality)?.passiveSlots ?? 0);
const activeSkillOptions = computed(() => preserveGuideChoices((guideOptions(pet.value)?.activeSkillGroups ?? []).flatMap(group => group.skillIds.map(id => ({ value: id, label: guidePetSkillLabel(pet.value, id) }))), [active.value?.pet.activeSkillId || '']));
const passiveSkillOptions = computed(() => {
  const selected = active.value?.pet.passiveSkillIds ?? [];
  return preserveGuideChoices((guideOptions(pet.value)?.passiveSkillIds ?? []).map(id => ({ value: id, label: guidePetSkillLabel(pet.value, id), disabled: !selected.includes(id) && selected.length >= passiveSlots.value })), selected);
});
const selectedPetSkills = computed(() => {
  const ids = [active.value?.pet.activeSkillId || '', ...(active.value?.pet.passiveSkillIds ?? [])];
  return ids.filter(Boolean).map(id => ({ id, label: guidePetSkillLabel(pet.value, id), body: pet.value?.sections.find(section => section.skill?.id === id)?.body || '' }));
});
const effectOptions = computed(() => {
  const ids = new Set(props.modelValue.members.flatMap(member => guideOptions(byId.value.get(member.characterId))?.effectIds ?? []));
  return guideCatalogChoices(props.entries, 'dictionary', props.modelValue.effectIds, entry => ids.has(entry.id));
});

watch(() => props.modelValue.members.map(member => member.id), ids => {
  if (!ids.includes(activeId.value)) activeId.value = ids[0] || '';
});

/** 所有表单写入复制后的队伍，不直接修改父组件的对象。 */
const changeTeam = (change: (team: GuideTeam) => void): void => {
  if (props.disabled) return;
  const next = cloneGuideTeam(props.modelValue);
  change(next);
  emit('update:modelValue', next);
};
/** 只更新当前成员的目标字段，其他配置与流程引用保持不变。 */
const changeMember = (change: (member: GuideMember) => void): void => {
  changeTeam(team => {
    const member = team.members.find(item => item.id === activeId.value);
    if (member) change(member);
  });
};
/** 点击空站位新增成员，第一名成员同时作为首发与队长。 */
const selectPosition = (position: TeamPosition): void => {
  const existing = props.modelValue.members.find(member => member.position === position);
  if (existing) { activeId.value = existing.id; return; }
  const member = createGuideMember(position);
  changeTeam(team => {
    team.members.push(member);
    if (!team.starterMemberId) team.starterMemberId = member.id;
    if (!team.captainMemberId) team.captainMemberId = member.id;
  });
  activeId.value = member.id;
};
/** 交换已占用站位，保留成员和节点的身份关系。 */
const changePosition = (value: TeamPosition): void => {
  if (!props.disabled && active.value) emit('update:modelValue', swapGuidePosition(props.modelValue, active.value.id, value));
};
/** 移除成员前明确提示装备配置和已有节点引用的处理。 */
const removeMember = (): void => {
  const member = active.value;
  if (!member) return;
  dialog.warning({ title: '移除队伍成员？', content: `将移除${teamPositionLabels[member.position]}的机体和装备配置。引用该成员的操作节点会保留，并提示重新选择角色。`, positiveText: '移除成员', negativeText: '取消', onPositiveClick: () => {
    changeTeam(team => {
      team.members = team.members.filter(item => item.id !== member.id);
      if (team.starterMemberId === member.id) team.starterMemberId = '';
      if (team.captainMemberId === member.id) team.captainMemberId = '';
    });
  } });
};
/** 套用快捷件数时保留可对应的意识选择，替换已有搭配前让用户确认。 */
const applyMemoryPreset = (counts: readonly number[]): void => {
  const apply = (): void => changeMember(member => { member.memories = counts.map((count, index) => ({ memoryId: member.memories[index]?.memoryId || '', count })); });
  if (active.value?.memories.some(item => item.memoryId)) {
    dialog.warning({ title: `套用 ${counts.join(' + ')} 件搭配？`, content: '会重新分配基础六件的数量，按顺序保留已有意识选择。超出新组合的行将移除，已有共鸣会保留供你核对。', positiveText: '套用搭配', negativeText: '取消', onPositiveClick: apply });
  } else apply();
};
/** 共鸣数量依据当前意识组合计算，整排六次只开放给六件均可使用的选项。 */
const resonanceOptions = (side: 'upper' | 'lower'): GuideChoice[] => active.value ? filterGuideChoices(memoryResonanceChoices(active.value, props.entries, side), memoryResonanceFilters.value, active.value.memoryResonance[side].map(item => item.resonanceId), props.entries) : [];
const resonanceTotal = (side: 'upper' | 'lower'): number => active.value?.memoryResonance[side].reduce((sum, allocation) => sum + allocation.count, 0) ?? 0;
const resonancePresetOptions = (side: 'upper' | 'lower'): GuideChoice[] => resonanceOptions(side).filter(option => !option.disabled && (option.maxCount ?? 0) >= 6);
/** 快捷选择的动作明确替换该侧六次共鸣，另一侧不受影响。 */
const applyResonancePreset = (side: 'upper' | 'lower', id: string): void => {
  if (!resonancePresetOptions(side).some(option => option.value === id)) return;
  changeMember(member => { member.memoryResonance[side] = [{ resonanceId: id, count: 6 }]; });
};
/** 每个武器槽使用自己的源共鸣池，失效选择仍可见。 */
const weaponResonanceOptions = (slot: number): GuideChoice[] => active.value ? filterGuideChoices(weaponResonanceChoices(active.value, props.entries, slot), weaponResonanceFilters.value, active.value.weaponResonanceIds, props.entries) : [];
/** 明确移除武器时同时解除其共鸣和谐振，替换武器时保留原配置供核对。 */
const selectWeapon = (value: string | null): void => changeMember(member => {
  member.weaponId = value || '';
  if (!value) {
    member.weaponResonanceIds = ['', '', ''];
    member.harmonization = { level: 0, memoryId: '' };
  }
});
/** 关闭谐振时解除绑定意识，避免留下隐藏但无法修正的绑定。 */
const selectHarmonization = (value: number): void => changeMember(member => {
  member.harmonization.level = value;
  if (!value) member.harmonization.memoryId = '';
});
/** 明确移除辅助机时清空其培养和携带技能，替换时保留并显示失效选择。 */
const selectPet = (value: string | null): void => changeMember(member => {
  if (value) member.pet.petId = value;
  else member.pet = { petId: '', quality: 0, activeSkillId: '', passiveSkillIds: [] };
});
</script>

<template>
  <section ref="editorRoot" class="guide-team-editor" aria-label="队伍配置编辑">
    <div v-if="!presetMode" class="guide-team-member-tabs" role="group" aria-label="选择队伍成员">
      <button v-for="position in teamPositions" :key="position" type="button" :data-position="position" :data-team-member="modelValue.members.find(member => member.position === position)?.id || ''" :class="{ active: active?.position === position }" :disabled="disabled" @click="selectPosition(position)">
        <strong>{{ teamPositionLabels[position] }}</strong><span v-if="modelValue.members.find(member => member.position === position)">{{ byId.get(modelValue.members.find(member => member.position === position)!.characterId)?.name || '选择机体' }}</span><span v-else><Plus :size="13" />添加成员</span>
      </button>
    </div>
    <div v-if="!presetMode && active" class="guide-quick-swap" aria-label="快速换位">
      <span>{{ byId.get(active.characterId)?.name || teamPositionLabels[active.position] }} · 换位</span>
      <n-button v-for="position in teamPositions.filter(value => value !== active!.position)" :key="position" size="small" :disabled="disabled" @click="changePosition(position)">{{ modelValue.members.some(member => member.position === position) ? '与' + teamPositionLabels[position] + '互换' : '移至' + teamPositionLabels[position] }}</n-button>
    </div>
    <div v-if="!presetMode" class="guide-team-global-fields">
      <div class="guide-form-field"><span><Flag :size="14" />首发机体</span><n-select v-bind="selectMenu('starter')" :value="modelValue.starterMemberId || null" :options="roleOptions" :render-label="renderCatalogLabel" :disabled="disabled" placeholder="选择首发机体" aria-label="首发机体" @update:value="value => changeTeam(team => { team.starterMemberId = value || ''; })" /></div>
      <div class="guide-form-field"><span><Crown :size="14" />队长机体</span><n-select v-bind="selectMenu('captain')" :value="modelValue.captainMemberId || null" :options="roleOptions" :render-label="renderCatalogLabel" :disabled="disabled" placeholder="选择队长机体" aria-label="队长机体" @update:value="value => changeTeam(team => { team.captainMemberId = value || ''; })" /></div>
      <div class="guide-form-field guide-full-field"><span>队伍效应</span><n-select :input-props="{ 'aria-label': '队伍效应' }" v-bind="selectMenu('effects')" :value="modelValue.effectIds" :options="effectOptions" :render-label="renderCatalogLabel" multiple filterable clearable :disabled="disabled" placeholder="选择队伍机体提供的效应" aria-label="队伍效应" @update:value="value => changeTeam(team => { team.effectIds = value; })" /><small>选项来自已选机体的效应。</small></div>
    </div>
    <div v-if="!active" class="guide-team-empty"><p>点击一个站位添加成员，再选择机体和装备。</p></div>
    <div v-else class="guide-member-editor" :data-active-member="active.id">
      <header v-if="!presetMode" class="guide-member-editor-heading"><h3>{{ teamPositionLabels[active.position] }}配置</h3><n-button quaternary size="small" type="error" :disabled="disabled" @click="removeMember"><template #icon><Trash2 :size="14" /></template>移除成员</n-button></header>
      <nav class="guide-config-jump" aria-label="配装分区"><button v-if="!presetMode || presetMode === 'character'" type="button" @click="jumpToConfig('character')">机体培养</button><button v-if="presetMode !== 'pet'" type="button" @click="jumpToConfig('memory')">意识搭配</button><button v-if="!presetMode || presetMode === 'character'" type="button" @click="jumpToConfig('weapon')">武器与共鸣</button><button v-if="presetMode !== 'memory'" type="button" @click="jumpToConfig('pet')">辅助机</button></nav>
      <PresetImport v-if="!presetMode" :team="modelValue" :member="active" :presets="presets || []" :entries="entries" :disabled="disabled" @apply="value => changeMember(member => Object.assign(member, value))" />
      <section v-if="!presetMode || presetMode === 'character'" class="guide-config-section" data-config-section="character">
        <h4>机体与进化</h4>
        <GuideChoiceFilter v-if="!presetMode" v-model="filters.character" :entries="entries" category="character" label="机体" :disabled="disabled" />
        <div class="guide-config-grid">
          <div v-if="!presetMode" class="guide-form-field"><span>机体</span><n-select :input-props="{ 'aria-label': '配置机体' }" v-bind="selectMenu('character')" :value="active.characterId || null" :options="characterOptions" :render-label="renderCatalogLabel" filterable :disabled="disabled" placeholder="搜索并选择机体" aria-label="配置机体" @update:value="value => changeMember(member => { member.characterId = value || ''; })" /></div>
          <div class="guide-form-field"><span>进化品级与阶段</span><n-select :input-props="{ 'aria-label': '进化品级与阶段' }" v-bind="selectMenu('evolution')" :value="active.evolutionId || null" :options="evolutionOptions" filterable :disabled="disabled || !active.characterId" placeholder="例如 SSS、SSS3" aria-label="进化品级与阶段" @update:value="value => changeMember(member => { member.evolutionId = value || ''; })" /><small>记录实际进化阶段，不使用图鉴初始品级。</small></div>
          <div v-if="!presetMode" class="guide-form-field"><span>站位</span><n-select v-bind="selectMenu('position')" :value="active.position" :options="positionOptions" :disabled="disabled" aria-label="机体站位" @update:value="changePosition" /><small>选择已占用的位置会交换两名成员的站位。</small></div>
        </div>
        <n-alert v-if="active.characterId && !guideOptions(character)?.evolutionStages?.length" type="warning" :bordered="false">当前机体缺少培养选项，请先同步基础资料。</n-alert>
        <details v-if="evolutionEffects.length" class="guide-effect-details"><summary>查看 {{ currentEvolution?.label }} 阶段新增效果</summary><div v-for="section in evolutionEffects" :key="section.skill?.id"><strong>{{ section.title }}</strong><p>{{ section.body }}</p></div></details>
      </section>
      <section v-if="presetMode !== 'pet'" class="guide-config-section" data-config-section="memory">
        <div class="guide-section-heading"><h4>意识搭配 <small>{{ memoryCount }} / 6 件</small></h4><div class="guide-preset-buttons"><span>快捷搭配</span><n-button v-for="counts in [[4, 2], [2, 2, 2], [6]]" :key="counts.join('-')" size="small" :disabled="disabled" @click="applyMemoryPreset(counts)">{{ counts.join(' + ') }}</n-button></div></div>
        <slot name="memory-plans" />
        <p class="guide-config-help">这里配置基础六件；{{ presetMode ? '谐振意识在下方单独设置。' : '谐振增加的套装计数在武器区单独设置。' }}</p>
        <GuideChoiceFilter v-model="filters.memory" :entries="entries" category="memory" label="意识" :disabled="disabled" />
        <div v-for="(allocation, index) in active.memories" :key="index" class="guide-allocation-row">
          <n-select :input-props="{ 'aria-label': `第${index + 1}组意识套装` }" v-bind="selectMenu(`memory-${index}`)" :value="allocation.memoryId || null" :options="memoryOptions" :render-label="renderCatalogLabel" filterable :disabled="disabled" placeholder="选择意识套装" :aria-label="`第${index + 1}组意识套装`" @update:value="value => changeMember(member => { member.memories[index].memoryId = value || ''; })" />
          <n-input-number :value="allocation.count" :min="1" :max="6" :precision="0" :disabled="disabled" :aria-label="`第${index + 1}组意识件数`" @update:value="value => changeMember(member => { member.memories[index].count = value ?? 1; })"><template #suffix>件</template></n-input-number>
          <n-button quaternary circle type="error" :disabled="disabled" :aria-label="`移除第${index + 1}组意识`" @click="changeMember(member => { member.memories.splice(index, 1); })"><template #icon><Trash2 :size="15" /></template></n-button>
        </div>
        <n-button size="small" dashed :disabled="disabled || active.memories.length >= 6" @click="changeMember(member => { member.memories.push({ memoryId: '', count: 1 }); })"><template #icon><Plus :size="14" /></template>添加意识组合</n-button>
        <n-alert v-if="memoryCount && memoryCount !== 6" :type="memoryCount > 6 ? 'error' : 'warning'" :bordered="false" class="guide-inline-alert">基础意识需合计 6 件，目前为 {{ memoryCount }} 件。</n-alert>
        <GuideChoiceFilter v-if="!presetMode || presetMode === 'character'" v-model="memoryResonanceFilters" :entries="entries" category="resonance" label="意识共鸣" :disabled="disabled" />
        <div v-if="!presetMode || presetMode === 'character'" class="guide-resonance-sides">
          <section v-for="side in (['upper', 'lower'] as const)" :key="side" class="guide-resonance-side" :data-resonance-side="side">
            <h5>{{ side === 'upper' ? '上位' : '下位' }}共鸣 <span>{{ resonanceTotal(side) }} / 6</span></h5>
            <n-select :input-props="{ 'aria-label': `${side === 'upper' ? '上位' : '下位'}共鸣六次快捷` }" v-bind="selectMenu(`preset-${side}`)" :value="null" :options="resonancePresetOptions(side)" :render-label="renderCatalogLabel" filterable :disabled="disabled || !resonancePresetOptions(side).length" :placeholder="`快捷：6 个相同${side === 'upper' ? '上位' : '下位'}共鸣`" :aria-label="`${side === 'upper' ? '上位' : '下位'}共鸣六次快捷`" @update:value="value => applyResonancePreset(side, value)" />
            <div v-for="(allocation, index) in active.memoryResonance[side]" :key="index" class="guide-allocation-row">
              <n-select :input-props="{ 'aria-label': `${side === 'upper' ? '上位' : '下位'}第${index + 1}种共鸣` }" v-bind="selectMenu(`resonance-${side}-${index}`)" :value="allocation.resonanceId || null" :options="resonanceOptions(side)" :render-label="renderCatalogLabel" filterable :disabled="disabled" placeholder="选择共鸣" :aria-label="`${side === 'upper' ? '上位' : '下位'}第${index + 1}种共鸣`" @update:value="value => changeMember(member => { member.memoryResonance[side][index].resonanceId = value || ''; })" />
              <n-input-number :value="allocation.count" :min="1" :max="6" :precision="0" :disabled="disabled" :aria-label="`${side === 'upper' ? '上位' : '下位'}第${index + 1}种共鸣数量`" @update:value="value => changeMember(member => { member.memoryResonance[side][index].count = value ?? 1; })" />
              <n-button quaternary circle type="error" :disabled="disabled" :aria-label="`移除${side === 'upper' ? '上位' : '下位'}第${index + 1}种共鸣`" @click="changeMember(member => { member.memoryResonance[side].splice(index, 1); })"><template #icon><Trash2 :size="14" /></template></n-button>
            </div>
            <n-button size="small" text :disabled="disabled || active.memoryResonance[side].length >= 6" @click="changeMember(member => { member.memoryResonance[side].push({ resonanceId: '', count: 1 }); })"><template #icon><Plus :size="13" /></template>添加{{ side === 'upper' ? '上位' : '下位' }}共鸣</n-button>
            <p v-if="resonanceTotal(side) > 6" class="guide-config-error">这一侧最多配置 6 次共鸣。</p>
          </section>
        </div>
        <div v-if="presetMode === 'character' && active.harmonization.level" class="guide-form-field"><span>本方案谐振意识<template v-if="currentHarmonization"> · 额外 {{ currentHarmonization.bonusPieces }} 件</template></span><n-select :input-props="{ 'aria-label': '谐振绑定意识' }" v-bind="selectMenu('harmonization-memory')" :value="active.harmonization.memoryId || null" :options="harmonizationMemoryOptions" :render-label="renderCatalogLabel" filterable :disabled="disabled" placeholder="选择本方案的谐振绑定意识" aria-label="谐振绑定意识" @update:value="value => changeMember(member => { member.harmonization.memoryId = value || ''; })" /></div>
      </section>
      <section v-if="!presetMode || presetMode === 'character'" class="guide-config-section" data-config-section="weapon">
        <h4>武器、共鸣与谐振</h4>
        <GuideChoiceFilter v-model="filters.weapon" :entries="entries" category="weapon" label="武器" :disabled="disabled" />
        <div class="guide-form-field"><span>武器</span><n-select :input-props="{ 'aria-label': '配置武器' }" v-bind="selectMenu('weapon')" :value="active.weaponId || null" :options="weaponOptions" :render-label="renderCatalogLabel" filterable clearable :disabled="disabled" placeholder="选择可装备武器" aria-label="配置武器" @update:value="selectWeapon" /></div>
        <GuideChoiceFilter v-model="weaponResonanceFilters" :entries="entries" category="resonance" label="武器共鸣" :disabled="disabled" />
        <div class="guide-weapon-resonance-editor">
          <div v-for="slot in 3" :key="slot" class="guide-form-field"><span>武器共鸣 {{ slot }}</span><n-select :input-props="{ 'aria-label': `武器共鸣${slot}` }" v-bind="selectMenu(`weapon-resonance-${slot}`)" :value="active.weaponResonanceIds[slot - 1] || null" :options="weaponResonanceOptions(slot)" :render-label="renderCatalogLabel" filterable clearable :disabled="disabled || !active.weaponId" placeholder="未配置" :aria-label="`武器共鸣${slot}`" @update:value="value => changeMember(member => { member.weaponResonanceIds[slot - 1] = value || ''; })" /></div>
        </div>
        <div class="guide-config-grid">
          <div class="guide-form-field"><span>谐振阶段</span><n-select v-bind="selectMenu('harmonization')" :value="active.harmonization.level" :options="harmonizationOptions" :disabled="disabled || !active.weaponId" aria-label="武器谐振阶段" @update:value="selectHarmonization" /></div>
          <div v-if="!presetMode && active.harmonization.level" class="guide-form-field"><span>谐振意识<template v-if="currentHarmonization"> · 额外 {{ currentHarmonization.bonusPieces }} 件</template></span><n-select :input-props="{ 'aria-label': '谐振绑定意识' }" v-bind="selectMenu('harmonization-memory')" :value="active.harmonization.memoryId || null" :options="harmonizationMemoryOptions" :render-label="renderCatalogLabel" filterable :disabled="disabled" placeholder="选择谐振绑定意识" aria-label="谐振绑定意识" @update:value="value => changeMember(member => { member.harmonization.memoryId = value || ''; })" /></div>
        </div>
        <details v-if="currentHarmonization?.description" class="guide-effect-details"><summary>查看本阶段新增效果</summary><p>{{ currentHarmonization.description }}</p></details>
      </section>
      <section v-if="presetMode !== 'memory'" class="guide-config-section" data-config-section="pet">
        <h4>辅助机与携带技能</h4>
        <GuideChoiceFilter v-model="filters.pet" :entries="entries" category="pet" label="辅助机" :disabled="disabled" />
        <div class="guide-config-grid">
          <div class="guide-form-field"><span>辅助机</span><n-select :input-props="{ 'aria-label': '配置辅助机' }" v-bind="selectMenu('pet')" :value="active.pet.petId || null" :options="petOptions" :render-label="renderCatalogLabel" filterable clearable :disabled="disabled" placeholder="选择辅助机" aria-label="配置辅助机" @update:value="selectPet" /></div>
          <div class="guide-form-field"><span>辅助机品级</span><n-select v-bind="selectMenu('pet-quality')" :value="active.pet.quality" :options="petQualityOptions" :disabled="disabled || !active.pet.petId" aria-label="辅助机品级" @update:value="value => changeMember(member => { member.pet.quality = value; })" /></div>
        </div>
        <template v-if="active.pet.petId">
          <div class="guide-form-field"><span>携带主动技能 · 1 个</span><n-select :input-props="{ 'aria-label': '辅助机主动技能' }" v-bind="selectMenu('pet-active')" :value="active.pet.activeSkillId || null" :options="activeSkillOptions" :render-label="renderCatalogLabel" filterable clearable :disabled="disabled" placeholder="选择主动技能及属性版本" aria-label="辅助机主动技能" @update:value="value => changeMember(member => { member.pet.activeSkillId = value || ''; })" /></div>
          <div class="guide-form-field"><span>携带被动技能 · {{ active.pet.passiveSkillIds.length }} / {{ passiveSlots }}</span><n-select :input-props="{ 'aria-label': '辅助机被动技能' }" v-bind="selectMenu('pet-passive')" :value="active.pet.passiveSkillIds" :options="passiveSkillOptions" :render-label="renderCatalogLabel" multiple filterable clearable :disabled="disabled" placeholder="按辅助机品级选择被动技能" aria-label="辅助机被动技能" @update:value="value => changeMember(member => { member.pet.passiveSkillIds = value; })" /></div>
          <n-alert v-if="active.pet.passiveSkillIds.length > passiveSlots" type="error" :bordered="false">当前品级最多携带 {{ passiveSlots }} 个被动技能。原选择已保留，请移除超出的技能。</n-alert>
          <details v-if="selectedPetSkills.length" class="guide-effect-details"><summary>查看已携带技能说明</summary><div v-for="skill in selectedPetSkills" :key="skill.id"><strong>{{ skill.label }}</strong><p>{{ skill.body || '原技能说明暂不可用，请重新选择。' }}</p></div></details>
        </template>
      </section>
      <label v-if="!presetMode" class="guide-form-field"><span>成员配置备注</span><n-input :value="active.notes" type="textarea" :autosize="{ minRows: 2, maxRows: 6 }" :disabled="disabled" placeholder="记录培养、替代搭配或使用条件" aria-label="成员配置备注" @update:value="value => changeMember(member => { member.notes = value; })" /></label>
    </div>
  </section>
</template>
