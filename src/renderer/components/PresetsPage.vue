<script setup lang="ts">
import DictionaryBadge from './DictionaryBadge.vue';
import { computed, onUnmounted, ref, watch } from 'vue';
import { NButton, NInput, NAlert, useDialog, useMessage } from 'naive-ui';
import type { EntryView } from '../../shared/types';
import { createPreset, createPresetMemorySet, type PresetDocument, type PresetRecord } from '../../shared/presets';
import { createGuideMember, type GuideTeam } from '../../shared/guides';
import { presetCharacterDefaults, updateCharacterPresetFromMember } from '../preset-config';
import { compareCatalogEntries } from '../catalog-query';
import { matchesGuideFilters, type GuideFilters } from '../guide-team';
import GuideChoiceFilter from './GuideChoiceFilter.vue';
import RecordFilters from './RecordFilters.vue';
import GuideTeamEditor from './GuideTeamEditor.vue';
import PresetMemoryEditor from './PresetMemoryEditor.vue';
import PresetOverview from './PresetOverview.vue';
import EntryArtwork from './EntryArtwork.vue';
import './guides.css';

const props = defineProps<{ entries: EntryView[]; presets: PresetRecord[] }>();
const emit = defineEmits<{ refresh: []; dirty: [value: boolean]; pending: [value: boolean] }>();
const dialog = useDialog();
const message = useMessage();
const draft = ref<PresetDocument | null>(null);
const viewed = ref<PresetDocument | null>(null);
const viewedRecord = ref<PresetRecord | undefined>();
const original = ref('');
const revision = ref<number | null>(null);
const activeSet = ref('');
const pending = ref(false);
const failure = ref('');
const search = ref('');
const facets = ref<GuideFilters>({});
const generalFilters = ref<Record<string, string>>({});
/** 类型改变时清理不适用条件；选择具体装备时同步切到对应预设类型。 */
const updateGeneralFilters = (next: Record<string, string>): void => {
  const previous = generalFilters.value;
  const value = { ...next };
  if (value.memory && value.memory !== previous.memory) value.kind = 'memory';
  else if (value.pet && value.pet !== previous.pet) value.kind = 'pet';
  if (value.kind === 'memory') delete value.pet;
  if (value.kind === 'pet') delete value.memory;
  generalFilters.value = value;
};
const generalFields = computed(() => [
  { key: 'kind', label: '预设类型', options: [{ value: 'memory', label: '意识预设' }, { value: 'pet', label: '辅助机预设' }] },
  { key: 'memory', label: '包含意识', options: props.entries.filter(entry => entry.category === 'memory').sort(compareCatalogEntries).map(entry => ({ value: entry.id, label: entry.name })) },
  { key: 'pet', label: '辅助机', options: props.entries.filter(entry => entry.category === 'pet').sort(compareCatalogEntries).map(entry => ({ value: entry.id, label: entry.name })) },
].filter(field => field.key !== 'memory' || generalFilters.value.kind !== 'pet').filter(field => field.key !== 'pet' || generalFilters.value.kind !== 'memory'));
const generalKinds = computed(() => (['memory', 'pet'] as const).filter(kind => !generalFilters.value.kind || generalFilters.value.kind === kind));
const trash = ref(false);
const tab = ref<'character' | 'general'>('character');
const byId = computed(() => new Map(props.entries.map(entry => [entry.id, entry])));
const dirty = computed(() => !!draft.value && JSON.stringify(draft.value) !== original.value);
watch(dirty, value => emit('dirty', value));
watch(pending, value => emit('pending', value));
onUnmounted(() => { emit('dirty', false); emit('pending', false); });
const characterRecords = computed(() => new Map(props.presets.filter(item => item.kind === 'character' && !item.hidden).map(item => [item.kind === 'character' ? item.characterId : '', item])));
const characters = computed(() => props.entries.filter(entry => entry.category === 'character' && !entry.hidden && !entry.retired
  && `${entry.name} ${entry.aliases.join(' ')}`.toLowerCase().includes(search.value.trim().toLowerCase())
  && matchesGuideFilters(entry, facets.value)).sort(compareCatalogEntries));
const visibleRecords = computed(() => props.presets.filter(item => item.hidden === trash.value
  && (item.name + ' ' + item.notes).toLowerCase().includes(search.value.trim().toLowerCase())
  && (trash.value || ((!generalFilters.value.kind || item.kind === generalFilters.value.kind)
    && (!generalFilters.value.memory || item.kind === 'memory' && (item.memory.memories.some(memory => memory.memoryId === generalFilters.value.memory) || item.memory.harmonizationMemoryId === generalFilters.value.memory))
    && (!generalFilters.value.pet || item.kind === 'pet' && item.pet.petId === generalFilters.value.pet)))));
const currentSet = computed(() => draft.value?.kind === 'character' ? draft.value.memorySets.find(item => item.id === activeSet.value) : undefined);
const currentMemory = computed(() => draft.value?.kind === 'memory' ? draft.value.memory : currentSet.value);
const editorTitle = computed(() => draft.value?.kind === 'character' ? byId.value.get(draft.value.characterId)?.name || draft.value.name : draft.value?.kind === 'memory' ? '意识预设' : '辅助机预设');
/** 编辑器只接收当前用途字段，不携带预设之外的配置。 */
const team = computed<GuideTeam>(() => {
  const member = createGuideMember('blue', 'preset-editor');
  const value = draft.value;
  if (value?.kind === 'character') Object.assign(member, { characterId: value.characterId, evolutionId: value.evolutionId, weaponId: value.weaponId, weaponResonanceIds: value.weaponResonanceIds,
    harmonization: { level: value.harmonizationLevel, memoryId: currentSet.value?.harmonizationMemoryId || '' } });
  if (value && value.kind !== 'memory') member.pet = value.pet;
  if (currentMemory.value) {
    member.memories = currentMemory.value.memories;
    for (const side of ['upper', 'lower'] as const) member.memoryResonance[side] = currentMemory.value.resonance[side].filter(item => item.kind === 'entry').map(item => ({ resonanceId: item.value, count: item.count }));
  }
  return { members: [member], starterMemberId: member.id, captainMemberId: member.id, effectIds: [] };
});
/** 将各编辑区域写回相应类型，辅助机与意识预设互不覆盖。 */
const updateTeam = (value: GuideTeam): void => {
  const document = draft.value;
  if (!document) return;
  const member = value.members[0];
  if (document.kind === 'character') {
    updateCharacterPresetFromMember(document, member, activeSet.value, props.entries);
  } else if (document.kind === 'pet') document.pet = member.pet;
  else document.memory.memories = member.memories;
};
/** 打开现有记录或新建独立通用配置。 */
const edit = (kind: PresetDocument['kind'], record?: PresetRecord): void => {
  if (!record || kind !== 'character') { viewed.value = null; viewedRecord.value = record; }
  if (record) {
    const { hidden: _h, revision: _r, createdAt: _c, updatedAt: _u, ...document } = record;
    draft.value = JSON.parse(JSON.stringify(document));
  } else draft.value = createPreset(kind);
  revision.value = record?.revision || null;
  original.value = JSON.stringify(draft.value);
  activeSet.value = draft.value?.kind === 'character' ? draft.value.memorySets[0]?.id || '' : '';
  failure.value = '';
};
/** 列表默认只读；编辑使用独立副本，取消不会污染总览。 */
const viewRecord = (record: PresetRecord): void => {
  viewedRecord.value = record;
  viewed.value = JSON.parse(JSON.stringify(record));
};
const editViewed = (): void => {
  if (!viewed.value) return;
  if (viewedRecord.value) edit(viewed.value.kind, viewedRecord.value);
  else {
    draft.value = JSON.parse(JSON.stringify(viewed.value));
    revision.value = null;
    original.value = JSON.stringify(draft.value);
    activeSet.value = draft.value?.kind === 'character' ? draft.value.memorySets[0].id : '';
    failure.value = '';
  }
};
/** 从机体卡片进入只读总览，每个机体只有一份配置。 */
const openCharacter = (entry: EntryView): void => {
  const existing = characterRecords.value.get(entry.id) || props.presets.find(item => item.kind === 'character' && item.characterId === entry.id);
  if (existing) { viewRecord(existing); return; }
  const value = createPreset('character');
  const defaults = presetCharacterDefaults(entry.id, props.entries);
  Object.assign(value, { id: `preset:character-${entry.id.replaceAll(':', '-')}`, name: entry.name, characterId: entry.id,
    evolutionId: entry.guideOptions?.evolutionStages?.[0]?.id || '', weaponId: defaults.weaponId });
  value.pet.petId = defaults.petId;
  value.pet.quality = byId.value.get(defaults.petId)?.guideOptions?.partnerQualities?.[0]?.quality || 0;
  viewed.value = value;
  viewedRecord.value = undefined;
  revision.value = null;
  original.value = JSON.stringify(value);
  activeSet.value = value.memorySets[0].id;
  failure.value = '';
};
/** 返回时保护尚未保存的编辑。 */
const back = (): void => {
  if (pending.value) return;
  const leave = () => { draft.value = null; };
  if (dirty.value) dialog.warning({ title: '放弃未保存的预设修改？', positiveText: '放弃修改', negativeText: '继续编辑', onPositiveClick: leave });
  else leave();
};
/** 保存成功返回只读总览，失败保留当前草稿。 */
const save = async (): Promise<void> => {
  if (!draft.value || pending.value) return;
  pending.value = true; failure.value = '';
  try {
    const saved = await window.desktop.savePreset(JSON.parse(JSON.stringify(draft.value)), revision.value);
    if (saved.kind === 'character') viewRecord(saved);
    else { viewed.value = null; viewedRecord.value = undefined; }
    original.value = JSON.stringify(draft.value); draft.value = null; emit('refresh'); message.success('预设已保存。');
  } catch (error) { failure.value = error instanceof Error ? error.message : String(error); }
  finally { pending.value = false; }
};
/** 通用预设回收与恢复。 */
const hide = async (record: PresetRecord): Promise<void> => {
  if (pending.value) return;
  pending.value = true;
  try { await window.desktop.setPresetHidden(record.id, !record.hidden, record.revision); draft.value = null; viewed.value = null; viewedRecord.value = undefined; emit('refresh'); }
  catch (error) { message.error(String(error)); }
  finally { pending.value = false; }
};
/** 回收前确认，未保存的修改不影响已保存记录。 */
const recycleViewed = (): void => {
  const record = viewedRecord.value;
  if (!record) return;
  dialog.warning({ title: '将预设移至回收站？', content: '已保存的配置可在回收站恢复，未保存的修改将放弃。', positiveText: '移至回收站', negativeText: '取消', onPositiveClick: () => hide(record) });
};
/** 机体内增加独立意识方案。 */
const addSet = (): void => {
  if (draft.value?.kind !== 'character') return;
  const item = createPresetMemorySet(`意识方案 ${draft.value.memorySets.length + 1}`);
  draft.value.memorySets.push(item); activeSet.value = item.id;
};
/** 删除当前机体中的一套意识方案。 */
const removeSet = (): void => {
  if (draft.value?.kind !== 'character' || draft.value.memorySets.length < 2 || !currentSet.value) return;
  const id = activeSet.value;
  dialog.warning({ title: `删除“${currentSet.value.name}”？`, positiveText: '删除方案', negativeText: '取消', onPositiveClick: () => {
    if (draft.value?.kind !== 'character') return;
    draft.value.memorySets = draft.value.memorySets.filter(item => item.id !== id);
    activeSet.value = draft.value.memorySets[0].id;
  } });
};
/** 列表直接显示配置摘要。 */
const summary = (record: PresetRecord): string => record.kind === 'memory'
  ? record.memory.memories.map(item => `${byId.value.get(item.memoryId)?.name || '未选择'} × ${item.count}`).join(' + ') || '尚未配置意识'
  : record.kind === 'pet' ? `${byId.value.get(record.pet.petId)?.name || '未选择辅助机'} · ${byId.value.get(record.pet.petId)?.guideOptions?.partnerQualities?.find(item => item.quality === record.pet.quality)?.label || '未选品级'}` : `${record.memorySets.length} 套意识方案`;
</script>

<template>
  <section class="page-layout presets-page">
    <template v-if="!draft && !viewed">
      <header class="guide-page-header"><div><div class="eyebrow">配装工作台</div><h1>配置预设</h1><p>查看机体配装，保存常用意识与辅助机方案。</p></div><n-button @click="trash = !trash">{{ trash ? '返回预设' : '预设回收站' }}</n-button></header>
      <div v-if="!trash" class="preset-tabs" role="tablist" aria-label="预设分类"><button role="tab" :aria-selected="tab === 'character'" @click="tab = 'character'; search = ''">机体预设</button><button role="tab" :aria-selected="tab === 'general'" @click="tab = 'general'; search = ''">通用预设</button></div>
      <GuideChoiceFilter v-if="tab === 'character' && !trash" v-model="facets" :entries="entries" category="character" label="机体" :has-search="!!search" @clear="search = ''">
        <template #before-fields><div class="preset-search-field"><span>名称／别名</span><n-input v-model:value="search" placeholder="搜索机体名称或别名" clearable /></div></template>
      </GuideChoiceFilter>
      <RecordFilters :entries="entries" v-else :model-value="generalFilters" @update:model-value="updateGeneralFilters" v-model:search="search" :label="trash ? '回收站筛选' : '通用预设筛选'" placeholder="预设名称或备注" :fields="trash ? [] : generalFields" />
      <div class="guide-page-scroll">
        <template v-if="trash"><div class="guide-list"><article v-for="item in visibleRecords" :key="item.id" class="guide-list-card"><h2>{{ item.name }}</h2><p>{{ summary(item) }}</p><n-button :disabled="pending" @click="hide(item)">恢复</n-button></article></div><p v-if="!visibleRecords.length" class="guide-empty">回收站为空</p></template>
        <template v-else-if="tab === 'character'">
          <div class="preset-character-grid"><button v-for="entry in characters" :key="entry.id" class="preset-character-card" :data-character-id="entry.id" @click="openCharacter(entry)"><EntryArtwork :entry="entry" /><strong>{{ entry.name }}</strong><span><DictionaryBadge :entries="entries" :value="entry.element" type="属性" /> · <DictionaryBadge :entries="entries" :value="entry.profession" type="职业" /></span><small>{{ characterRecords.has(entry.id) ? '查看配置' : '尚未配置 · 查看总览' }}</small></button></div>
          <p v-if="!characters.length" class="guide-empty">{{ entries.length ? '没有符合筛选的机体' : '请先同步基础资料' }}</p>
        </template>
        <template v-else>
          <section v-for="kind in generalKinds" :key="kind" class="preset-direct-section" :data-preset-kind="kind">
            <header><div><h2>{{ kind === 'memory' ? '意识预设' : '辅助机预设' }}</h2><p>{{ kind === 'memory' ? '独立保存意识搭配、共鸣和谐振意识' : '独立保存辅助机品级和携带技能' }}</p></div><n-button type="primary" @click="edit(kind)">新增{{ kind === 'memory' ? '意识' : '辅助机' }}预设</n-button></header>
            <div class="preset-general-grid"><article v-for="item in visibleRecords.filter(item => item.kind === kind)" :key="item.id" class="preset-inline-config" :data-preset-id="item.id" role="button" tabindex="0" :aria-label="`编辑${item.name}`" @click="edit(kind, item)" @keydown.enter.self="edit(kind, item)" @keydown.space.self.prevent="edit(kind, item)"><PresetOverview :preset="item" :entries="entries" embedded /></article></div>
            <p v-if="!visibleRecords.some(item => item.kind === kind)" class="preset-empty">没有符合条件的{{ kind === 'memory' ? '意识' : '辅助机' }}预设。</p>
          </section>
        </template>
      </div>
    </template>
    <template v-else-if="draft">
      <header class="guide-editor-toolbar"><n-button @click="back">{{ viewed ? '返回总览' : '返回通用预设' }}</n-button><strong>{{ editorTitle }}</strong><n-button v-if="viewedRecord" quaternary type="error" :disabled="pending" @click="recycleViewed">移至回收站</n-button><n-button type="primary" :loading="pending" @click="save">保存预设</n-button></header>
      <div class="guide-page-scroll" :inert="pending || undefined">
        <n-alert v-if="failure" type="error">{{ failure }}</n-alert>
        <div v-if="draft.kind !== 'character'" class="guide-form-field"><span>{{ editorTitle }}名称</span><n-input v-model:value="draft.name" maxlength="200" placeholder="填写预设名称" /></div>
        <GuideTeamEditor :key="draft.id" :model-value="team" :entries="entries" :preset-mode="draft.kind" :memory-set-id="activeSet" :disabled="pending" @update:model-value="updateTeam">
          <template v-if="draft.kind === 'character'" #memory-plans>
            <p class="guide-config-help">每套方案单独保存意识搭配、上下位共鸣和谐振意识；机体品级、武器及辅助机共用。</p>
            <div class="guide-list-toolbar"><n-button v-for="item in draft.memorySets" :key="item.id" :type="item.id === activeSet ? 'primary' : 'default'" @click="activeSet = item.id">{{ item.name }}</n-button><n-button :disabled="draft.memorySets.length >= 30" @click="addSet">添加意识方案</n-button></div>
            <div v-if="currentSet" class="preset-plan-name"><div class="guide-form-field"><span>当前意识方案名称</span><n-input v-model:value="currentSet.name" maxlength="200" :input-props="{ 'aria-label': '当前意识方案名称' }" /></div><n-button v-if="draft.memorySets.length > 1" @click="removeSet">删除此方案</n-button></div>
          </template>
        </GuideTeamEditor>
        <PresetMemoryEditor v-if="draft.kind === 'memory'" :model-value="draft.memory" :entries="entries" @update:model-value="value => { if (draft?.kind === 'memory') draft.memory = value; }" />
        <div class="guide-form-field"><span>备注</span><n-input v-model:value="draft.notes" type="textarea" maxlength="10000" /></div>
      </div>
    </template>
    <template v-else-if="viewed">
      <header class="guide-detail-toolbar"><n-button @click="viewed = null; viewedRecord = undefined">返回{{ viewed.kind === 'character' ? '机体列表' : '通用预设' }}</n-button><strong>{{ viewed.name }} · 配置总览</strong><n-button v-if="viewedRecord?.hidden" type="primary" :disabled="pending" @click="hide(viewedRecord)">恢复预设</n-button><n-button v-else type="primary" @click="editViewed">编辑预设</n-button></header>
      <div class="guide-page-scroll"><n-alert v-if="!viewedRecord" type="info">尚未保存机体配置，点击“编辑预设”开始配置。</n-alert><PresetOverview :preset="viewed" :entries="entries" /></div>
    </template>
  </section>
</template>

<style scoped>
.presets-page { min-height: 0; min-width: 0; }
.preset-search-field { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.preset-name-search { max-width: 260px; }
.preset-plan-name { display: flex; align-items: end; flex-wrap: wrap; gap: 12px; margin: 12px 0; }
.preset-plan-name > .guide-form-field { width: 320px; max-width: 100%; }
.preset-tabs { display: flex; gap: 8px; }
.preset-tabs button { padding: 10px 18px; border: 1px solid var(--border); border-radius: 8px; background: var(--surface); color: var(--text); }
.preset-tabs button[aria-selected="true"] { background: var(--accent-soft); color: var(--accent-text); border-color: var(--accent); }
.preset-character-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 14px; }
.preset-character-card { display: flex; flex-direction: column; gap: 7px; min-width: 0; padding: 12px; text-align: left; background: var(--surface); color: var(--text); border: 1px solid var(--border); border-radius: 10px; }
.preset-character-card:hover { border-color: var(--accent); }
.preset-character-card > :first-child { width: 100%; height: 130px; }
.preset-character-card span, .preset-character-card small, .preset-direct-section p { color: var(--muted); font-size: 12px; }
.preset-direct-section { margin-bottom: 32px; }
.preset-direct-section > header { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px; }
.preset-direct-section h2 { margin: 0 0 6px; }
.preset-empty { padding: 18px; border: 1px dashed var(--border); border-radius: 8px; }
.guide-page-scroll > .guide-form-field { margin: 18px 0; max-width: 920px; }
.guide-list-card > p { margin: 12px 0; }
.guide-list-toolbar { margin-top: 16px; }
.preset-general-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 340px), 440px)); gap: 16px; }
.preset-inline-config { min-width: 0; border-radius: 12px; }
.preset-inline-config:hover { outline: 1px solid var(--accent); }
.preset-inline-config > .preset-overview { height: 100%; }
</style>
