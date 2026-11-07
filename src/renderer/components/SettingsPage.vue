<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from "vue";
import { NAlert, NButton, NSelect, NSwitch, useMessage } from "naive-ui";
import {
  Monitor,
  Sun,
  Moon,
  FolderOpen,
  Download,
  Upload,
  Database,
  ExternalLink,
  BookMarked,
  RefreshCw,
  Type,
} from "lucide-vue-next";
import type {
  AppSettings,
  AppState,
  SystemFontFamily,
} from "../../shared/types";
import { errorMessage } from "../ui";
import { fontFamilyCss } from "../font-family";

const props = defineProps<{
  state: AppState;
  pending: boolean;
  syncBusy: boolean;
  backupOperation: "" | "export" | "import";
}>();
const emit = defineEmits<{
  settings: [value: Partial<AppSettings>];
  exportBackup: [];
  importBackup: [];
}>();
const message = useMessage();
const fonts = ref<SystemFontFamily[]>([]);
const fontsLoading = ref(false);
const fontsLoaded = ref(false);
const fontFailure = ref("");
let disposed = false;
const selectedFont = computed(() => props.state.settings.fontFamily);
const fontUnavailable = computed(
  () =>
    fontsLoaded.value &&
    !!selectedFont.value &&
    !fonts.value.some((font) => font.family === selectedFont.value),
);
const fontOptions = computed(() => {
  const options = [
    { label: "系统默认", value: "" },
    ...fonts.value.map((font) => ({ label: font.label, value: font.family })),
  ];
  if (
    selectedFont.value &&
    !fonts.value.some((font) => font.family === selectedFont.value)
  )
    options.push({ label: selectedFont.value, value: selectedFont.value });
  return options;
});
const currentFontLabel = computed(
  () =>
    fonts.value.find((font) => font.family === selectedFont.value)?.label ||
    selectedFont.value ||
    "系统默认",
);
const themes = [
  { value: "system" as const, name: "跟随系统", icon: Monitor },
  { value: "light" as const, name: "浅色", icon: Sun },
  { value: "dark" as const, name: "深色", icon: Moon },
];
/** 异步读取本机字体；离开页面后不更新已卸载组件，失败可再次请求。 */
const loadFonts = async () => {
  if (fontsLoading.value) return;
  fontsLoading.value = true;
  fontFailure.value = "";
  try {
    const result = await window.desktop.listSystemFonts();
    if (!disposed) {
      fonts.value = result;
      fontsLoaded.value = true;
    }
  } catch (failure) {
    if (!disposed) fontFailure.value = errorMessage(failure);
  } finally {
    if (!disposed) fontsLoading.value = false;
  }
};
onMounted(() => {
  void loadFonts();
});
onUnmounted(() => {
  disposed = true;
});
/** 在文件管理器中定位应用数据目录。 */
const openDirectory = async () => {
  try {
    await window.desktop.openDataDirectory();
  } catch (failure) {
    message.error(errorMessage(failure));
  }
};
/** 打开资料来源主页。 */
const openProject = async () => {
  try {
    await window.desktop.openExternal("https://github.com/myssal/PGR_Data");
  } catch (failure) {
    message.error(errorMessage(failure));
  }
};
/** 分区导航只滚动设置正文，保持顶部操作位置。 */
const jumpTo = (id: string): void => { document.getElementById(`settings-${id}`)?.scrollIntoView({ block: 'start' }); };
</script>

<template>
  <section class="page-layout settings-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">工作台</div>
        <h1>设置</h1>
        <p>调整外观、更新偏好与本地数据。</p>
      </div>
    </header>
    <nav class="settings-jump" aria-label="设置分区"><button @click="jumpTo('appearance')">外观与字体</button><button @click="jumpTo('updates')">更新偏好</button><button @click="jumpTo('data')">数据与备份</button><button @click="jumpTo('about')">关于</button></nav>
    <div class="settings-scroll">
      <section id="settings-appearance" class="panel">
        <div class="panel-heading">
          <div>
            <h2>外观</h2>
            <p>选择适合你的阅读主题。</p>
          </div>
        </div>
        <div class="theme-options">
          <button
            v-for="theme in themes"
            :key="theme.value"
            :class="[
              'theme-option',
              { selected: state.settings.theme === theme.value },
            ]"
            :disabled="pending"
            :aria-pressed="state.settings.theme === theme.value"
            @click="emit('settings', { theme: theme.value })"
          >
            <div :class="['theme-miniature', theme.value]">
              <div />
              <div><span /><span /><span /></div>
            </div>
            <span
              ><component :is="theme.icon" :size="15" />{{ theme.name
              }}<i v-if="state.settings.theme === theme.value"
            /></span>
          </button>
        </div>
      </section>
      <section class="panel font-panel">
        <div class="panel-heading">
          <div>
            <h2><Type :size="16" />界面字体</h2>
            <p>选择本机字体，自动保存并应用到整个工作台。</p>
          </div>
          <n-button
            size="small"
            :loading="fontsLoading"
            :disabled="fontsLoading"
            @click="loadFonts"
            ><template #icon><RefreshCw :size="14" /></template
            >刷新字体</n-button
          >
        </div>
        <n-select
          class="font-select"
          :value="selectedFont"
          :options="fontOptions"
          :loading="fontsLoading"
          :disabled="pending"
          filterable
          placeholder="搜索系统字体"
          aria-label="界面字体"
          @update:value="(value) => emit('settings', { fontFamily: value })"
        />
        <p class="field-help">
          {{
            fontsLoading
              ? "正在读取此设备的系统字体…"
              : fontsLoaded
                ? `已读取 ${fonts.length} 个系统字体；“系统默认”跟随设备界面字体。`
                : "未读取到字体列表时，仍可使用系统默认字体。"
          }}
        </p>
        <n-alert
          v-if="fontFailure"
          type="warning"
          :bordered="false"
          class="font-alert"
          title="字体列表读取失败"
          >{{ fontFailure }}
          <p>
            <n-button size="small" :loading="fontsLoading" @click="loadFonts"
              >重新加载字体</n-button
            >
          </p></n-alert
        >
        <n-alert
          v-else-if="fontUnavailable"
          type="info"
          :bordered="false"
          class="font-alert"
          >此设备未找到已保存的“{{
            selectedFont
          }}”，将使用后备字体。可以选择其他字体或恢复系统默认。</n-alert
        >
        <div
          class="font-preview"
          :style="{ fontFamily: fontFamilyCss(selectedFont) }"
        >
          <span class="font-preview-label"
            >当前预览 · {{ currentFontLabel }}</span
          >
          <p class="font-preview-chinese">战双助手 · 查资料，配队伍，理流程</p>
          <p class="font-preview-latin">Punishing Gray Raven · 0123456789</p>
        </div>
      </section>
      <section id="settings-updates" class="panel">
        <div class="setting-row">
          <div>
            <h2>启动时检查资料更新</h2>
            <p>
              {{
                state.currentVersion
                  ? "检查完成后显示预览，由你确认是否启用。"
                  : "完成首次同步后可开启。开启后仅检查，仍需你确认启用。"
              }}
            </p>
          </div>
          <n-switch
            :value="!!state.currentVersion && state.settings.checkOnStartup"
            :disabled="pending || !state.currentVersion"
            aria-label="启动时检查资料更新"
            @update:value="
              (value) => emit('settings', { checkOnStartup: value })
            "
          />
        </div>
      </section>
      <section id="settings-data" class="panel">
        <div class="panel-heading">
          <div>
            <h2><Database :size="16" />本地数据与备份</h2>
            <p>资料、编辑记录和版本保存在此设备上。</p>
          </div>
          <n-button size="small" @click="openDirectory"
            ><template #icon><FolderOpen :size="15" /></template
            >打开目录</n-button
          >
        </div>
        <div class="data-path">{{ state.dataDirectory }}</div>
        <div class="data-stats">
          <span
            ><strong>{{
              state.entries
                .filter((entry) => !entry.hidden)
                .length.toLocaleString()
            }}</strong
            >可用条目</span
          ><span
            ><strong>{{
              state.entries
                .filter((entry) => entry.origin === "local")
                .length.toLocaleString()
            }}</strong
            >本地新增</span
          ><span
            ><strong>{{
              state.entries
                .filter((entry) => entry.modified)
                .length.toLocaleString()
            }}</strong
            >本地修改</span
          >
        </div>
        <div class="setting-row backup-row">
          <div>
            <h3>备份与恢复</h3>
            <p>包含基础资料、配置预设、攻略与流程、设置和版本记录。</p>
          </div>
          <div class="button-row">
            <n-button
              :loading="backupOperation === 'export'"
              :disabled="!!backupOperation || pending"
              @click="emit('exportBackup')"
              ><template #icon><Download :size="15" /></template
              >导出备份</n-button
            ><n-button
              :loading="backupOperation === 'import'"
              :disabled="!!backupOperation || pending || syncBusy"
              @click="emit('importBackup')"
              ><template #icon><Upload :size="15" /></template
              >从备份恢复</n-button
            >
          </div>
        </div>
      </section>
      <section id="settings-about" class="panel about-panel">
        <div class="about-icon"><BookMarked :size="25" /></div>
        <div>
          <h2>
            战双助手 <span class="version-text">v{{ state.appVersion }}</span>
          </h2>
          <p>战双帕弥什桌面助手，集中查阅资料、管理配队与操作流程。</p>
          <button class="text-button" @click="openProject">
            资料来源：myssal / PGR_Data<ExternalLink :size="12" />
          </button>
        </div>
      </section>
    </div>
  </section>
</template>
