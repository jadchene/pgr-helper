<script setup lang="ts">
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, watch } from 'vue';
import { NButton, NSelect } from 'naive-ui';
import type { EntryView, CatalogEntry } from '../../shared/types';
import type { GuideFilters } from '../guide-team';
import { catalogQueryConfig, facetOptions } from '../catalog-query';
import { useGuideSelectMenus } from '../guide-select-menus';

const props = defineProps<{ modelValue: GuideFilters; entries: EntryView[]; category: CatalogEntry['category']; label: string; disabled?: boolean; hasSearch?: boolean }>();
const { renderFacetLabel } = useCatalogSelectLabel(() => props.entries);
const emit = defineEmits<{ 'update:modelValue': [value: GuideFilters]; clear: [] }>();
const { selectMenu, closeSelectMenus } = useGuideSelectMenus();
watch(() => props.category, closeSelectMenus);
const entries = computed(() => props.entries.filter(entry => entry.category === props.category && !entry.hidden && !entry.retired));
const fields = computed(() => catalogQueryConfig[props.category].filters.map(field => ({ ...field, options: facetOptions(entries.value, field.key) })));
const active = computed(() => props.hasSearch || Object.values(props.modelValue).some(Boolean));
/** 独立更新一个筛选字段，其他条件保持不变。 */
const update = (key: string, value: string | null): void => {
  const next = { ...props.modelValue };
  if (value) next[key] = value;
  else delete next[key];
  emit('update:modelValue', next);
};
/** 一次清空全部筛选，不改变已选装备。 */
const clear = (): void => {
  closeSelectMenus();
  emit('update:modelValue', {});
  emit('clear');
};
</script>
<template>
  <section class="guide-choice-filter" :aria-label="`${label}筛选`">
    <header><span>{{ label }}筛选</span><n-button text size="small" :disabled="disabled || !active" @click="clear">清空筛选</n-button></header>
    <div class="guide-filter-fields">
      <slot name="before-fields" />
      <div v-for="field in fields" :key="field.key" class="guide-filter-field">
        <span>{{ field.label }}</span>
        <n-select v-bind="selectMenu(field.key)" :value="modelValue[field.key] || null" :options="field.options" :render-label="option => renderFacetLabel(field.key, option)" filterable clearable :disabled="disabled" :aria-label="`${label}${field.label}筛选`" :placeholder="`全部${field.label}`" @update:value="value => update(field.key, value)" />
      </div>
    </div>
  </section>
</template>
<style scoped>
.guide-choice-filter { min-width: 0; margin: 8px 0 12px; padding: 12px; border: 1px solid var(--border); border-radius: 8px; background: var(--subtle); font-size: 12px; color: var(--muted); }
.guide-choice-filter > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
.guide-filter-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 150px), 1fr)); gap: 8px 12px; }
.guide-filter-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
</style>
