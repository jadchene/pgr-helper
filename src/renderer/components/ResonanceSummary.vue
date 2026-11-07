<script setup lang="ts">
import { computed } from 'vue';
import type { CatalogEntry } from '../../shared/types';
import type { PresetResonance } from '../../shared/presets';
import { summarizeResonances } from '../loadout-summary';
import LoadoutItem from './LoadoutItem.vue';
const props = defineProps<{ resonance: { upper: PresetResonance[]; lower: PresetResonance[] }; entries: CatalogEntry[] }>();
const items = computed(() => summarizeResonances(props.resonance, props.entries));
</script>
<template><div class="resonance-summary" aria-label="意识共鸣"><span class="summary-label">共鸣</span><div><LoadoutItem v-for="item in items" :key="item.key" :entry="item.entry" :label="item.label" :count="item.count" :fallback="item.kind === 'skillType' ? '通用技能共鸣，引入机体时匹配该机体对应的实际技能。' : undefined" :extra="`上位 ${item.upper} 次 · 下位 ${item.lower} 次`" /><span v-if="!items.length" class="summary-label">未配置</span></div></div></template>
<style scoped>
.resonance-summary { display: flex; align-items: center; gap: 10px; font-size: 12px; line-height: 1.7; }
.summary-label { color: var(--muted); flex: none; }
.resonance-summary > div { display: flex; flex-wrap: wrap; gap: 8px 12px; min-width: 0; }
</style>
