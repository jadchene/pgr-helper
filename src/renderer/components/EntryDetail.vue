<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  NButton,
  NAlert,
  NCollapse,
  NCollapseItem,
  useMessage,
} from "naive-ui";
import {
  Pencil,
  Trash2,
  RotateCcw,
  ArrowLeft,
  ArrowUpRight,
  Link2,
  FileText,
} from "lucide-vue-next";
import { categoryLabels, type EntryView } from "../../shared/types";
import { categoryMeta, displayDate, errorMessage, isWebUrl } from "../ui";
import EntryArtwork from "./EntryArtwork.vue";
import SkillBook from "./SkillBook.vue";
import type { GuideRecord } from '../../shared/guides';

const props = defineProps<{
  entry: EntryView | null;
  entries: EntryView[];
  pending: boolean;
  guides?: GuideRecord[];
}>();
const emit = defineEmits<{
  close: [];
  edit: [entry: EntryView];
  remove: [entry: EntryView];
  restore: [entry: EntryView];
  reset: [entry: EntryView];
  inspect: [entry: EntryView];
  createGuide: [stageId: string];
  openGuide: [guideId: string];
}>();
const message = useMessage();
const detailTitle = ref<HTMLElement | null>(null);
/** 技能按源分类展示，手动添加的普通段落仍保留完整正文。 */
const skillSections = computed(() => props.entry?.sections.filter((section) => section.skill) || []);
const contentSections = computed(() => props.entry?.sections.filter((section) => !section.skill) || []);
/** 同一攻略可以出现在多个适用副本中。 */
const stageGuides = computed(() => props.guides?.filter(guide => !guide.hidden && guide.stageIds.includes(props.entry?.id || '')) || []);
/** 按条目重建详情页后将键盘阅读位置移到标题，不额外滚动正文。 */
onMounted(() => detailTitle.value?.focus({ preventScroll: true }));
const related = computed(() =>
  (props.entry?.relatedIds || []).map((id) => ({
    id,
    entry: props.entries.find((entry) => entry.id === id),
  })),
);
const visibleTags = computed(
  () =>
    props.entry?.tags.filter(
      (value) =>
        value !== props.entry?.element && value !== props.entry?.profession,
    ) || [],
);
/** 将上游定位信息收起，本地条目属性保持正常展示。 */
const isSourceAttribute = (key: string) =>
  props.entry?.origin === "source" && /资源|编号|属性池/.test(key);
const readableAttributes = computed(() =>
  Object.entries(props.entry?.attributes || {}).filter(
    ([key]) => !isSourceAttribute(key),
  ),
);
const sourceAttributes = computed(() =>
  Object.entries(props.entry?.attributes || {}).filter(([key]) =>
    isSourceAttribute(key),
  ),
);
/** 通过桥接的协议校验打开属性中的网页。 */
const openLink = async (url: string) => {
  try {
    await window.desktop.openExternal(url);
  } catch (error) {
    message.error(errorMessage(error));
  }
};
</script>

<template>
  <section v-if="entry" class="detail-page page-layout" aria-labelledby="entry-detail-title">
    <header class="detail-toolbar">
      <n-button quaternary class="detail-back" @click="emit('close')">
        <template #icon><ArrowLeft :size="16" /></template>
        返回列表
      </n-button>
      <div class="detail-actions">
        <n-button
          v-if="entry.hidden"
          type="primary"
          :loading="pending"
          @click="emit('restore', entry)"
        >
          <template #icon><RotateCcw :size="15" /></template>
          恢复资料
        </n-button>
        <template v-else>
          <n-button type="primary" :disabled="pending" @click="emit('edit', entry)">
            <template #icon><Pencil :size="15" /></template>
            编辑资料
          </n-button>
          <n-button
            v-if="entry.origin === 'source' && entry.modified"
            :disabled="pending"
            @click="emit('reset', entry)"
          >恢复源内容</n-button>
          <n-button quaternary type="error" :disabled="pending" @click="emit('remove', entry)">
            <template #icon><Trash2 :size="15" /></template>
            移至回收站
          </n-button>
        </template>
      </div>
    </header>
    <div class="detail-scroll" role="region" :aria-label="entry.name + '详情'" tabindex="0">
      <div class="detail-body">
        <div class="detail-hero">
          <EntryArtwork :entry="entry" />
          <div>
            <div class="eyebrow">
              {{ categoryLabels[entry.category]
              }}<span v-if="entry.rarity"> · {{ entry.rarity }}</span>
            </div>
            <h1 id="entry-detail-title" ref="detailTitle" tabindex="-1">{{ entry.name }}</h1>
            <p v-if="entry.subtitle">{{ entry.subtitle }}</p>
          </div>
        </div>
        <div class="detail-tags">
          <span
            v-if="entry.element"
            class="element-tag"
            :data-element="entry.element"
            >{{ entry.element }}</span
          ><span v-if="entry.profession" class="neutral-tag">{{
            entry.profession
          }}</span
          ><span v-for="tag in visibleTags" :key="tag" class="neutral-tag">{{
            tag
          }}</span
          ><span
            v-if="entry.modified || entry.origin === 'local'"
            class="local-tag"
            >{{ entry.origin === "local" ? "本地新增" : "本地修改" }}</span
          >
        </div>
        <n-alert
          v-if="entry.hidden"
          type="warning"
          :bordered="false"
          class="detail-alert"
          >这条资料在回收站中，恢复后可继续编辑。</n-alert
        >
        <n-alert
          v-else-if="entry.retired"
          type="warning"
          :bordered="false"
          class="detail-alert"
          >当前来源版本已移除此条资料，本地内容仍被保留。</n-alert
        >
        <section v-if="entry.description" class="detail-section">
          <h2><FileText :size="15" />简介</h2>
          <p class="rich-text">{{ entry.description }}</p>
        </section>
        <section v-if="entry.aliases.length" class="detail-section">
          <h2>别名</h2>
          <div class="detail-tags">
            <span
              v-for="alias in entry.aliases"
              :key="alias"
              class="neutral-tag"
              >{{ alias }}</span
            >
          </div>
        </section>
        <section v-if="readableAttributes.length" class="detail-section">
          <h2>基础属性</h2>
          <dl class="attribute-list">
            <div v-for="[key, value] in readableAttributes" :key="key">
              <dt>{{ key }}</dt>
              <dd>
                <button
                  v-if="isWebUrl(value)"
                  class="text-button attribute-link"
                  @click="openLink(value)"
                >
                  {{ value }}<ArrowUpRight :size="13" /></button
                ><span v-else>{{ value || "—" }}</span>
              </dd>
            </div>
          </dl>
        </section>
        <SkillBook v-if="skillSections.length" :sections="skillSections" />
        <section v-if="entry.category === 'stage'" class="detail-section">
          <div class="section-toolbar"><h2>关联攻略 <span class="muted">{{ stageGuides.length }}</span></h2><n-button size="small" :disabled="pending" @click="emit('createGuide', entry.id)">新建关联攻略</n-button></div>
          <div v-if="stageGuides.length" class="related-list"><button v-for="guide in stageGuides" :key="guide.id" @click="emit('openGuide', guide.id)"><FileText :size="17" /><span><strong>{{ guide.name }}</strong><small>{{ guide.flow.mode === 'loop' ? '循环流程' : '单套流程' }} · {{ guide.status === 'ready' ? '已完成' : '草稿' }}</small></span><ArrowUpRight :size="14" /></button></div>
          <p v-else class="muted">还没有适用于此副本的攻略。</p>
        </section>
        <section
          v-for="(section, index) in contentSections"
          :key="index"
          class="detail-section"
        >
          <h2>{{ section.title }}</h2>
          <p class="rich-text">{{ section.body || "暂无内容" }}</p>
        </section>
        <section v-if="related.length" class="detail-section">
          <h2>
            <Link2 :size="15" />关联资料<span class="muted">{{
              related.length
            }}</span>
          </h2>
          <div class="related-list">
            <button
              v-for="item in related"
              :key="item.id"
              :disabled="!item.entry"
              @click="item.entry && emit('inspect', item.entry)"
            >
              <component
                :is="item.entry ? categoryMeta[item.entry.category].icon : Link2"
                :size="17"
              /><span
                ><strong>{{ item.entry?.name || "当前版本无此资料" }}</strong
                ><small>{{
                  item.entry
                    ? categoryLabels[item.entry.category] +
                      (item.entry.hidden ? " · 回收站" : "")
                    : item.id
                }}</small></span
              ><ArrowUpRight v-if="item.entry" :size="14" />
            </button>
          </div>
        </section>
        <div
          v-if="
            !entry.description &&
            !entry.sections.length &&
            !Object.keys(entry.attributes).length
          "
          class="inline-empty"
        >
          还没有详细内容，可以编辑资料来补充。
        </div>
        <n-collapse
          v-if="entry.sourceKey || sourceAttributes.length"
          class="source-information"
          ><n-collapse-item title="来源信息" name="source"
            ><dl class="attribute-list">
              <div v-if="entry.sourceKey">
                <dt>来源编号</dt>
                <dd>{{ entry.sourceKey }}</dd>
              </div>
              <div v-for="[key, value] in sourceAttributes" :key="key">
                <dt>{{ key }}</dt>
                <dd>{{ value || "—" }}</dd>
              </div>
            </dl></n-collapse-item
          ></n-collapse
        >
        <div class="detail-provenance">
          <span>{{ entry.origin === "local" ? "本地维护" : "来源资料" }}</span
          ><span v-if="entry.updatedAt"
            >更新于 {{ displayDate(entry.updatedAt) }}</span
          >
        </div>
      </div>
    </div>
  </section>
</template>
