<script setup lang="ts">
import DictionaryBadge from './DictionaryBadge.vue';
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { NButton, NInput, NSelect, NPopover, NPagination } from "naive-ui";
import {
  Search,
  LayoutGrid,
  List,
  Plus,
  Pencil,
  RotateCcw,
  Inbox,
  X,
  ArrowUpRight,
  ArchiveRestore,
  Info,
} from "lucide-vue-next";
import type { Category, EntryView } from "../../shared/types";
import { categoryLabels } from "../../shared/types";
import { categoryMeta } from "../ui";
import EntryArtwork from "./EntryArtwork.vue";
import { catalogQueryConfig, compareCatalogEntries, facetOptions, matchesCatalogFilters } from '../catalog-query';

const props = defineProps<{
  entries: EntryView[];
  category: Category | "all";
  viewMode: "grid" | "list";
  trash?: boolean;
  pending?: boolean;
  hasSourceData: boolean;
  active?: boolean;
}>();
const { renderFacetLabel } = useCatalogSelectLabel(() => props.entries);
const emit = defineEmits<{
  inspect: [entry: EntryView];
  edit: [entry: EntryView];
  create: [];
  restore: [entry: EntryView];
  viewMode: [value: "grid" | "list"];
  sync: [];
}>();
const search = ref("");
const page = ref(1);
const pageSize = ref(24);
const orderHelpOpen = ref(false);
const orderMenuOpen = ref(false);
const activeFilterDropdown = ref<string | null>(null);
/** 一个筛选面板只展开一个下拉菜单，保留输入框本身的搜索交互。 */
const updateFilterDropdown = (key: string, open: boolean) => {
  if (open) { activeFilterDropdown.value = key; orderMenuOpen.value = false; orderHelpOpen.value = false; }
  else if (activeFilterDropdown.value === key) activeFilterDropdown.value = null;
};
/** 锚点随滚动或窗口变化移动时收起菜单，避免它追随已不可见的输入框。 */
const closeFilterDropdown = () => {
  activeFilterDropdown.value = null;
};
/** 页面移动时收起浮层，选项内部滚动不收起。 */
const onPageScroll = (event: Event) => {
  if (event.target instanceof Element && event.target.closest('.n-base-select-menu, .n-base-selection')) return;
  closeFilterDropdown();
};
onMounted(() => { window.addEventListener('resize', closeFilterDropdown); window.addEventListener('scroll', onPageScroll, true); });
onUnmounted(() => { window.removeEventListener('resize', closeFilterDropdown); window.removeEventListener('scroll', onPageScroll, true); });
/** 分类切换、清空与首次进入使用相同的空条件。 */
const emptyFilters = () => ({ facets: {} as Record<string, string | null>, status: 'all' });
const filters = ref(emptyFilters());
const draft = ref(emptyFilters());
const sortOrder = ref<'source' | 'name'>('source');
const queryConfig = computed(() => catalogQueryConfig[props.category]);
const sortOptions = computed(() => [{ label: queryConfig.value.orderLabel, value: 'source' }, { label: '名称顺序', value: 'name' }]);
const baseEntries = computed(() =>
  props.entries.filter(
    (entry) =>
      (props.category === "all" || entry.category === props.category) &&
      entry.hidden === !!props.trash,
  ),
);
const awaitingInitialSync = computed(
  () => !props.trash && !props.hasSourceData && !baseEntries.value.length,
);
/** 从当前分类生成真实筛选项，不预设不存在的属性。 */
const filterFields = computed(() => queryConfig.value.filters.map(field => ({ ...field, options: facetOptions(baseEntries.value, field.key) })));
const statusOptions = [
  { label: "全部状态", value: "all" },
  { label: "本地修改", value: "modified" },
  { label: "本地新增", value: "local" },
  { label: "来源资料", value: "source" },
  { label: "来源已移除", value: "retired" },
];
const filterCount = computed(
  () =>
    [
      ...Object.values(filters.value.facets),
      filters.value.status !== "all" ? filters.value.status : null,
    ].filter(Boolean).length,
);
const matches = computed(() => {
  const words = search.value
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return baseEntries.value
    .filter((entry) => {
      const values =
        `${entry.name} ${entry.subtitle} ${entry.aliases.join(" ")} ${entry.tags.join(" ")} ${entry.sourceKey}`.toLocaleLowerCase();
      const f = filters.value;
      return (
        words.every((word) => values.includes(word)) &&
        matchesCatalogFilters(entry, f.facets, f.status)
      );
    })
    .sort((a, b) => compareCatalogEntries(a, b, sortOrder.value));
});
const pageEntries = computed(() =>
  matches.value.slice(
    (page.value - 1) * pageSize.value,
    page.value * pageSize.value,
  ),
);
const title = computed(() =>
  props.trash
    ? "回收站"
    : props.category === "all"
      ? "全部资料"
      : categoryLabels[props.category],
);
watch(
  [search, () => props.category, () => props.trash, filters, pageSize, sortOrder],
  () => {
    page.value = 1;
  },
);
watch(
  () => matches.value.length,
  (count) => {
    page.value = Math.min(
      page.value,
      Math.max(1, Math.ceil(count / pageSize.value)),
    );
  },
);
watch(
  [() => props.category, () => props.trash],
  () => {
    search.value = "";
    filters.value = emptyFilters();
    draft.value = emptyFilters();
    sortOrder.value = 'source';
    closeFilterDropdown();
    orderHelpOpen.value = false;
    orderMenuOpen.value = false;
  },
);
/** 进入详情页时收起传送到页面外层的筛选浮层。 */
watch(() => props.active, (active) => {
  if (active === false) {
    orderHelpOpen.value = false;
    orderMenuOpen.value = false;
    closeFilterDropdown();
  }
});
/** 显式应用筛选草稿，填写过程中不改变资料列表。 */
const applyFilters = () => {
  filters.value = { status: draft.value.status, facets: { ...draft.value.facets } };
  closeFilterDropdown();
};
/** 清除已应用条件及待应用草稿。 */
const clearFilters = () => {
  closeFilterDropdown();
  search.value = "";
  filters.value = emptyFilters();
  draft.value = emptyFilters();
};
</script>

<template>
  <section class="catalog-page page-layout">
    <header class="page-heading">
      <div>
        <div class="eyebrow">{{ trash ? "本地管理" : "基础资料" }}</div>
        <h1>
          {{ title
          }}<span class="heading-count">{{
            baseEntries.length.toLocaleString()
          }}</span>
        </h1>
        <p>
          {{
            trash
              ? "移除的条目保留在这里，恢复后会回到对应分类。"
              : category === "all"
                ? "浏览与维护你的本地资料。"
                : categoryMeta[category].description
          }}
        </p>
      </div>
      <n-button v-if="!trash" type="primary" @click="emit('create')"
        ><template #icon><Plus :size="16" /></template>新增资料</n-button
      >
    </header>
    <section class="catalog-filter-bar" aria-label="资料筛选">
      <div class="filter-fields">
        <div class="filter-field catalog-search-field"><span>名称／别名</span><n-input v-model:value="search" class="catalog-search" clearable placeholder="搜索名称、别名或关键词" aria-label="搜索资料"><template #prefix><Search :size="16" /></template></n-input></div>
        <div v-for="field in filterFields" :key="field.key" class="filter-field" :data-facet="field.key">
          <span :id="`catalog-filter-${field.key}-label`">{{ field.label }}</span>
          <n-select v-model:value="draft.facets[field.key]" :options="field.options" :render-label="option => renderFacetLabel(field.key, option)" clearable filterable
            :show="activeFilterDropdown === field.key" @update:show="open => updateFilterDropdown(field.key, open)"
            :input-props="{ 'aria-labelledby': `catalog-filter-${field.key}-label` }"
            :placeholder="`全部${field.label}`" :aria-label="field.label" />
        </div>
        <div class="filter-field" data-facet="status"><span id="catalog-filter-status-label">本地状态</span><n-select v-model:value="draft.status" :options="statusOptions" :show="activeFilterDropdown === 'status'" @update:show="open => updateFilterDropdown('status', open)" aria-labelledby="catalog-filter-status-label" /></div>
      </div>
      <div class="catalog-toolbar">
        <div class="filter-actions"><n-button @click="clearFilters">清空筛选</n-button><n-button type="primary" @click="applyFilters">应用筛选</n-button></div>
        <div class="catalog-order"><n-select v-model:value="sortOrder" v-model:show="orderMenuOpen" :options="sortOptions" aria-label="排序方式" />
          <n-popover v-model:show="orderHelpOpen" trigger="click" placement="bottom-end" :width="300"><template #trigger><button class="inline-icon" aria-label="查看排序依据" title="排序依据"><Info :size="16" /></button></template><div class="order-help">{{ queryConfig.orderHelp }}</div></n-popover>
        </div>
        <div class="view-switch" aria-label="展示方式"><button :class="{ active: viewMode === 'grid' }" title="卡片视图" aria-label="卡片视图" @click="emit('viewMode', 'grid')"><LayoutGrid :size="17" /></button><button :class="{ active: viewMode === 'list' }" title="列表视图" aria-label="列表视图" @click="emit('viewMode', 'list')"><List :size="18" /></button></div>
      </div>
    </section>
    <div v-if="search || filterCount" class="filter-summary">
      <span>找到 {{ matches.length.toLocaleString() }} 条资料</span
      ><button class="text-button" @click="clearFilters">
        <X :size="12" />清除条件
      </button>
    </div>
    <div v-if="pageEntries.length" class="catalog-scroll">
      <div v-if="viewMode === 'grid'" class="entry-grid">
        <article
          v-for="entry in pageEntries"
          :key="entry.id"
          class="entry-card"
          :data-entry-id="entry.id"
          tabindex="0"
          role="button"
          :aria-label="`查看${entry.name}`"
          @click="emit('inspect', entry)"
          @keydown.enter.self.prevent="emit('inspect', entry)"
          @keydown.space.self.prevent="emit('inspect', entry)"
        >
          <div class="card-primary">
            <EntryArtwork :entry="entry" />
            <div class="card-name">
              <h2>{{ entry.name }}</h2>
              <p>{{ entry.subtitle || categoryLabels[entry.category] }}</p>
              <span v-if="entry.rarity" class="rarity-label">{{
                entry.rarity
              }}</span>
            </div>
            <ArrowUpRight class="card-open" :size="16" />
          </div>
          <p class="card-description">
            {{
              entry.description ||
              entry.sections[0]?.body ||
              "暂无简介，打开资料查看详情或补充内容。"
            }}
          </p>
          <div class="card-tags">
            <span
              v-if="entry.element"
              class="element-tag"
              :data-element="entry.element"
              ><DictionaryBadge :entries="entries" :value="entry.element" type="属性" /></span
            ><span v-if="entry.profession" class="neutral-tag"><DictionaryBadge :entries="entries" :value="entry.profession" type="职业" /></span
            ><span
              v-for="tag in entry.tags
                .filter(
                  (tag) => tag !== entry.element && tag !== entry.profession,
                )
                .slice(0, 2)"
              :key="tag"
              class="neutral-tag"
              ><DictionaryBadge :entries="entries" :value="tag" type="队伍效应" /></span
            >
          </div>
          <footer class="card-footer">
            <span
              class="entry-status"
              :class="{
                customized: entry.modified || entry.origin === 'local',
                retired: entry.retired,
              }"
              ><span class="status-dot" />{{
                entry.retired
                  ? "来源已移除"
                  : entry.origin === "local"
                    ? "本地新增"
                    : entry.modified
                      ? "本地修改"
                      : "来源资料"
              }}</span
            ><button
              v-if="trash"
              class="inline-icon"
              title="恢复资料"
              aria-label="恢复资料"
              :disabled="pending"
              @click.stop="emit('restore', entry)"
            >
              <ArchiveRestore :size="15" /></button
            ><button
              v-else
              class="inline-icon"
              title="编辑资料"
              aria-label="编辑资料"
              @click.stop="emit('edit', entry)"
            >
              <Pencil :size="14" />
            </button>
          </footer>
        </article>
      </div>
      <div v-else class="entry-list" role="list">
        <div class="list-labels">
          <span>资料名称</span><span>分类信息</span><span>状态</span><span />
        </div>
        <article
          v-for="entry in pageEntries"
          :key="entry.id"
          class="entry-row"
          :data-entry-id="entry.id"
          tabindex="0"
          role="button"
          :aria-label="`查看${entry.name}`"
          @click="emit('inspect', entry)"
          @keydown.enter.self.prevent="emit('inspect', entry)"
        >
          <div class="row-identity">
            <EntryArtwork :entry="entry" small />
            <div>
              <h2>{{ entry.name }}</h2>
              <p>
                {{
                  entry.subtitle ||
                  entry.description ||
                  categoryLabels[entry.category]
                }}
              </p>
            </div>
          </div>
          <div class="row-tags">
            <span
              v-if="entry.element"
              class="element-tag"
              :data-element="entry.element"
              ><DictionaryBadge :entries="entries" :value="entry.element" type="属性" /></span
            ><span class="neutral-tag">{{
              entry.profession || entry.rarity || categoryLabels[entry.category]
            }}</span>
          </div>
          <span
            class="entry-status"
            :class="{
              customized: entry.modified || entry.origin === 'local',
              retired: entry.retired,
            }"
            >{{
              entry.retired
                ? "来源已移除"
                : entry.origin === "local"
                  ? "本地新增"
                  : entry.modified
                    ? "本地修改"
                    : "来源资料"
            }}</span
          >
          <button
            class="inline-icon"
            :title="trash ? '恢复资料' : '编辑资料'"
            :aria-label="trash ? '恢复资料' : '编辑资料'"
            :disabled="pending"
            @click.stop="trash ? emit('restore', entry) : emit('edit', entry)"
          >
            <RotateCcw v-if="trash" :size="15" /><Pencil v-else :size="15" />
          </button>
        </article>
      </div>
    </div>
    <div v-else class="empty-state">
      <Inbox :size="35" :stroke-width="1.4" />
      <h2>
        {{
          awaitingInitialSync
            ? "尚未同步基础资料"
            : search || filterCount
              ? "没有符合条件的资料"
              : trash
                ? "回收站是空的"
                : "这个分类还没有资料"
        }}
      </h2>
      <p>
        {{
          awaitingInitialSync
            ? "先到同步中心获取资料，也可以新增自己的记录。"
            : search || filterCount
              ? "试试其他名称、别名，或清除筛选条件。"
              : trash
                ? "移至回收站的资料可以在这里恢复。"
                : "可以新增条目，或到同步中心获取基础资料。"
        }}
      </p>
      <n-button
        v-if="!awaitingInitialSync && (search || filterCount)"
        @click="clearFilters"
        >清除筛选</n-button
      ><n-button v-else-if="!trash" @click="emit('sync')"
        >前往同步中心</n-button
      >
    </div>
    <footer v-if="matches.length" class="pagination-bar">
      <span
        >共 {{ matches.length.toLocaleString() }} 条<span class="muted">
          · {{ trash ? "回收站" : "本地可用" }}</span
        ></span
      ><n-pagination
        v-model:page="page"
        v-model:page-size="pageSize"
        :item-count="matches.length"
        :page-sizes="[24, 48, 96]"
        show-size-picker
        :page-slot="5"
      />
    </footer>
  </section>
</template>
