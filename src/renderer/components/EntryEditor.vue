<script setup lang="ts">
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, onUnmounted, ref, watch } from "vue";
import {
  NModal,
  NCard,
  NButton,
  NInput,
  NSelect,
  NDynamicTags,
  NTabs,
  NTabPane,
  NFormItem,
  NAlert,
  useDialog,
  useMessage,
} from "naive-ui";
import {
  X,
  Plus,
  Trash2,
  ImagePlus,
  Save,
  ChevronUp,
  ChevronDown,
} from "lucide-vue-next";
import {
  categories,
  categoryLabels,
  type CatalogEntry,
  type EntryView,
} from "../../shared/types";
import { errorMessage } from "../ui";
import EntryArtwork from "./EntryArtwork.vue";

const props = defineProps<{
  entry: CatalogEntry | EntryView;
  entries: EntryView[];
  pending: boolean;
  isNew: boolean;
}>();
const { renderCatalogLabel } = useCatalogSelectLabel(() => props.entries);
const emit = defineEmits<{
  close: [];
  save: [entry: CatalogEntry];
  dirty: [value: boolean];
}>();
const dialog = useDialog();
const message = useMessage();
const form = ref<CatalogEntry>(JSON.parse(JSON.stringify(props.entry)));
const attributes = ref(
  Object.entries(props.entry.attributes).map(([name, value]) => ({
    key: crypto.randomUUID(),
    name,
    value,
  })),
);
const sections = ref(
  props.entry.sections.map((section) => ({
    ...section,
    key: crypto.randomUUID(),
  })),
);
const activeTab = ref("basic");
const imagePending = ref(false);
const error = ref("");
const sourceEntry = computed(
  () => "origin" in props.entry && props.entry.origin === "source",
);
/** 对动态表单整体做快照，识别尚未保存的修改。 */
const serialize = () =>
  JSON.stringify({
    form: form.value,
    attributes: attributes.value,
    sections: sections.value,
  });
const initial = serialize();
const dirty = computed(() => serialize() !== initial);
const pending = computed(() => props.pending || imagePending.value);
watch(dirty, (value) => emit("dirty", value), { immediate: true });
onUnmounted(() => emit("dirty", false));
const categoryOptions = categories.map((value) => ({
  label: categoryLabels[value],
  value,
}));
const relationOptions = computed(() => {
  const options = props.entries
    .filter((entry) => entry.id !== form.value.id && !entry.hidden)
    .map((entry) => ({
      label: `${entry.name} · ${categoryLabels[entry.category]}`,
      value: entry.id,
    }));
  const ids = new Set(options.map((option) => option.value));
  for (const id of form.value.relatedIds)
    if (!ids.has(id))
      options.push({
        label: `${props.entries.find((entry) => entry.id === id)?.name || id} · 当前不可见`,
        value: id,
      });
  return options;
});
/** 关闭编辑前明确处理未保存内容。 */
const requestClose = () => {
  if (pending.value) return;
  if (!dirty.value) return emit("close");
  dialog.warning({
    title: "放弃本次修改？",
    content: "尚未保存的内容会丢失。",
    positiveText: "放弃修改",
    negativeText: "继续编辑",
    onPositiveClick: () => emit("close"),
  });
};
/** 读取可随备份迁移的本地图片数据。 */
const chooseImage = async () => {
  imagePending.value = true;
  try {
    const value = await window.desktop.chooseImage();
    if (value) form.value.image = value;
  } catch (failure) {
    message.error(errorMessage(failure));
  } finally {
    imagePending.value = false;
  }
};
/** 校验常用字段与动态属性，避免同名属性无声覆盖。 */
const save = () => {
  if (pending.value) return;
  error.value = "";
  if (!form.value.name.trim()) {
    activeTab.value = "basic";
    error.value = "请填写资料名称。";
    return;
  }
  const names = new Set<string>();
  for (const attr of attributes.value) {
    if (!attr.name.trim() && !attr.value.trim()) continue;
    if (!attr.name.trim()) {
      activeTab.value = "content";
      error.value = "请为每个属性填写名称。";
      return;
    }
    if (names.has(attr.name.trim())) {
      activeTab.value = "content";
      error.value = `属性“${attr.name.trim()}”重复，请合并或更名。`;
      return;
    }
    names.add(attr.name.trim());
  }
  for (const section of sections.value)
    if (section.body.trim() && !section.title.trim()) {
      activeTab.value = "content";
      error.value = "请为有内容的段落填写标题。";
      return;
    }
  emit("save", {
    id: form.value.id,
    category: form.value.category,
    sourceKey: form.value.sourceKey,
    catalog: form.value.catalog,
    guideOptions: form.value.guideOptions,
    name: form.value.name.trim(),
    subtitle: form.value.subtitle.trim(),
    description: form.value.description.trim(),
    aliases: [
      ...new Set(
        form.value.aliases.map((value) => value.trim()).filter(Boolean),
      ),
    ],
    tags: [
      ...new Set(form.value.tags.map((value) => value.trim()).filter(Boolean)),
    ],
    element: form.value.element.trim(),
    profession: form.value.profession.trim(),
    rarity: form.value.rarity.trim(),
    image: form.value.image,
    attributes: Object.fromEntries(
      attributes.value
        .filter((attr) => attr.name.trim())
        .map((attr) => [attr.name.trim(), attr.value.trim()]),
    ),
    sections: sections.value
      .filter((section) => section.title.trim() || section.body.trim())
      .map((section) => ({
        title: section.title.trim(),
        body: section.body.trim(),
        ...(section.skill ? { skill: JSON.parse(JSON.stringify(section.skill)) } : {}),
      })),
    relatedIds: [
      ...new Set(form.value.relatedIds.filter((id) => id !== form.value.id)),
    ],
  });
};
/** 调整正文段落的展示顺序。 */
const moveSection = (index: number, offset: number) => {
  const to = index + offset;
  if (to < 0 || to >= sections.value.length) return;
  const [section] = sections.value.splice(index, 1);
  sections.value.splice(to, 0, section);
};
/** 添加具有稳定表单键的属性行。 */
const addAttribute = () =>
  attributes.value.push({ key: crypto.randomUUID(), name: "", value: "" });
/** 添加具有稳定表单键的正文段落。 */
const addSection = () =>
  sections.value.push({ key: crypto.randomUUID(), title: "", body: "" });
</script>

<template>
  <n-modal
    :show="true"
    :mask-closable="false"
    :close-on-esc="!pending"
    @esc="requestClose"
  >
    <n-card
      class="editor-modal"
      :bordered="false"
      role="dialog"
      aria-modal="true"
      :aria-label="isNew ? '新增资料' : '编辑资料'"
      @keydown.ctrl.enter.prevent="save"
    >
      <div class="editor-top">
        <div>
          <h2>{{ isNew ? "新增资料" : "编辑资料" }}</h2>
          <p>
            {{
              sourceEntry
                ? "修改会保存在本地，资料更新时会保留你的编辑。"
                : "补充你的资料，随时可以继续完善。"
            }}
          </p>
        </div>
        <button
          class="inline-icon"
          aria-label="关闭编辑"
          title="关闭"
          :disabled="pending"
          @click="requestClose"
        >
          <X :size="20" />
        </button>
      </div>
      <n-alert
        v-if="error"
        type="error"
        :bordered="false"
        class="editor-error"
        closable
        @close="error = ''"
        >{{ error }}</n-alert
      >
      <n-tabs
        v-model:value="activeTab"
        class="editor-tabs"
        type="line"
        animated
      >
        <n-tab-pane name="basic" tab="基本信息">
          <div class="editor-scroll">
            <div class="image-editor">
              <EntryArtwork :entry="form" />
              <div>
                <n-button
                  size="small"
                  :loading="imagePending"
                  :disabled="pending"
                  @click="chooseImage"
                  ><template #icon><ImagePlus :size="15" /></template
                  >{{ form.image ? "更换图片" : "添加图片" }}</n-button
                ><n-button
                  v-if="form.image"
                  size="small"
                  quaternary
                  :disabled="pending"
                  @click="form.image = ''"
                  >移除</n-button
                >
                <p>选择本地图片；没有图片时显示分类图标。</p>
              </div>
            </div>
            <div class="form-two">
              <n-form-item label="名称" required
                ><n-input
                  v-model:value="form.name"
                  placeholder="例如：露西亚·深红囚影"
                  :maxlength="120"
                  show-count
                  autofocus
                  :disabled="pending" /></n-form-item
              ><n-form-item label="分类"
                ><n-select
                  v-model:value="form.category"
                  :options="categoryOptions"
                  :disabled="sourceEntry || pending"
              /></n-form-item>
            </div>
            <n-form-item label="副标题"
              ><n-input
                v-model:value="form.subtitle"
                placeholder="简短说明，如所属系列或定位"
                :disabled="pending"
            /></n-form-item>
            <n-form-item label="简介"
              ><n-input
                v-model:value="form.description"
                type="textarea"
                :autosize="{ minRows: 3, maxRows: 7 }"
                placeholder="用几句话描述这条资料"
                :disabled="pending"
            /></n-form-item>
            <div class="form-three">
              <n-form-item label="属性"
                ><n-input
                  v-model:value="form.element"
                  placeholder="如雷、物理"
                  :disabled="pending" /></n-form-item
              ><n-form-item label="职业"
                ><n-input
                  v-model:value="form.profession"
                  placeholder="如进攻型"
                  :disabled="pending" /></n-form-item
              ><n-form-item label="品级"
                ><n-input
                  v-model:value="form.rarity"
                  placeholder="如 S、六星"
                  :disabled="pending"
              /></n-form-item>
            </div>
            <n-form-item label="别名"
              ><div class="tag-editor">
                <n-dynamic-tags
                  v-model:value="form.aliases"
                  :disabled="pending"
                />
                <p>添加简称或常用称呼，可通过这些名称搜索。</p>
              </div></n-form-item
            >
            <n-form-item label="标签"
              ><n-dynamic-tags v-model:value="form.tags" :disabled="pending"
            /></n-form-item>
          </div>
        </n-tab-pane>
        <n-tab-pane
          name="content"
          :tab="`属性与正文${attributes.length + sections.length ? ` (${attributes.length + sections.length})` : ''}`"
        >
          <div class="editor-scroll">
            <div class="section-toolbar">
              <div>
                <h3>属性</h3>
                <p>例如专武、对应机体、数据来源。</p>
              </div>
              <n-button size="small" :disabled="pending" @click="addAttribute"
                ><template #icon><Plus :size="14" /></template
                >添加属性</n-button
              >
            </div>
            <div
              v-for="(attr, index) in attributes"
              :key="attr.key"
              class="attribute-editor"
            >
              <n-input
                v-model:value="attr.name"
                placeholder="属性名称"
                :disabled="pending"
                :aria-label="`第${index + 1}个属性名称`"
              /><n-input
                v-model:value="attr.value"
                placeholder="属性值"
                type="textarea"
                :autosize="{ minRows: 1, maxRows: 5 }"
                :disabled="pending"
                :aria-label="`第${index + 1}个属性值`"
              /><button
                class="inline-icon danger"
                title="删除属性"
                aria-label="删除属性"
                :disabled="pending"
                @click="attributes.splice(index, 1)"
              >
                <Trash2 :size="15" />
              </button>
            </div>
            <div v-if="!attributes.length" class="inline-empty">
              还没有属性，可以按需要添加。
            </div>
            <div class="section-toolbar spaced">
              <div>
                <h3>正文段落</h3>
                <p>分别记录技能、套装效果或使用备注。</p>
              </div>
              <n-button size="small" :disabled="pending" @click="addSection"
                ><template #icon><Plus :size="14" /></template
                >添加段落</n-button
              >
            </div>
            <div
              v-for="(section, index) in sections"
              :key="section.key"
              class="section-editor"
            >
              <p v-if="section.skill" class="field-help">
                {{ section.skill.groupName }} · {{ section.skill.typeName }}
                <template v-if="section.skill.element"> · {{ section.skill.element.name }}</template>
                <template v-if="section.skill.level !== undefined"> · Lv.{{ section.skill.level }}</template>
              </p>
              <div class="section-editor-heading">
                <n-input
                  v-model:value="section.title"
                  placeholder="段落标题，例如核心被动"
                  :disabled="pending"
                  :aria-label="`第${index + 1}段标题`"
                /><button
                  class="inline-icon"
                  title="上移"
                  aria-label="上移段落"
                  :disabled="pending || index === 0"
                  @click="moveSection(index, -1)"
                >
                  <ChevronUp :size="16" /></button
                ><button
                  class="inline-icon"
                  title="下移"
                  aria-label="下移段落"
                  :disabled="pending || index === sections.length - 1"
                  @click="moveSection(index, 1)"
                >
                  <ChevronDown :size="16" /></button
                ><button
                  class="inline-icon danger"
                  title="删除段落"
                  aria-label="删除段落"
                  :disabled="pending"
                  @click="sections.splice(index, 1)"
                >
                  <Trash2 :size="15" />
                </button>
              </div>
              <n-input
                v-model:value="section.body"
                type="textarea"
                :autosize="{ minRows: 4, maxRows: 14 }"
                placeholder="填写正文，支持换行"
                :disabled="pending"
                :aria-label="`第${index + 1}段正文`"
              />
            </div>
            <div v-if="!sections.length" class="inline-empty">
              还没有正文段落。
            </div>
          </div>
        </n-tab-pane>
        <n-tab-pane
          name="relations"
          :tab="`关联资料${form.relatedIds.length ? ` (${form.relatedIds.length})` : ''}`"
          ><div class="editor-scroll">
            <div class="section-toolbar">
              <div>
                <h3>关联条目</h3>
                <p>把机体与专武、意识、辅助机或副本连接起来。</p>
              </div>
            </div>
            <n-select
              v-model:value="form.relatedIds"
              multiple
              filterable
              :options="relationOptions" :render-label="renderCatalogLabel"
              placeholder="搜索并选择关联资料"
              :disabled="pending"
            />
            <p class="field-help">
              选择后可在详情中直接跳转。不会自动更改对方资料。
            </p>
          </div></n-tab-pane
        >
      </n-tabs>
      <footer class="editor-footer">
        <span class="muted"
          >{{ dirty ? "有未保存的修改" : "尚未修改"
          }}<kbd>Ctrl Enter 保存</kbd></span
        >
        <div>
          <n-button :disabled="pending" @click="requestClose">取消</n-button
          ><n-button type="primary" :loading="pending" @click="save"
            ><template #icon><Save :size="15" /></template>保存资料</n-button
          >
        </div>
      </footer>
    </n-card>
  </n-modal>
</template>
