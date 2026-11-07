<script setup lang="ts">
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NSelect, useDialog } from 'naive-ui';
import type { EntryView } from '../../shared/types';
import type { GuideMember, GuideTeam } from '../../shared/guides';
import type { PresetRecord } from '../../shared/presets';
import { applyPresetConfiguration } from '../preset-config';
import { validateGuideTeam } from '../../shared/guide-validation';
import { useGuideSelectMenus } from '../guide-select-menus';

const props = defineProps<{ member: GuideMember; team?: GuideTeam; presets: PresetRecord[]; entries: EntryView[]; disabled?: boolean }>();
const { renderCatalogLabel } = useCatalogSelectLabel(() => props.entries, value => {
  const preset = props.presets.find(item => item.id === value);
  const entryId = preset?.kind === 'character' ? preset.characterId : preset?.kind === 'pet' ? preset.pet.petId : preset?.kind === 'memory' ? preset.memory.memories[0]?.memoryId : '';
  return props.entries.find(entry => entry.id === entryId);
});
const emit = defineEmits<{ apply: [member: GuideMember] }>();
const dialog = useDialog();
const selectedId = ref<string | null>(null);
const setId = ref<string | null>(null);
const { selectMenu, closeSelectMenus } = useGuideSelectMenus();
const choices = computed(() => props.presets.filter(item => !item.hidden)
  .sort((a, b) => Number(b.kind === 'character' && b.characterId === props.member.characterId) - Number(a.kind === 'character' && a.characterId === props.member.characterId) || b.updatedAt.localeCompare(a.updatedAt))
  .map(item => ({ value: item.id, label: `${item.kind === 'memory' ? '意识' : item.kind === 'pet' ? '辅助机' : '机体'} · ${item.name}` })));
const selected = computed(() => props.presets.find(item => item.id === selectedId.value && !item.hidden));
watch(selected, value => { setId.value = value?.kind === 'character' ? value.memorySets[0]?.id || null : null; });
watch(() => props.member.id, () => { selectedId.value = null; closeSelectMenus(); });
const preview = computed(() => selected.value ? applyPresetConfiguration(selected.value, setId.value || '', props.member, props.entries) : null);
const issues = computed(() => {
  if (!preview.value) return [];
  const member = preview.value.member;
  const duplicate = props.team?.members.some(item => item.id !== props.member.id && item.characterId && item.characterId === member.characterId);
  return [...(duplicate ? ['此机体已在其他站位，不能重复引入。'] : []), ...preview.value.issues, ...validateGuideTeam({ members: [member], starterMemberId: member.id, captainMemberId: member.id, effectIds: [] }, props.entries, false).map(issue => issue.message)];
});
/** 确认所选方案后一次性替换配置，稳定成员标识仍用于流程引用。 */
const apply = (): void => {
  if (!preview.value || issues.value.length || props.disabled) return;
  const member = JSON.parse(JSON.stringify(preview.value.member)) as GuideMember;
  const content = selected.value?.kind === 'memory' ? '将替换当前成员的意识、共鸣和谐振意识。' : selected.value?.kind === 'pet' ? '将替换当前成员的辅助机品级和技能配置。' : '将替换当前成员的机体培养、武器、意识方案和辅助机配置。';
  dialog.warning({ title: '引入预设配置？', content, positiveText: '引入配置', negativeText: '取消', onPositiveClick: () => emit('apply', member) });
};
</script>

<template>
  <section class="guide-config-section preset-import" aria-label="快捷引入预设">
    <h4>快捷引入预设</h4>
    <div class="guide-config-grid">
      <div class="guide-form-field"><span>选择预设</span><n-select v-bind="selectMenu('preset')" v-model:value="selectedId" :options="choices" :render-label="renderCatalogLabel" filterable clearable :disabled="disabled" aria-label="选择预设" :input-props="{ 'aria-label': '选择预设' }" placeholder="机体预设或通用预设" /></div>
      <div v-if="selected?.kind === 'character'" class="guide-form-field"><span>意识方案</span><n-select v-bind="selectMenu('memory-set')" v-model:value="setId" :options="selected.memorySets.map(item => ({ value: item.id, label: item.name }))" :disabled="disabled" aria-label="预设意识方案" /></div>
    </div>
    <p v-if="!choices.length" class="guide-config-help">在配置预设中保存常用搭配，即可在这里快速引入。</p>
    <p v-if="selected" class="guide-config-help">{{ selected.notes || '按所选意识方案引入；之后仍可单独调整本攻略配置。' }}</p>
    <n-alert v-if="issues.length" type="warning" :bordered="false"><ul><li v-for="issue in issues" :key="issue">{{ issue }}</li></ul></n-alert>
    <n-button :disabled="disabled || !preview || !!issues.length" @click="apply">引入当前成员</n-button>
  </section>
</template>
