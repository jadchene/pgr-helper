<script setup lang="ts">
import { computed } from 'vue';
import type { CatalogEntry } from '../../shared/types';
import EntryArtwork from './EntryArtwork.vue';
const props = defineProps<{ entries: readonly CatalogEntry[]; value?: string; type: string }>();
const entry = computed(() => props.entries.find(entry => entry.category === 'dictionary' && entry.image && entry.catalog?.facets.dictionaryType?.includes(props.type) && (entry.name === props.value || entry.aliases.includes(props.value || ''))));
</script>
<template><span v-if="value" class="dictionary-badge" :data-dictionary-type="type"><EntryArtwork v-if="entry" :entry="entry" small /><span>{{ value }}</span></span></template>
<style scoped>
.dictionary-badge { display: inline-flex; align-items: center; gap: 4px; vertical-align: middle; }
.dictionary-badge .entry-artwork { width: 18px; height: 18px; flex: none; background: transparent; border: none; border-radius: 0; }
.dictionary-badge :deep(img) { object-fit: contain; }
[data-dictionary-type="职业"] :deep(img) { filter: brightness(.55); }
</style>

<style>
.dictionary-badge[data-dictionary-type="职业"] .entry-artwork img { filter: brightness(.55); }
:root[data-theme='dark'] .dictionary-badge[data-dictionary-type="职业"] img { filter: none; }
:root[data-theme='dark'] .dictionary-badge[data-dictionary-type="属性"] img { filter: brightness(0) invert(1); }
</style>
