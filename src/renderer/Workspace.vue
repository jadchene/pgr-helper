<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { NButton, NSpin, useDialog, useMessage } from "naive-ui";
import {
  BookMarked,
  Minus,
  Square,
  X,
  RefreshCw,
  Settings2,
  Trash2,
  ChevronRight,
  AlertCircle,
  BookOpen,
} from "lucide-vue-next";
import {
  categories,
  categoryLabels,
  type AppSettings,
  type AppState,
  type CatalogEntry,
  type Category,
  type EntryView,
  type SyncPreview,
  type SyncProgress,
  type VersionInfo,
} from "../shared/types";
import { categoryMeta, displayVersion, errorMessage, newEntry } from "./ui";
import CatalogPage from "./components/CatalogPage.vue";
import EntryDetail from "./components/EntryDetail.vue";
import EntryEditor from "./components/EntryEditor.vue";
import SyncPage from "./components/SyncPage.vue";
import SettingsPage from "./components/SettingsPage.vue";
import GuidesPage from "./components/GuidesPage.vue";

defineProps<{ isDark: boolean }>();
const emit = defineEmits<{ themeChange: [theme: AppSettings["theme"]]; fontChange: [family: string] }>();
const message = useMessage();
const dialog = useDialog();
const state = ref<AppState | null>(null);
const loading = ref(true);
const bootError = ref("");
/** 工作台侧栏对应的列表及管理页面。 */
type WorkspaceRoute = Category | "sync" | "settings" | "trash" | "guides";
const route = ref<WorkspaceRoute>("character");
const selectedId = ref("");
const selectedEntry = computed(
  () =>
    state.value?.entries.find((entry) => entry.id === selectedId.value) || null,
);
const editor = ref<CatalogEntry | EntryView | null>(null);
const editorNew = ref(false);
const editorDirty = ref(false);
const guideDirty = ref(false);
const guidePending = ref(false);
const guideRequest = ref<{ token: number; stageId?: string; guideId?: string; create?: boolean }>({ token: 0 });
const pending = ref(false);
const backupOperation = ref<"" | "export" | "import">("");
const syncBusy = ref(false);
const syncProgress = ref<SyncProgress>({
  busy: false,
  message: "",
  completed: 0,
  total: 0,
});
const preview = ref<SyncPreview | null>(null);
const syncError = ref("");
const counts = computed(() =>
  Object.fromEntries(
    categories.map((category) => [
      category,
      state.value?.entries.filter(
        (entry) => entry.category === category && !entry.hidden,
      ).length || 0,
    ]),
  ),
);
const trashCount = computed(
  () => state.value?.entries.filter((entry) => entry.hidden).length || 0,
);
const activeCategory = computed(() =>
  categories.includes(route.value as Category)
    ? (route.value as Category)
    : null,
);
/** 详情关联跳转始终保留首次进入的列表位置。 */
let listPosition: { route: WorkspaceRoute; scrollTop: number; entryId: string } | null = null;
/** 在隐藏列表之前记录位置，避免布局变化后丢失滚动高度。 */
const rememberListPosition = (entryId: string) => {
  listPosition = { route: route.value, scrollTop: document.querySelector<HTMLElement>('.catalog-scroll')?.scrollTop || 0, entryId };
};
/** 关联详情只替换当前正文，不改变返回时的分类和列表条件。 */
const inspectEntry = (entry: EntryView) => {
  if (!selectedId.value) rememberListPosition(entry.id);
  selectedId.value = entry.id;
};
/** 恢复原列表滚动和卡片焦点；条目已不可见时聚焦搜索框。 */
const returnToList = async () => {
  const previous = listPosition;
  selectedId.value = '';
  listPosition = null;
  await nextTick();
  if (selectedId.value || !previous || previous.route !== route.value) return;
  const card = [...document.querySelectorAll<HTMLElement>('.catalog-page [data-entry-id]')].find(element => element.dataset.entryId === previous.entryId);
  (card ?? document.querySelector<HTMLInputElement>('.catalog-search input'))?.focus({ preventScroll: true });
  const scroll = document.querySelector<HTMLElement>('.catalog-scroll');
  if (scroll) scroll.scrollTop = previous.scrollTop;
};
/** 显式侧栏导航退出详情；再次点击当前分类也返回列表。 */
const navigateDirect = (destination: WorkspaceRoute) => {
  if (destination === route.value && selectedId.value) {
    void returnToList();
    return;
  }
  listPosition = null;
  selectedId.value = '';
  route.value = destination;
};
/** 离开攻略编辑时明确处理尚未保存的配置。 */
const navigate = (destination: WorkspaceRoute) => {
  if (guidePending.value) { message.info('正在保存攻略，请稍候。'); return; }
  const finish = () => {
    if (destination === 'guides') guideRequest.value = { token: guideRequest.value.token + 1 };
    navigateDirect(destination);
  };
  if (guideDirty.value) {
    dialog.warning({ title: '放弃未保存的攻略修改？', content: '本次配置和流程修改尚未保存。', positiveText: '放弃修改', negativeText: '继续编辑', onPositiveClick: () => { guideDirty.value = false; finish(); } });
    return;
  }
  finish();
};
/** 从副本详情直接关联新攻略，或打开已经关联的攻略。 */
const openStageGuide = (request: { stageId?: string; guideId?: string; create?: boolean }) => {
  guideRequest.value = { ...request, token: guideRequest.value.token + 1 };
  navigateDirect('guides');
};
/** 攻略业务完成后刷新工作台计数和副本关联。 */
const refreshGuides = async () => {
  try { acceptState(await window.desktop.getState()); }
  catch (failure) { message.error(errorMessage(failure)); }
};
let progressTimer: ReturnType<typeof setInterval> | undefined;
let progressPolling = false;
let disposed = false;
let allowClose = false;
let closeDialogOpen = false;
watch(
  () => state.value?.settings.theme,
  (theme) => {
    if (theme) emit("themeChange", theme);
  },
);
watch(() => state.value?.settings.fontFamily, (family) => {
  if (family !== undefined) emit("fontChange", family);
});

/** 应用完整状态，同时保留仍有效的详情选中项。 */
const acceptState = (value: AppState) => {
  state.value = value;
  if (
    selectedId.value &&
    !value.entries.some((entry) => entry.id === selectedId.value)
  )
    void returnToList();
};
/** 首次使用进入同步中心等待手动操作，已有版本才按偏好检查更新。 */
const bootstrap = async () => {
  loading.value = true;
  bootError.value = "";
  try {
    const value = await window.desktop.getState();
    acceptState(value);
    if (!value.currentVersion) route.value = "sync";
    else if (value.settings.checkOnStartup) void prepareSync(true);
  } catch (failure) {
    bootError.value = errorMessage(failure);
  } finally {
    loading.value = false;
  }
};
/** 保存设置后刷新界面，失败时保留上次有效设置。 */
const saveSettings = async (patch: Partial<AppSettings>) => {
  if (!state.value || pending.value) return;
  pending.value = true;
  try {
    const settings = { ...state.value.settings, ...patch };
    acceptState(
      await window.desktop.saveSettings(JSON.parse(JSON.stringify(settings))),
    );
    if ("sources" in patch || "activeSourceId" in patch) preview.value = null;
  } catch (failure) {
    message.error(errorMessage(failure));
  } finally {
    pending.value = false;
  }
};
/** 在当前分类创建独立的本地资料草稿。 */
const createEntry = () => {
  if (pending.value) return;
  editor.value = newEntry(activeCategory.value || "character");
  editorNew.value = true;
};
/** 打开编辑器，由编辑器维护独立副本。 */
const editEntry = (entry: EntryView) => {
  if (pending.value) return;
  editor.value = entry;
  editorNew.value = false;
};
/** 保存资料后刷新列表，并定位到真实保存结果。 */
const saveEntry = async (entry: CatalogEntry) => {
  if (pending.value) return;
  pending.value = true;
  const editingDetail = !!selectedId.value;
  try {
    const saved = await window.desktop.saveEntry(
      JSON.parse(JSON.stringify(entry)),
    );
    acceptState(await window.desktop.getState());
    editor.value = null;
    if (!editingDetail) {
      if (route.value !== saved.category) navigate(saved.category);
      await nextTick();
    }
    inspectEntry(saved);
    message.success("资料已保存。");
  } catch (failure) {
    message.error(errorMessage(failure));
  } finally {
    pending.value = false;
  }
};
/** 撤销软删除并刷新本地状态。 */
const restoreEntry = async (entry: EntryView) => {
  if (pending.value) return;
  pending.value = true;
  try {
    await window.desktop.restoreEntry(entry.id);
    acceptState(await window.desktop.getState());
    message.success(`已恢复“${entry.name}”。`);
  } catch (failure) {
    message.error(errorMessage(failure));
  } finally {
    pending.value = false;
  }
};
/** 确认后将条目移至可恢复的回收站。 */
const deleteEntry = (entry: EntryView) => {
  if (pending.value) return;
  let deleted = false;
  const sourceRoute = route.value;
  dialog.warning({
    title: "移至回收站？",
    content: `“${entry.name}”将从资料列表中隐藏，之后可以在回收站恢复。`,
    positiveText: "移至回收站",
    negativeText: "取消",
    onPositiveClick: async () => {
      pending.value = true;
      try {
        await window.desktop.deleteEntry(entry.id);
        acceptState(await window.desktop.getState());
        await returnToList();
        deleted = true;
        message.success("资料已移至回收站。");
      } catch (failure) {
        message.error(errorMessage(failure));
        return false;
      } finally {
        pending.value = false;
      }
    },
    onAfterLeave: () => {
      // 确认框释放焦点锁后，再把焦点交回删除操作所在的列表。
      if (deleted && route.value === sourceRoute && !selectedId.value) document.querySelector<HTMLInputElement>('.catalog-search input')?.focus({ preventScroll: true });
    },
  });
};
/** 明确提示整条覆盖范围后恢复当前源内容。 */
const resetEntry = (entry: EntryView) => {
  if (pending.value) return;
  dialog.warning({
    title: "恢复整条来源内容？",
    content: `将清除“${entry.name}”的全部本地字段修改，恢复为当前基础资料版本中的内容。`,
    positiveText: "恢复源内容",
    negativeText: "保留修改",
    onPositiveClick: async () => {
      pending.value = true;
      try {
        await window.desktop.resetEntry(entry.id);
        acceptState(await window.desktop.getState());
        message.success("已恢复当前版本的源内容。");
      } catch (failure) {
        message.error(errorMessage(failure));
        return false;
      } finally {
        pending.value = false;
      }
    },
  });
};
/** 下载与校验在后台准备，只有明确启用时才替换当前基础资料。 */
const prepareSync = async (startup = false) => {
  if (!state.value || syncBusy.value || pending.value) return;
  syncBusy.value = true;
  syncError.value = "";
  preview.value = null;
  syncProgress.value = {
    busy: true,
    message: "正在连接数据来源…",
    completed: 0,
    total: 0,
  };
  try {
    const result = await window.desktop.prepareSync(
      state.value.settings.activeSourceId,
    );
    if (disposed) return;
    preview.value = result;
    if (startup && result.added + result.changed + result.removed > 0)
      message.info("基础资料有更新，可到同步中心查看预览。", {
        duration: 6000,
      });
  } catch (failure) {
    syncError.value = errorMessage(failure);
    if (startup) message.warning("启动检查未完成，可在同步中心查看详情。");
  } finally {
    syncBusy.value = false;
    syncProgress.value.busy = false;
  }
};
/** 请求取消准备任务，等待主请求返回最终状态。 */
const cancelSync = async () => {
  try {
    await window.desktop.cancelSync();
    syncProgress.value.message = "正在取消，请稍候…";
  } catch (failure) {
    message.error(errorMessage(failure));
  }
};
/** 仅启用用户已查看的候选标识，防止重复提交。 */
const applySync = async () => {
  if (!preview.value || pending.value || syncBusy.value) return;
  pending.value = true;
  try {
    acceptState(await window.desktop.applySync(preview.value.token));
    preview.value = null;
    syncError.value = "";
    message.success("基础资料已更新，本地编辑已保留。");
  } catch (failure) {
    syncError.value = errorMessage(failure);
    message.error(syncError.value);
  } finally {
    pending.value = false;
  }
};
/** 确认后切换基础资料版本，保留本地编辑。 */
const rollback = (version: VersionInfo) => {
  if (pending.value || syncBusy.value) return;
  dialog.warning({
    title: "回退基础资料版本？",
    content: `将启用“${displayVersion(version.version) || version.revision.slice(0, 9)}”的基础资料。本地新增与编辑会保留。`,
    positiveText: "确认回退",
    negativeText: "取消",
    onPositiveClick: async () => {
      pending.value = true;
      try {
        acceptState(await window.desktop.rollback(version.id));
        preview.value = null;
        message.success("基础资料版本已回退。");
      } catch (failure) {
        message.error(errorMessage(failure));
        return false;
      } finally {
        pending.value = false;
      }
    },
  });
};
/** 备份操作由工作台持有，切换页面后仍能完成并释放操作锁。 */
const exportBackup = async () => {
  if (pending.value || backupOperation.value) return;
  pending.value = true;
  backupOperation.value = "export";
  try {
    const path = await window.desktop.exportBackup();
    if (path) message.success("备份已导出。");
  } catch (failure) {
    message.error(errorMessage(failure));
  } finally {
    backupOperation.value = "";
    pending.value = false;
  }
};
/** 先说明恢复范围；恢复后的状态刷新不依赖设置页是否仍然挂载。 */
const importBackup = () => {
  if (pending.value || backupOperation.value || syncBusy.value) return;
  dialog.warning({
    title: "从备份恢复资料？",
    content:
      "恢复会替换当前的基础资料、攻略、本地编辑和设置。应用会先自动备份当前数据库，再恢复你选择的文件。",
    positiveText: "选择备份文件",
    negativeText: "取消",
    onPositiveClick: async () => {
      if (pending.value || syncBusy.value) return false;
      pending.value = true;
      backupOperation.value = "import";
      try {
        const value = await window.desktop.importBackup();
        if (value) {
          acceptState(value);
          preview.value = null;
          selectedId.value = "";
          message.success("备份已恢复。");
        }
      } catch (failure) {
        message.error(errorMessage(failure));
      } finally {
        backupOperation.value = "";
        pending.value = false;
      }
    },
  });
};
/** 通过受限桥接执行窗口动作并报告真实错误。 */
const windowAction = async (action: "minimize" | "maximize" | "close") => {
  try {
    await window.desktop.windowAction(action);
  } catch (failure) {
    message.error(errorMessage(failure));
  }
};
/** 退出前保护正在保存及尚未保存的表单内容。 */
const requestClose = () => {
  if (pending.value || guidePending.value) {
    message.info("正在保存，请稍候。");
    return;
  }
  if (editorDirty.value || guideDirty.value) {
    if (closeDialogOpen) return;
    closeDialogOpen = true;
    dialog.warning({
      title: "放弃修改并退出？",
      content: "尚未保存的内容会丢失。",
      positiveText: "放弃并退出",
      negativeText: "继续编辑",
      onPositiveClick: () => {
        allowClose = true;
        void windowAction("close");
      },
      onAfterLeave: () => {
        closeDialogOpen = false;
      },
    });
  } else {
    allowClose = true;
    void windowAction("close");
  }
};
/** 原生关闭同样经过未保存检查，确认后允许第二次关闭。 */
const beforeUnload = (event: BeforeUnloadEvent) => {
  if (!allowClose && (editorDirty.value || guideDirty.value || pending.value || guidePending.value)) {
    event.preventDefault();
    event.returnValue = "";
    requestClose();
  }
};
/** 提供搜索、新增与关闭快捷键，编辑期间不触发新增。 */
const keyboard = async (event: KeyboardEvent) => {
  if (event.key === 'Escape' && selectedEntry.value && !editor.value && !document.querySelector('.n-dialog')) {
    event.preventDefault();
    await returnToList();
    return;
  }
  if (!(event.ctrlKey || event.metaKey)) return;
  if (event.key.toLowerCase() === "w") {
    event.preventDefault();
    requestClose();
  }
  if (editor.value) return;
  if (event.key.toLowerCase() === "k") {
    event.preventDefault();
    if (selectedEntry.value) await returnToList();
    document.querySelector<HTMLInputElement>(".catalog-search input")?.focus();
  }
  if (event.key.toLowerCase() === "n" && activeCategory.value) {
    event.preventDefault();
    createEntry();
  }
};
onMounted(() => {
  void bootstrap();
  window.addEventListener("keydown", keyboard);
  window.addEventListener("beforeunload", beforeUnload);
  progressTimer = setInterval(async () => {
    if (!syncBusy.value || progressPolling) return;
    progressPolling = true;
    try {
      const result = await window.desktop.getSyncProgress();
      if (syncBusy.value && !disposed) syncProgress.value = result;
    } catch {
      /* 主同步请求负责呈现错误；轮询失败不覆盖现有进度。 */
    } finally {
      progressPolling = false;
    }
  }, 700);
});
onUnmounted(() => {
  disposed = true;
  if (progressTimer) clearInterval(progressTimer);
  window.removeEventListener("keydown", keyboard);
  window.removeEventListener("beforeunload", beforeUnload);
});
</script>

<template>
  <div class="app-shell">
    <header class="titlebar">
      <div class="titlebar-name">
        <BookMarked :size="14" /><span>战双助手</span
        ><span class="titlebar-divider" />资料与攻略
      </div>
      <div class="window-controls">
        <button
          aria-label="最小化"
          title="最小化"
          @click="windowAction('minimize')"
        >
          <Minus :size="15" /></button
        ><button
          aria-label="最大化或还原"
          title="最大化或还原"
          @click="windowAction('maximize')"
        >
          <Square :size="12" /></button
        ><button
          class="window-close"
          aria-label="关闭窗口"
          title="关闭"
          @click="requestClose"
        >
          <X :size="17" />
        </button>
      </div>
    </header>
    <div v-if="loading" class="boot-state">
      <n-spin :size="30" />
      <p>正在打开本地资料…</p>
    </div>
    <div v-else-if="bootError" class="boot-state">
      <AlertCircle :size="32" />
      <h2>暂时无法打开资料库</h2>
      <p>{{ bootError }}</p>
      <n-button @click="bootstrap">重新加载</n-button>
    </div>
    <div v-else-if="state" class="workspace-body">
      <aside class="sidebar">
        <div class="brand">
          <div class="brand-icon"><BookMarked :size="23" /></div>
          <div><strong>战双助手</strong><span>资料查询与配队攻略</span></div>
        </div>
        <div class="sidebar-label">基础资料</div>
        <nav class="category-nav" aria-label="资料分类">
          <button
            v-for="category in categories"
            :key="category"
            :class="['nav-item', { active: route === category }]"
            @click="navigate(category)"
          >
            <component :is="categoryMeta[category].icon" :size="17" /><span>{{
              categoryLabels[category]
            }}</span
            ><small>{{ counts[category].toLocaleString() }}</small>
          </button>
        </nav>
        <div class="sidebar-label manage-label">攻略记录</div>
        <nav class="guide-nav" aria-label="攻略导航"><button :class="['nav-item', { active: route === 'guides' }]" @click="navigate('guides')"><BookOpen :size="17" /><span>副本攻略</span><small>{{ state.guides.filter(guide => !guide.hidden).length }}</small></button></nav>
        <div class="sidebar-label manage-label">资料管理</div>
        <nav class="utility-nav" aria-label="管理导航">
          <button
            :class="['nav-item', { active: route === 'sync' }]"
            @click="navigate('sync')"
          >
            <RefreshCw :size="17" :class="{ spin: syncBusy }" /><span
              >同步中心</span
            ><i
              v-if="preview || syncError"
              :class="['nav-indicator', { error: !!syncError }]"
            /></button
          ><button
            :class="['nav-item', { active: route === 'trash' }]"
            @click="navigate('trash')"
          >
            <Trash2 :size="17" /><span>回收站</span
            ><small v-if="trashCount">{{ trashCount }}</small></button
          ><button
            :class="['nav-item', { active: route === 'settings' }]"
            @click="navigate('settings')"
          >
            <Settings2 :size="17" /><span>设置</span>
          </button>
        </nav>
        <button class="sidebar-version" @click="navigate('sync')">
          <span
            class="version-dot"
            :class="{ waiting: !state.currentVersion }"
          />
          <div>
            <strong>{{
              state.currentVersion ? "资料已就绪" : "等待首次同步"
            }}</strong
            ><span>{{
              displayVersion(state.currentVersion?.version || "") ||
              "手动同步后可离线使用"
            }}</span>
          </div>
          <ChevronRight :size="14" />
        </button>
      </aside>
      <main class="main-content">
        <CatalogPage
          v-if="activeCategory || route === 'trash'"
          v-show="!selectedEntry"
          :active="!selectedEntry"
          :entries="state.entries"
          :category="activeCategory || 'all'"
          :has-source-data="!!state.currentVersion"
          :trash="route === 'trash'"
          :view-mode="state.settings.viewMode"
          :pending="pending"
          @inspect="inspectEntry"
          @edit="editEntry"
          @create="createEntry"
          @restore="restoreEntry"
          @view-mode="(value) => saveSettings({ viewMode: value })"
          @sync="navigate('sync')"
        />
        <EntryDetail
          v-if="selectedEntry"
          :key="selectedEntry.id"
          :entry="selectedEntry"
          :entries="state.entries"
          :guides="state.guides"
          :pending="pending"
          @close="returnToList"
          @edit="editEntry"
          @remove="deleteEntry"
          @restore="restoreEntry"
          @reset="resetEntry"
          @inspect="inspectEntry"
          @create-guide="(id) => openStageGuide({ stageId: id, create: true })"
          @open-guide="(id) => openStageGuide({ guideId: id })"
        /><SyncPage
          v-else-if="route === 'sync'"
          :state="state"
          :busy="syncBusy"
          :pending="pending"
          :progress="syncProgress"
          :preview="preview"
          :failure="syncError"
          @settings="saveSettings"
          @prepare="prepareSync()"
          @apply="applySync"
          @cancel="cancelSync"
          @rollback="rollback"
        /><SettingsPage
          v-else-if="route === 'settings'"
          :state="state"
          :pending="pending"
          :sync-busy="syncBusy"
          :backup-operation="backupOperation"
          @settings="saveSettings"
          @export-backup="exportBackup"
          @import-backup="importBackup"
        />
        <GuidesPage v-else-if="route === 'guides'" :entries="state.entries" :guides="state.guides" :request="guideRequest" @refresh="refreshGuides" @dirty="guideDirty = $event" @pending="guidePending = $event" />
      </main>
      <EntryEditor
        v-if="editor"
        :key="editor.id"
        :entry="editor"
        :entries="state.entries"
        :is-new="editorNew"
        :pending="pending"
        @save="saveEntry"
        @close="editor = null"
        @dirty="editorDirty = $event"
      />
    </div>
  </div>
</template>
