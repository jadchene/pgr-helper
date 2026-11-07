<script setup lang="ts">
import type { EntryView } from '../../shared/types';
import { useCatalogSelectLabel } from '../catalog-select-label';
import { NButton, NInput, NSelect } from 'naive-ui';
import { useGuideSelectMenus } from '../guide-select-menus';
/** 列表筛选字段，独立展示每个条件。 @author chenjd @created 2026-11-07 16:00:00 */
interface Field {
  /** 条件键。 */ key: string;
  /** 字段名称。 */ label: string;
  /** 可选值。 */ options: { label: string; value: string }[];
}
const props = defineProps<{ modelValue: Record<string, string>; search: string; label: string; placeholder: string; fields: Field[]; entries?: EntryView[] }>();
const { renderCatalogLabel } = useCatalogSelectLabel(() => props.entries || []);
const emit = defineEmits<{ 'update:modelValue': [value: Record<string, string>]; 'update:search': [value: string] }>();
const { selectMenu, closeSelectMenus } = useGuideSelectMenus();
/** 清空查询条件并关闭菜单。 */
const clear = (): void => { closeSelectMenus(); emit('update:modelValue', {}); emit('update:search', ''); };
</script>
<template>
  <section class="record-filters" :aria-label="label">
    <header><strong>{{ label }}</strong><n-button text size="small" :disabled="!search && !Object.values(modelValue).some(Boolean)" @click="clear">清空筛选</n-button></header>
    <div class="record-filter-fields">
      <label><span>关键词</span><n-input :value="search" :placeholder="placeholder" clearable aria-label="筛选关键词" @update:value="emit('update:search', $event)" /></label>
      <label v-for="field in fields" :key="field.key"><span>{{ field.label }}</span><n-select v-bind="selectMenu(field.key)" :value="modelValue[field.key] || null" :options="field.options" :render-label="renderCatalogLabel" filterable clearable :placeholder="'全部' + field.label" :aria-label="field.label + '筛选'" @update:value="emit('update:modelValue', { ...props.modelValue, [field.key]: $event || '' })" /></label>
    </div>
  </section>
</template>
<style scoped>
.record-filters { flex-shrink: 0; padding: 14px; margin-bottom: 0; border: 1px solid var(--border); border-radius: 10px; background: var(--subtle); }
.record-filters header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; font-size: 12px; color: var(--muted); }
.record-filter-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 180px), 1fr)); gap: 12px; }
.record-filter-fields label { display: flex; flex-direction: column; gap: 6px; min-width: 0; font-size: 12px; color: var(--muted); }
</style>
