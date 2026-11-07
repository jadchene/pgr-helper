<script setup lang="ts">
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, watch } from 'vue';
import { NButton, NInputNumber, NSelect } from 'naive-ui';
import type { EntryView } from '../../shared/types';
import type { PresetMemory, PresetResonance } from '../../shared/presets';
import { guideCatalogChoices, guideResonanceLabel, preserveGuideChoices } from '../guide-team';
import { compareCatalogEntries } from '../catalog-query';
import { useGuideSelectMenus } from '../guide-select-menus';

const props = defineProps<{ modelValue: PresetMemory; entries: EntryView[] }>();
const { renderCatalogLabel } = useCatalogSelectLabel(() => props.entries);
const emit = defineEmits<{ 'update:modelValue': [value: PresetMemory] }>();
const { selectMenu, closeSelectMenus } = useGuideSelectMenus();
watch(() => props.modelValue.memories, closeSelectMenus);
const byId = computed(() => new Map(props.entries.map(entry => [entry.id, entry])));
const key = (item: PresetResonance): string => `${item.kind}:${item.value}`;
/** 只从所选意识的真实共鸣池派生选项；机体技能保存类型，属性保存具体条目。 */
const options = (side: 'upper' | 'lower') => {
  const found = new Map<string, { value: string; label: string }>();
  const choices = props.modelValue.memories.flatMap(item => byId.value.get(item.memoryId)?.guideOptions?.resonanceSlots?.find(slot => slot.slot === (side === 'upper' ? 1 : 2))?.choices || []);
  choices.sort((a, b) => {
    const left = byId.value.get(a.resonanceId), right = byId.value.get(b.resonanceId);
    return left && right ? compareCatalogEntries(left, right) : 0;
  });
  for (const choice of choices) {
    const entry = byId.value.get(choice.resonanceId);
    if (!entry || entry.hidden || entry.retired) continue;
    const types = entry.catalog?.facets.skillType?.filter(value => value && value !== '未提供') || [];
    if (choice.characterIds.length) {
      for (const type of types) found.set(`skillType:${type}`, { value: `skillType:${type}`, label: `${type} · 按目标机体匹配` });
    } else found.set(`entry:${entry.id}`, { value: `entry:${entry.id}`, label: guideResonanceLabel(entry) });
  }
  return preserveGuideChoices([...found.values()], props.modelValue.resonance[side].map(key));
};
const memoryOptions = computed(() => guideCatalogChoices(props.entries, 'memory', [props.modelValue.harmonizationMemoryId]));
/** 每次修改独立拷贝，避免污染其他意识方案。 */
const change = (edit: (value: PresetMemory) => void): void => {
  const copy = JSON.parse(JSON.stringify(props.modelValue)) as PresetMemory;
  edit(copy); emit('update:modelValue', copy);
};
const choose = (side: 'upper' | 'lower', index: number, value: string): void => {
  const separator = value.indexOf(':');
  change(copy => { copy.resonance[side][index] = { ...copy.resonance[side][index], kind: value.slice(0, separator) as PresetResonance['kind'], value: value.slice(separator + 1) }; });
};
const total = (side: 'upper' | 'lower'): number => props.modelValue.resonance[side].reduce((sum, item) => sum + item.count, 0);
</script>

<template>
  <section class="guide-config-section preset-general-memory">
    <h4>通用意识共鸣与谐振</h4>
    <p class="muted">技能共鸣按职业技能、必杀技能等类型保存，引入攻略时匹配目标机体的实际技能。</p>
    <div v-for="side in (['upper', 'lower'] as const)" :key="side" class="guide-form-field">
      <span>{{ side === 'upper' ? '上位' : '下位' }}共鸣 · {{ total(side) }} / 6</span>
      <div v-for="(item, index) in modelValue.resonance[side]" :key="index" class="preset-resonance-row">
        <n-select v-bind="selectMenu(`${side}-${index}`)" :value="item.value ? key(item) : null" :options="options(side)" :render-label="renderCatalogLabel" filterable :aria-label="`通用${side === 'upper' ? '上位' : '下位'}共鸣${index + 1}`" placeholder="选择属性或技能类型" @update:value="value => choose(side, index, value)" />
        <n-input-number :value="item.count" :min="1" :max="6 - total(side) + item.count" :precision="0" :aria-label="`通用${side === 'upper' ? '上位' : '下位'}共鸣${index + 1}次数`" @update:value="value => change(copy => { copy.resonance[side][index].count = value || 1; })" />
        <n-button @click="change(copy => { copy.resonance[side].splice(index, 1); })">移除</n-button>
      </div>
      <n-button :disabled="total(side) >= 6 || !options(side).length" @click="change(copy => { copy.resonance[side].push({ kind: 'entry', value: '', count: 1 }); })">添加{{ side === 'upper' ? '上位' : '下位' }}共鸣</n-button>
    </div>
    <div class="guide-form-field"><span>谐振意识</span><n-select v-bind="selectMenu('memory')" :value="modelValue.harmonizationMemoryId || null" :options="memoryOptions" :render-label="renderCatalogLabel" filterable clearable aria-label="通用谐振意识" placeholder="可选，按攻略中的武器谐振阶段生效" @update:value="value => change(copy => { copy.harmonizationMemoryId = value || ''; })" /></div>
  </section>
</template>

<style scoped>
.preset-resonance-row { display: grid; grid-template-columns: minmax(150px, 1fr) 110px auto; gap: 8px; }
.guide-form-field { margin-top: 16px; }
</style>
