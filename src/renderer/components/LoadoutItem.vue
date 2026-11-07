<script setup lang="ts">
import { computed, ref } from 'vue';
import { NPopover } from 'naive-ui';
import type { CatalogEntry } from '../../shared/types';
import EntryArtwork from './EntryArtwork.vue';

const props = defineProps<{ entry?: CatalogEntry; skillId?: string; label?: string; extra?: string; textOnly?: boolean; count?: number; size?: number; fallback?: string }>();
const shown = ref(false);
const skill = computed(() => props.skillId ? props.entry?.sections.find(section => section.skill?.id === props.skillId) : undefined);
const title = computed(() => props.label || skill.value?.title || (props.skillId ? '原技能暂不可用' : props.entry?.name || '未配置'));
const artwork = computed(() => ({ name: title.value, image: props.skillId ? skill.value?.skill?.image || '' : props.entry?.image || '', category: props.skillId ? 'resonance' as const : props.entry?.category || 'resonance' as const }));
const sections = computed(() => props.skillId ? skill.value ? [skill.value] : [] : props.entry?.sections || []);
</script>

<template>
  <n-popover v-model:show="shown" trigger="hover" :delay="180" placement="top" :show-arrow="false" :width="350">
    <template #trigger>
      <span class="loadout-item" :class="{ 'text-only': textOnly }" tabindex="0" :aria-label="title" :data-loadout-item="skillId || entry?.id || label || 'empty'" @focus="shown = true" @blur="shown = false">
        <slot><template v-if="textOnly">{{ title }}<strong v-if="count !== undefined"> × {{ count }}</strong></template><template v-else><EntryArtwork :entry="artwork" small eager :style="{ width: `${size || 36}px`, height: `${size || 36}px` }" /><b v-if="count !== undefined" class="item-count">{{ count }}</b></template></slot>
      </span>
    </template>
    <div class="loadout-popover" role="region" :aria-label="`${title}详情`">
      <header><EntryArtwork :entry="artwork" small eager /><div><strong>{{ title }}</strong><p v-if="skill?.skill">{{ skill.skill.typeName }}<template v-if="skill.skill.level"> · Lv.{{ skill.skill.level }}</template><template v-if="skill.skill.element"> · {{ skill.skill.element.name }}</template></p></div></header>
      <p v-if="extra" class="loadout-extra">{{ extra }}</p>
      <p v-if="!skillId && entry?.description">{{ entry.description }}</p>
      <section v-for="(section, index) in sections" :key="index"><h4 v-if="!skillId">{{ section.title }}</h4><p>{{ section.body }}</p></section>
      <p v-if="!entry">{{ fallback || (label ? '当前资料中没有该条目的详细说明。' : '尚未配置') }}</p><p v-else-if="skillId && !skill">当前资料中没有该技能，请检查资料版本。</p>
    </div>
  </n-popover>
</template>

<style scoped>
.loadout-item { display: inline-flex; position: relative; vertical-align: middle; align-items: center; gap: 4px; flex: none; max-width: 100%; border-radius: 6px; }
.loadout-item:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.loadout-item:hover { box-shadow: 0 0 0 1px var(--accent); }
.loadout-item .entry-artwork { border-radius: 6px; }
.text-only { font-size: 12px; flex-wrap: wrap; }
.text-only strong { color: var(--accent-text); white-space: nowrap; }
.item-count { position: absolute; right: -4px; bottom: -4px; min-width: 17px; padding: 1px 4px; text-align: center; color: var(--accent-text); border: 1px solid var(--border); background: var(--surface); border-radius: 4px; font-size: 10px; }
.loadout-popover { max-height: min(420px, 65vh); overflow: auto; font-size: 12px; line-height: 1.8; color: var(--text); max-width: calc(100vw - 48px); }
.loadout-popover header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.loadout-popover header .entry-artwork { width: 38px; height: 38px; flex: none; }
.loadout-popover header strong { font-size: 14px; }
.loadout-popover header p { color: var(--muted); }
.loadout-popover p { white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }
.loadout-popover section { margin-top: 12px; }
.loadout-popover h4 { margin: 0 0 4px; }
.loadout-extra { background: var(--subtle); padding: 6px 8px; border-radius: 5px; margin-bottom: 10px !important; }
</style>
