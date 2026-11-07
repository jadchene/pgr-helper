<script setup lang="ts">
import type { CatalogEntry } from '../../shared/types';
import EntryArtwork from './EntryArtwork.vue';
const props = defineProps<{ entry: CatalogEntry; label: string }>();
</script>
<template>
  <span class="catalog-select-label" :data-option-entry="entry.id" :data-dictionary-type="entry.catalog?.facets.dictionaryType?.[0]">
    <EntryArtwork :entry="entry" small eager />
    <span class="catalog-select-name">{{ label }}</span>
    <small v-if="entry.category === 'weapon'">{{ [entry.rarity, entry.attributes['武器类型']].filter(Boolean).join(' · ') }}</small>
  </span>
</template>
<style scoped>
.catalog-select-label { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; vertical-align: middle; min-width: 0; line-height: 24px; }
.catalog-select-label .entry-artwork { width: 24px; height: 24px; flex: none; border-radius: 4px; }
.catalog-select-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.catalog-select-label small { color: var(--muted); font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.catalog-select-label :deep(.artwork-resonance img) { filter: brightness(.5); }
[data-dictionary-type="职业"] :deep(img) { filter: brightness(.55); }
</style>

<style>
.catalog-select-label[data-dictionary-type="职业"] .entry-artwork img { filter: brightness(.55); }
:root[data-theme='dark'] .catalog-select-label[data-dictionary-type="职业"] img { filter: none; }
:root[data-theme='dark'] .catalog-select-label[data-dictionary-type="属性"] img { filter: brightness(0) invert(1); }
:root[data-theme='dark'] .catalog-select-label .artwork-resonance img { filter: none; }
</style>
