<script setup lang="ts">
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { NAlert, NButton, NInput, NInputNumber, NSelect, useDialog, useMessage } from 'naive-ui';
import { ArrowLeft, Plus, Pencil, Copy, Trash2, RotateCcw, ExternalLink, BookOpen, Workflow, Users } from 'lucide-vue-next';
import type { EntryView } from '../../shared/types';
import { createGuide, type GuideDocument, type GuideRecord } from '../../shared/guides';
import { validateGuide } from '../../shared/guide-validation';
import { flattenFlowNodes } from '../../shared/guide-flow';
import { displayDate, errorMessage } from '../ui';
import { useGuideSelectMenus } from '../guide-select-menus';
import { compareCatalogEntries } from '../catalog-query';
import GuideTeamEditor from './GuideTeamEditor.vue';
import GuideTeamOverview from './GuideTeamOverview.vue';
import GuideFlowEditor from './GuideFlowEditor.vue';
import GuideFlowView from './GuideFlowView.vue';
import GuideVideos from './GuideVideos.vue';
import GuideChoiceFilter from './GuideChoiceFilter.vue';
import RecordFilters from './RecordFilters.vue';
import { matchesGuideFilters, guideStageLabel, type GuideFilters } from '../guide-team';
import './guides.css';
import type { PresetRecord } from '../../shared/presets';

const props = defineProps<{
  entries: EntryView[];
  guides: GuideRecord[];
  presets?: PresetRecord[];
  request?: { token: number; stageId?: string; guideId?: string; create?: boolean };
}>();
const { renderCatalogLabel } = useCatalogSelectLabel(() => props.entries);
const emit = defineEmits<{ refresh: []; dirty: [value: boolean]; pending: [value: boolean] }>();
const dialog = useDialog();
const message = useMessage();
const records = ref<GuideRecord[]>(props.guides);
watch(() => props.guides, value => { records.value = value; });
const mode = ref<'list' | 'detail' | 'edit'>('list');
const selectedId = ref('');
const selected = computed(() => records.value.find(guide => guide.id === selectedId.value));
const draft = ref<GuideDocument | null>(null);
const revision = ref<number | null>(null);
const original = ref('');
const pending = ref(false);
const failure = ref('');
const tab = ref('basic');
const { selectMenu, closeSelectMenus } = useGuideSelectMenus();
watch([mode, tab, pending], closeSelectMenus);
const search = ref('');
const trash = ref(false);
const listFilters = ref<Record<string, string>>({});
const stageFilter = computed({ get: () => listFilters.value.stage || '', set: value => { listFilters.value = { ...listFilters.value, stage: value }; } });
const listFilterFields = computed(() => [
  { key: 'stage', label: '副本', options: props.entries.filter(entry => entry.category === 'stage').sort(compareCatalogEntries).map(entry => ({ value: entry.id, label: guideStageLabel(entry, props.entries) })) },
  { key: 'character', label: '队伍机体', options: props.entries.filter(entry => entry.category === 'character').sort(compareCatalogEntries).map(entry => ({ value: entry.id, label: entry.name })) },
  { key: 'status', label: '状态', options: [{ value: 'draft', label: '草稿' }, { value: 'ready', label: '已完成' }] },
  { key: 'flow', label: '流程类型', options: [{ value: 'single', label: '执行一次' }, { value: 'loop', label: '包含循环' }] },
]);
const stageFilters = ref<GuideFilters>({});
const page = ref(1);
const dirty = computed(() => mode.value === 'edit' && JSON.stringify(draft.value) !== original.value);
const activeGuide = computed(() => mode.value === 'edit' ? draft.value : selected.value);
const issues = computed(() => activeGuide.value ? validateGuide(activeGuide.value, props.entries) : []);
const byId = computed(() => new Map(props.entries.map(entry => [entry.id, entry])));
const stageChoices = computed(() => {
  const choices = props.entries.filter(entry => entry.category === 'stage' && !entry.hidden && !entry.retired && (draft.value?.stageIds.includes(entry.id) || matchesGuideFilters(entry, stageFilters.value))).sort(compareCatalogEntries).map(entry => ({ value: entry.id, label: guideStageLabel(entry, props.entries) }));
  for (const id of draft.value?.stageIds ?? []) if (!choices.some(choice => choice.value === id)) choices.push({ value: id, label: `${byId.value.get(id)?.name || '原副本'}（当前不可用）` });
  return choices;
});
const filtered = computed(() => records.value.filter(guide => guide.hidden === trash.value
  && (!stageFilter.value || guide.stageIds.includes(stageFilter.value))
  && (!listFilters.value.character || guide.team.members.some(member => member.characterId === listFilters.value.character))
  && (!listFilters.value.status || guide.status === listFilters.value.status)
  && (!listFilters.value.flow || guide.flow.mode === listFilters.value.flow)
  && (!search.value.trim() || [guide.name, guide.notes, ...guide.stageIds.map(id => byId.value.get(id)?.name || '')].join(' ').toLocaleLowerCase().includes(search.value.trim().toLocaleLowerCase()))));
const pageCount = computed(() => Math.max(1, Math.ceil(filtered.value.length / 12)));
const shown = computed(() => filtered.value.slice((page.value - 1) * 12, page.value * 12));
watch([search, trash, listFilters], () => { page.value = 1; });
watch(pageCount, count => { page.value = Math.min(page.value, count); });
watch(dirty, value => emit('dirty', value), { immediate: true });
watch(pending, value => emit('pending', value));

/** 编辑副本只含业务字段，数据库修订单独保存。 */
const documentOf = (guide: GuideRecord): GuideDocument => {
  const { createdAt: _createdAt, updatedAt: _updatedAt, revision: _revision, hidden: _hidden, ...document } = guide;
  return JSON.parse(JSON.stringify(document)) as GuideDocument;
};
/** 页面内部切换同样保护未保存内容。 */
const guard = (action: () => void): void => {
  if (pending.value) return;
  if (!dirty.value) { action(); return; }
  dialog.warning({ title: '放弃未保存的攻略修改？', content: '本次修改尚未保存。', positiveText: '放弃修改', negativeText: '继续编辑', onPositiveClick: action });
};
/** 新增或编辑攻略，所有改动仅作用于独立草稿。 */
const beginEdit = (guide?: GuideRecord, stageIds: string[] = []): void => guard(() => {
  draft.value = guide ? documentOf(guide) : createGuide(stageIds);
  revision.value = guide?.revision ?? null;
  selectedId.value = guide?.id || '';
  original.value = JSON.stringify(draft.value);
  mode.value = 'edit'; tab.value = 'basic'; failure.value = '';
});
/** 返回详情或列表，不修改已经保存的记录。 */
const leaveEditor = (): void => guard(() => { mode.value = selected.value ? 'detail' : 'list'; draft.value = null; failure.value = ''; });
/** 从列表查看已有攻略。 */
const openGuide = (guide: GuideRecord): void => guard(() => { selectedId.value = guide.id; mode.value = 'detail'; failure.value = ''; });
/** 复制配置与流程，但使用新的独立攻略标识。 */
const duplicate = (guide: GuideRecord): void => guard(() => {
  draft.value = { ...documentOf(guide), id: createGuide().id, name: `${guide.name}（副本）`, status: 'draft' };
  revision.value = null; selectedId.value = ''; original.value = ''; mode.value = 'edit'; tab.value = 'basic'; failure.value = '';
});
/** 主进程校验后保存，保存失败保留草稿和当前编辑页。 */
const save = async (): Promise<void> => {
  if (!draft.value || pending.value) return;
  failure.value = '';
  if (issues.value.length) { failure.value = issues.value.map(issue => issue.message).join('\n'); return; }
  pending.value = true;
  try {
    const saved = await window.desktop.saveGuide(JSON.parse(JSON.stringify(draft.value)), revision.value);
    records.value = [saved, ...records.value.filter(guide => guide.id !== saved.id)];
    selectedId.value = saved.id; original.value = JSON.stringify(draft.value); mode.value = 'detail'; draft.value = null;
    emit('refresh'); message.success('攻略已保存。');
  } catch (error) { failure.value = errorMessage(error); }
  finally { pending.value = false; }
};
/** 攻略使用自己的回收站，删除时可恢复全部配置和流程。 */
const changeHidden = (guide: GuideRecord, hidden: boolean): void => {
  const commit = async (): Promise<void> => {
    if (pending.value) return;
    pending.value = true;
    try {
      const saved = await window.desktop.setGuideHidden(guide.id, hidden, guide.revision);
      records.value = records.value.map(value => value.id === saved.id ? saved : value);
      mode.value = 'list'; selectedId.value = ''; emit('refresh'); message.success(hidden ? '攻略已移至回收站。' : '攻略已恢复。');
    } catch (error) { message.error(errorMessage(error)); }
    finally { pending.value = false; }
  };
  if (!hidden) { void commit(); return; }
  dialog.warning({ title: '将攻略移至回收站？', content: `“${guide.name}”的队伍配置和流程会一并保留，可在攻略回收站恢复。`, positiveText: '移至回收站', negativeText: '取消', onPositiveClick: commit });
};
/** 参考视频始终通过桌面协议校验打开系统浏览器。 */
const openVideo = async (url: string): Promise<void> => {
  try { await window.desktop.openExternal(url); } catch (error) { message.error(errorMessage(error)); }
};
/** 副本详情可直接新建关联攻略或打开已有攻略。 */
watch(() => props.request?.token, () => {
  const request = props.request;
  if (!request) return;
  stageFilter.value = request.stageId || '';
  if (request.create) beginEdit(undefined, request.stageId ? [request.stageId] : []);
  else if (request.guideId) {
    const guide = records.value.find(value => value.id === request.guideId);
    if (guide) openGuide(guide);
  }
  else { mode.value = 'list'; draft.value = null; failure.value = ''; }
}, { immediate: true });
/** 攻略页面快捷键不触发基础资料的新增行为。 */
const keyboard = (event: KeyboardEvent): void => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && mode.value === 'edit') { event.preventDefault(); void save(); }
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n' && mode.value === 'list') { event.preventDefault(); beginEdit(); }
  if (event.key === 'Escape' && !event.defaultPrevented && ![...document.querySelectorAll('.n-dialog, .n-base-select-menu')].some(element => (element as HTMLElement).offsetParent !== null)) {
    if (mode.value === 'edit') leaveEditor();
    else if (mode.value === 'detail') mode.value = 'list';
  }
};
onMounted(() => window.addEventListener('keydown', keyboard));
onUnmounted(() => { window.removeEventListener('keydown', keyboard); emit('dirty', false); emit('pending', false); });
</script>

<template>
  <section class="guides-page page-layout" :data-guide-mode="mode">
    <template v-if="mode === 'list'">
      <header class="guide-page-header"><div><div class="eyebrow">攻略工作台</div><h1>副本攻略</h1><p>关联适用副本，记录队伍配置与操作流程。</p></div><n-button type="primary" @click="beginEdit()"><template #icon><Plus :size="16" /></template>新建攻略</n-button></header>
      <div class="guide-list-toolbar">
        <div class="guide-list-switch" role="group" aria-label="攻略范围"><n-button :type="!trash ? 'primary' : 'default'" @click="trash = false">我的攻略</n-button><n-button :type="trash ? 'primary' : 'default'" @click="trash = true">攻略回收站</n-button></div>
      </div>
      <RecordFilters :entries="entries" v-model="listFilters" v-model:search="search" label="攻略筛选" placeholder="名称、备注或副本" :fields="listFilterFields" />
      <div class="guide-page-scroll">
        <div v-if="!shown.length" class="guide-empty"><BookOpen :size="36" :stroke-width="1.3" /><h2>{{ trash ? '攻略回收站为空' : search || Object.values(listFilters).some(Boolean) ? '没有找到符合条件的攻略' : '从一份副本攻略开始' }}</h2><p>每份攻略可以关联多个副本，并分别记录配队与操作流程。</p><n-button v-if="!trash" @click="beginEdit(undefined, stageFilter ? [stageFilter] : [])">新建攻略</n-button></div>
        <div v-else class="guide-list">
          <article v-for="guide in shown" :key="guide.id" class="guide-list-card" :data-guide-id="guide.id" tabindex="0" role="button" :aria-label="`查看攻略${guide.name}`" @click="openGuide(guide)" @keydown.enter="openGuide(guide)" @keydown.space.prevent="openGuide(guide)">
            <div class="guide-card-heading"><h2>{{ guide.name }}</h2><span class="neutral-tag">{{ guide.status === 'ready' ? '已完成' : '草稿' }}</span></div>
            <p class="guide-stage-labels">{{ guide.stageIds.map(id => byId.get(id)?.name || '副本暂不可用').join(' · ') || '尚未关联副本' }}</p>
            <div class="guide-list-facts"><span><Users :size="14" />{{ guide.team.members.length }} 名机体</span><span><Workflow :size="14" />{{ guide.flow.mode === 'loop' ? '含循环步骤' : '执行一次' }} · {{ flattenFlowNodes(guide.flow).length }} 个节点</span></div>
            <p v-if="guide.notes" class="guide-list-notes">{{ guide.notes }}</p><small>更新于 {{ displayDate(guide.updatedAt) }}</small>
          </article>
        </div>
      </div>
      <footer class="guide-pagination"><span>共 {{ filtered.length }} 份攻略</span><n-button size="small" :disabled="page <= 1" @click="page--">上一页</n-button><span>{{ page }} / {{ pageCount }}</span><n-button size="small" :disabled="page >= pageCount" @click="page++">下一页</n-button></footer>
    </template>

    <template v-else-if="mode === 'edit' && draft">
      <header class="guide-editor-toolbar"><n-button quaternary :disabled="pending" @click="leaveEditor"><template #icon><ArrowLeft :size="16" /></template>{{ selected ? '返回攻略' : '返回列表' }}</n-button><strong>{{ revision ? '编辑攻略' : '新建攻略' }}</strong><span v-if="dirty" class="muted">未保存</span><n-button v-if="selected" quaternary type="error" :disabled="pending" @click="changeHidden(selected, true)">移至回收站</n-button><n-button type="primary" :loading="pending" @click="save">保存攻略</n-button></header>
      <nav class="guide-editor-tabs" aria-label="攻略编辑页签"><button v-for="item in [{ id: 'basic', label: '基本信息' }, { id: 'team', label: '队伍配置' }, { id: 'flow', label: '操作流程' }]" :key="item.id" :aria-current="tab === item.id ? 'page' : undefined" @click="tab = item.id">{{ item.label }}</button></nav>
      <div class="guide-page-scroll guide-editor-content" :class="{ 'guide-form-pending': pending }" :inert="pending || undefined">
        <n-alert v-if="failure" type="error" :bordered="false" class="guide-form-message"><div class="rich-text">{{ failure }}</div></n-alert>
        <n-alert v-if="!entries.some(entry => entry.category === 'character' && entry.guideOptions)" type="info" :bordered="false" class="guide-form-message">请在同步中心检查并启用基础资料，取得进化阶段和装备配置选项。可以先保存攻略名称和备注。</n-alert>
        <div v-if="tab === 'basic'" class="guide-basic-form">
          <label><span>攻略名称 <span class="required-mark">*</span></span><n-input v-model:value="draft.name" placeholder="例如：囚笼物理队操作流程" maxlength="200" /></label>
          <div class="guide-basic-field"><span>适用副本</span><GuideChoiceFilter v-model="stageFilters" :entries="entries" category="stage" label="副本" /><n-select v-bind="selectMenu('stages')" v-model:value="draft.stageIds" :options="stageChoices" :render-label="renderCatalogLabel" multiple filterable clearable placeholder="可选择多个副本" aria-label="适用副本" :input-props="{ 'aria-label': '适用副本' }" max-tag-count="responsive" /></div>
          <div class="guide-form-row"><label>记录时间<input v-model="draft.recordedAt" type="datetime-local" class="guide-native-input" aria-label="攻略记录时间" /></label><label>预计战斗时长（秒）<n-input-number v-model:value="draft.durationSeconds" :min="0" :max="86400" placeholder="可留空" /></label><div class="guide-basic-field"><span>完成状态</span><n-select v-bind="selectMenu('status')" v-model:value="draft.status" :options="[{ label: '草稿', value: 'draft' }, { label: '已完成', value: 'ready' }]" aria-label="完成状态" /></div></div>
          <label>攻略备注<n-input v-model:value="draft.notes" type="textarea" :autosize="{ minRows: 4, maxRows: 12 }" placeholder="适用条件、注意事项、成绩或调整建议" maxlength="100000" /></label>
          <GuideVideos v-model="draft.videoUrls" />
        </div>
        <GuideTeamEditor v-else-if="tab === 'team' && draft" v-model="draft.team" :entries="entries" :presets="presets" />
        <GuideFlowEditor v-else-if="tab === 'flow' && draft" v-model="draft.flow" :team="draft.team" :entries="entries" />
        <details v-if="issues.length" class="guide-issues"><summary>{{ issues.length }} 项配置需要补充或调整</summary><ul><li v-for="(issue, index) in issues" :key="index">{{ issue.message }}</li></ul></details>
      </div>
    </template>

    <template v-else-if="selected">
      <header class="guide-detail-toolbar"><n-button quaternary :disabled="pending" @click="mode = 'list'"><template #icon><ArrowLeft :size="16" /></template>返回列表</n-button><div><n-button v-if="selected.hidden" type="primary" :loading="pending" @click="changeHidden(selected, false)"><template #icon><RotateCcw :size="16" /></template>恢复攻略</n-button><template v-else><n-button type="primary" :disabled="pending" @click="beginEdit(selected)"><template #icon><Pencil :size="16" /></template>编辑攻略</n-button><n-button :disabled="pending" @click="duplicate(selected)"><template #icon><Copy :size="16" /></template>复制攻略</n-button></template></div></header>
      <div class="guide-page-scroll guide-detail-content">
        <div class="guide-detail-heading"><div class="eyebrow">{{ selected.status === 'ready' ? '已完成攻略' : '攻略草稿' }} · {{ selected.flow.mode === 'loop' ? '含循环步骤' : '执行一次' }}</div><h1>{{ selected.name }}</h1><p>{{ selected.stageIds.map(id => byId.get(id)?.name || '副本暂不可用').join(' · ') || '尚未关联副本' }}</p><div class="guide-detail-times"><span v-if="selected.recordedAt">记录时间 {{ selected.recordedAt.replace('T', ' ') }}</span><span v-if="selected.durationSeconds !== null">预计战斗 {{ selected.durationSeconds }} 秒</span><span>更新于 {{ displayDate(selected.updatedAt) }}</span></div></div>
        <n-alert v-if="selected.hidden" type="warning" :bordered="false">攻略已在回收站中，恢复后可继续编辑。</n-alert>
        <n-alert v-if="issues.length" type="warning" :bordered="false" class="guide-form-message">当前配置有 {{ issues.length }} 项待调整，编辑攻略可查看具体原因。</n-alert>
        <GuideTeamOverview :team="selected.team" :entries="entries" :guide-name="selected.name" />
        <GuideFlowView :flow="selected.flow" :team="selected.team" :entries="entries" />
        <section v-if="selected.notes" class="guide-reading-section"><h2>攻略备注</h2><p class="rich-text">{{ selected.notes }}</p></section>
        <section v-if="selected.videoUrls.length" class="guide-reading-section"><h2>参考视频</h2><button v-for="(url, index) in selected.videoUrls" :key="index" class="guide-video-link" @click="openVideo(url)"><ExternalLink :size="16" /><span>{{ url }}</span></button></section>
      </div>
    </template>
  </section>
</template>
