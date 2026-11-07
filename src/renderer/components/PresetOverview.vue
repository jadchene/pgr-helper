<script setup lang="ts">
import DictionaryBadge from './DictionaryBadge.vue';
import { computed, ref, watch } from 'vue';
import type { CatalogEntry, EntryView } from '../../shared/types';
import type { PresetDocument } from '../../shared/presets';

import EntryArtwork from './EntryArtwork.vue';
import LoadoutItem from './LoadoutItem.vue';
import ResonanceSummary from './ResonanceSummary.vue';

const props = defineProps<{ preset: PresetDocument; entries: EntryView[]; embedded?: boolean }>();
const byId = computed(() => new Map(props.entries.map(entry => [entry.id, entry])));
const memories = computed(() => props.preset.kind === 'character' ? props.preset.memorySets : props.preset.kind === 'memory' ? [{ ...props.preset.memory, id: 'memory', name: '意识搭配' }] : []);
const selectedMemoryId = ref('');
watch(() => props.preset.id, () => { selectedMemoryId.value = ''; });
const memory = computed(() => memories.value.find(item => item.id === selectedMemoryId.value) || memories.value[0]);
/** 优先使用来源图片，缺失时沿用浅色分类占位图。 */
const artwork = (id: string, category: CatalogEntry['category']) => byId.value.get(id) || { name: '未配置', image: '', category };
const pet = computed(() => props.preset.kind !== 'memory' ? props.preset.pet : undefined);
const evolutionLabel = computed(() => {
  const value = props.preset;
  return value.kind === 'character' ? byId.value.get(value.characterId)?.guideOptions?.evolutionStages?.find(item => item.id === value.evolutionId)?.label || '未配置进化阶段' : '';
});
const harmonizationLabel = computed(() => {
  const value = props.preset;
  return value.kind === 'character' && value.harmonizationLevel ? byId.value.get(value.weaponId)?.guideOptions?.harmonizationLevels?.find(item => item.level === value.harmonizationLevel)?.label || '原阶段不可用' : '未配置';
});
const qualityLabel = computed(() => {
  const value = pet.value;
  return value ? byId.value.get(value.petId)?.guideOptions?.partnerQualities?.find(item => item.quality === value.quality)?.label || '未配置' : '';
});
/** 保留失效资料的提示，空配置不伪装成已选择。 */
const name = (id: string): string => id ? byId.value.get(id)?.name || '资料暂不可用' : '未配置';
</script>

<template>
  <div class="preset-overview" :class="{ embedded, 'character-overview': preset.kind === 'character' }" aria-label="预设总览">
    <header v-if="preset.kind === 'character'" class="character-banner">
      <EntryArtwork :entry="artwork(preset.characterId, 'character')" eager />
      <div><span class="overline">机体配置</span><h1>{{ name(preset.characterId) }}</h1><p><DictionaryBadge :entries="entries" :value="byId.get(preset.characterId)?.element" type="属性" /> <DictionaryBadge :entries="entries" :value="byId.get(preset.characterId)?.profession" type="职业" /></p></div>
      <div class="rank"><span>进化品级</span><strong>{{ evolutionLabel }}</strong></div>
    </header>
    <div v-if="preset.kind !== 'memory'" class="equipment-grid" :class="{ single: preset.kind === 'pet' }">
      <section v-if="preset.kind === 'character'" class="equipment-panel">
        <div class="equipment-heading"><LoadoutItem :entry="byId.get(preset.weaponId)" :size="46" /><div><span class="overline">武器</span><h2>{{ name(preset.weaponId) }}</h2></div><span class="badge">{{ harmonizationLabel === '未配置' ? '无谐振' : harmonizationLabel }}</span></div>
        <div class="loadout-icon-row" aria-label="武器共鸣"><LoadoutItem v-for="(id, index) in preset.weaponResonanceIds" :key="index" :entry="byId.get(id)" :extra="`武器共鸣槽 ${index + 1}`" /></div>
      </section>
      <section v-if="pet" class="equipment-panel"><h2 v-if="embedded" class="embedded-title">{{ preset.name }}</h2>
        <div class="equipment-heading"><LoadoutItem :entry="byId.get(pet.petId)" :size="46" /><div><span class="overline">辅助机</span><h2>{{ name(pet.petId) }}</h2></div><span v-if="pet.petId" class="badge">{{ qualityLabel }}</span></div>
        <template v-if="pet.petId"><div class="skill-row"><span class="overline">主动</span><LoadoutItem v-if="pet.activeSkillId" :entry="byId.get(pet.petId)" :skill-id="pet.activeSkillId" /><span v-else>未配置</span></div><div class="skill-row"><span class="overline">被动</span><div class="loadout-icon-row"><LoadoutItem v-for="id in pet.passiveSkillIds" :key="id" :entry="byId.get(pet.petId)" :skill-id="id" /><span v-if="!pet.passiveSkillIds.length">未配置</span></div></div></template>
      </section>
    </div>
    <section v-if="memory" class="memory-panel">
      <header class="section-heading"><h2>{{ embedded ? preset.name : preset.kind === 'character' ? '意识方案' : '意识搭配' }}</h2><span class="overline">{{ preset.kind === 'character' ? memories.length + ' 套方案' : '通用预设' }}</span></header>
      <nav v-if="memories.length > 1" class="memory-tabs" aria-label="查看意识方案"><button v-for="item in memories" :key="item.id" :aria-pressed="memory.id === item.id" @click="selectedMemoryId = item.id">{{ item.name }}</button></nav>
      <div class="preset-memory-overview">
        <h3 v-if="preset.kind === 'character'" class="memory-title">{{ memory.name }}</h3>
        <div class="compact-memory">
          <div class="compact-memory-items"><LoadoutItem v-for="(item, index) in memory.memories" :key="index" :entry="byId.get(item.memoryId)" :count="item.count" :size="42" :extra="'基础意识 ' + item.count + ' 件'" /><span v-if="!memory.memories.length" class="overline">尚未配置意识</span><span class="memory-divider" /><span class="overline">谐振</span><LoadoutItem v-if="memory.harmonizationMemoryId" :entry="byId.get(memory.harmonizationMemoryId)" :size="32" /><span v-else class="overline">未配置</span></div>
          <ResonanceSummary :resonance="memory.resonance" :entries="entries" />
        </div>
      </div>
    </section>
    <section v-if="preset.notes && !embedded" class="notes-panel"><h2>备注</h2><p class="rich-text">{{ preset.notes }}</p></section>
  </div>
</template>

<style scoped>
.preset-overview { display: flex; flex-direction: column; gap: 12px; padding: 4px 4px 20px; }
h1, h2, h3, p { margin: 0; }
h1 { font-size: 25px; margin: 5px 0 8px; }
h2 { font-size: 17px; }
h3 { font-size: 13px; }
.overline { color: var(--muted); font-size: 12px; }
.character-banner { display: flex; align-items: center; gap: 20px; padding: 14px 18px; background: var(--accent-soft); border: 1px solid var(--border); border-radius: 12px; }
.character-banner > .entry-artwork { width: 68px; height: 68px; flex: 0 0 68px; border-radius: 10px; }
.character-banner p { color: var(--muted); font-size: 13px; }
.rank { margin-left: auto; text-align: right; display: flex; flex-direction: column; gap: 6px; flex-shrink: 0; }
.rank span { font-size: 12px; color: var(--muted); }
.rank strong { font-size: 27px; color: var(--accent-text); }
.equipment-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.equipment-grid.single { grid-template-columns: 1fr; }
.equipment-panel, .memory-panel, .notes-panel { min-width: 0; padding: 14px 16px; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); }
.equipment-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 10px; }
.equipment-heading > .entry-artwork { width: 62px; height: 62px; flex: 0 0 62px; border-radius: 8px; }
.equipment-heading h2 { margin-top: 4px; overflow-wrap: anywhere; }
.badge { margin-left: auto; padding: 5px 10px; border-radius: 6px; font-size: 12px; background: var(--accent-soft); color: var(--accent-text); white-space: nowrap; }
.weapon-slots { display: flex; flex-direction: column; gap: 9px; }
.weapon-slots > div { display: flex; align-items: center; gap: 10px; font-size: 13px; }
.slot-number { display: grid; place-items: center; width: 23px; height: 23px; background: var(--accent-soft); color: var(--accent-text); border-radius: 5px; font-size: 11px; }
.skill-row { display: flex; gap: 12px; align-items: center; margin-top: 8px; font-size: 13px; }
.skill-row > .overline { flex: 0 0 28px; }
.chips { display: flex; flex-wrap: wrap; gap: 6px; }
.chips > span { background: var(--subtle); border: 1px solid var(--border); padding: 4px 8px; border-radius: 5px; font-size: 12px; }
.section-heading { display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px; }
.memory-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 10px; }
.memory-tabs button { cursor: default; border: 1px solid var(--border); border-radius: 7px; padding: 8px 14px; background: var(--surface); color: var(--text); }
.memory-tabs button[aria-pressed="true"] { background: var(--accent-soft); border-color: var(--accent); color: var(--accent-text); }
.memory-title { color: var(--muted); margin-bottom: 8px; }
.memory-layout { display: grid; grid-template-columns: minmax(200px, 0.8fr) minmax(0, 1.5fr); gap: 24px; }
.memory-sets { display: flex; flex-direction: column; gap: 12px; }
.memory-item { display: flex; align-items: center; gap: 12px; }
.memory-item > .entry-artwork { width: 58px; height: 66px; flex: 0 0 58px; border-radius: 7px; }
.memory-item strong { font-size: 14px; }
.piece-count { display: block; margin-top: 6px; color: var(--accent-text); font-size: 12px; }
.harmonization-memory { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; padding-top: 12px; border-top: 1px solid var(--border); font-size: 12px; }
.harmonization-memory .entry-artwork { width: 30px; height: 34px; }
.resonance-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
.resonance-side { border-left: 1px solid var(--border); padding-left: 18px; }
.resonance-side h3 { color: var(--muted); margin-bottom: 14px; }
.resonance-item { display: flex; gap: 10px; align-items: baseline; justify-content: space-between; font-size: 13px; line-height: 1.8; margin-bottom: 8px; }
.resonance-item strong { color: var(--accent-text); white-space: nowrap; }
.notes-panel p { margin-top: 12px; font-size: 13px; }
@media (max-width: 1100px) { .memory-layout { grid-template-columns: 1fr; } .resonance-grid { border-top: 1px solid var(--border); padding-top: 16px; } .resonance-side:first-child { padding-left: 0; border-left: 0; } }
@media (max-width: 760px) { .equipment-grid { grid-template-columns: 1fr; } .character-banner { gap: 12px; padding: 16px; } h1 { font-size: 20px; } .rank strong { font-size: 20px; } }
.compact-memory { display: flex; flex-direction: column; gap: 12px; }
.compact-memory-items { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.memory-divider { height: 24px; border-left: 1px solid var(--border); }
.character-overview > .memory-panel { width: 440px; max-width: 100%; align-self: flex-start; }
.embedded { padding: 0; gap: 0; }
.embedded-title { margin-bottom: 12px; }
.embedded .equipment-panel, .embedded .memory-panel { height: 100%; }
.embedded .equipment-grid { height: 100%; }
</style>
