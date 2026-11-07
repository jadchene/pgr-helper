<script setup lang="ts">
import { computed } from "vue";
import {
  NButton,
  NSelect,
  NAlert,
  NProgress,
  NCollapse,
  NCollapseItem,
  useMessage,
} from "naive-ui";
import {
  RefreshCw,
  Github,
  Check,
  History,
  ArrowDownToLine,
  ExternalLink,
} from "lucide-vue-next";
import type {
  AppSettings,
  AppState,
  SyncPreview,
  SyncProgress,
  VersionInfo,
} from "../../shared/types";
import { displayDate, displayVersion, errorMessage } from "../ui";

const props = defineProps<{
  state: AppState;
  busy: boolean;
  pending: boolean;
  progress: SyncProgress;
  preview: SyncPreview | null;
  failure: string;
}>();
const emit = defineEmits<{
  settings: [value: Partial<AppSettings>];
  prepare: [];
  apply: [];
  cancel: [];
  rollback: [version: VersionInfo];
}>();
const message = useMessage();
const firstSync = computed(() => !props.state.currentVersion);
const active = computed(() =>
  props.state.settings.sources.find(
    (source) => source.id === props.state.settings.activeSourceId,
  ),
);
const sourceOptions = computed(() =>
  props.state.settings.sources.map((source) => ({
    label: `${source.name} · GitHub`,
    value: source.id,
  })),
);
const percentage = computed(() =>
  props.progress.total
    ? Math.min(
        100,
        Math.round((props.progress.completed / props.progress.total) * 100),
      )
    : 0,
);
const kindLabel = { added: "新增", changed: "更新", removed: "移除" };
const wasCanceled = computed(() => /取消/.test(props.failure));

/** 打开当前适配器对应的远程资料仓库页面。 */
const openSource = async (images = false) => {
  try {
    await window.desktop.openExternal(images ? "https://github.com/undertheobservers/PGR_Assets" : "https://github.com/myssal/PGR_Data");
  } catch (failure) {
    message.error(errorMessage(failure));
  }
};
</script>

<template>
  <section class="page-layout settings-page">
    <header class="page-heading">
      <div>
        <div class="eyebrow">资料管理</div>
        <h1>{{ firstSync ? "首次同步基础资料" : "同步中心" }}</h1>
        <p>
          {{
            firstSync
              ? "首次使用需要手动从远程仓库获取资料，预览确认后保存到本地。"
              : "检查远程来源变化，确认后更新本地基础资料。"
          }}
        </p>
      </div>
      <n-button
        type="primary"
        :loading="busy"
        :disabled="pending || busy || !active"
        @click="emit('prepare')"
      >
        <template #icon><RefreshCw :size="16" /></template>
        {{ busy ? "正在获取" : firstSync ? "获取基础资料" : "检查更新" }}
      </n-button>
    </header>
    <div class="settings-scroll">
      <section class="sync-status-summary" aria-label="当前资料状态">
        <div><span>当前资料</span><strong>{{ displayVersion(state.currentVersion?.version || '') || '尚未同步' }}</strong></div>
        <div><span>可用条目</span><strong>{{ state.entries.filter(item => !item.hidden).length.toLocaleString() }}</strong></div>
        <div><span>更新方式</span><strong>预览后确认启用</strong></div>
      </section>
      <section class="panel">
        <div class="panel-heading">
          <div>
            <h2>数据来源</h2>
            <p>从远程仓库获取国服正式版本资料。</p>
          </div>
          <span class="neutral-tag">GitHub 远程仓库</span>
        </div>
        <n-select
          v-if="sourceOptions.length > 1"
          :value="state.settings.activeSourceId"
          :options="sourceOptions"
          :disabled="busy || pending"
          aria-label="当前数据来源"
          @update:value="(value) => emit('settings', { activeSourceId: value })"
        />
        <div v-if="active" class="remote-source">
          <div class="remote-source-icon"><Github :size="22" /></div>
          <div>
            <h3>{{ active.name }}</h3>
            <p>myssal / PGR_Data · 国服</p>
          </div>
          <n-button size="small" @click="openSource()"
            ><template #icon><ExternalLink :size="14" /></template
            >查看仓库</n-button
          >
        </div>
        <n-alert v-else type="warning" :bordered="false"
          >没有可用的远程来源，请检查来源配置。</n-alert
        >
        <div class="remote-source">
          <div class="remote-source-icon"><Github :size="22" /></div>
          <div>
            <h3>基础资料图片</h3>
            <p>undertheobservers / PGR_Assets</p>
          </div>
          <n-button size="small" @click="openSource(true)">查看图片仓库</n-button>
        </div>
        <p class="field-help">图片按浏览需要下载并保存在本地，已缓存图片可离线查看。新资料可能暂时缺图，可在编辑中设置自己的图片。</p>
        <p v-if="state.currentVersion?.imageSource" class="field-help">
          当前图片：{{ state.currentVersion.imageSource.version }} · {{ displayDate(state.currentVersion.imageSource.updatedAt) }}
        </p>
        <p class="field-help">
          {{
            firstSync
              ? "点击“获取基础资料”后才会连接远程仓库。同步完成后可离线浏览和编辑。"
              : "更新会先生成预览，由你确认启用。已导入的资料可离线浏览和编辑。"
          }}
        </p>
      </section>
      <section v-if="busy" class="panel progress-panel">
        <div class="panel-heading">
          <div>
            <h2>
              <RefreshCw :size="16" class="spin" />{{
                firstSync ? "正在获取基础资料" : "正在准备更新"
              }}
            </h2>
            <p>{{ progress.message || "正在连接远程仓库…" }}</p>
          </div>
          <n-button size="small" @click="emit('cancel')">取消</n-button>
        </div>
        <n-progress
          type="line"
          :percentage="percentage"
          :processing="true"
          :show-indicator="!!progress.total"
        />
        <p class="field-help">
          {{
            firstSync
              ? "准备完成后会显示资料数量和变更预览，确认后才会导入。"
              : "可以继续浏览其他资料，准备完成后到这里确认启用。"
          }}
        </p>
      </section>
      <n-alert
        v-if="failure"
        :type="wasCanceled ? 'info' : 'error'"
        :bordered="false"
        :title="wasCanceled ? '同步已取消' : '同步未完成'"
      >
        {{ failure }}
        <p>
          {{
            wasCanceled
              ? "资料未作更改，可以随时重新获取。"
              : firstSync
                ? "尚未导入基础资料。请检查网络连接后重新尝试。"
                : "当前资料保持不变。请检查网络连接后重新尝试。"
          }}
        </p>
      </n-alert>
      <section v-if="preview && !busy" class="panel preview-panel">
        <div class="panel-heading">
          <div>
            <h2>更新预览</h2>
            <p>
              {{ preview.sourceName }} ·
              {{ displayVersion(preview.version) || "未标记版本" }}
            </p>
          </div>
          <span class="revision-badge">{{ preview.revision.slice(0, 9) }}</span>
        </div>
        <div class="diff-stats">
          <div>
            <strong>{{ preview.total.toLocaleString() }}</strong
            ><span>候选资料</span>
          </div>
          <div class="added">
            <strong>+{{ preview.added.toLocaleString() }}</strong
            ><span>新增</span>
          </div>
          <div class="changed">
            <strong>{{ preview.changed.toLocaleString() }}</strong
            ><span>更新</span>
          </div>
          <div class="removed">
            <strong>{{ preview.removed.toLocaleString() }}</strong
            ><span>来源移除</span>
          </div>
        </div>
        <p v-if="preview.imageSource" class="field-help">
          图片版本：{{ preview.imageSource.version }} · {{ displayDate(preview.imageSource.updatedAt) }} · {{ preview.imageSource.revision.slice(0, 9) }}
        </p>
        <p
          v-if="
            !firstSync && !preview.added && !preview.changed && !preview.removed
          "
          class="no-diff"
        >
          <Check :size="16" />内容与当前基础资料一致。
        </p>
        <n-collapse v-if="preview.examples.length || preview.warnings.length">
          <n-collapse-item
            v-if="preview.examples.length"
            name="examples"
            title="变化示例"
            ><div class="diff-examples">
              <div v-for="(example, index) in preview.examples" :key="index">
                <span :class="example.kind">{{ kindLabel[example.kind] }}</span
                ><span>{{ example.name }}</span>
              </div>
            </div></n-collapse-item
          >
          <n-collapse-item
            v-if="preview.warnings.length"
            name="warnings"
            :title="`数据说明 (${preview.warnings.length})`"
            ><ul class="warning-list">
              <li v-for="(warning, index) in preview.warnings" :key="index">
                {{ warning }}
              </li>
            </ul></n-collapse-item
          >
        </n-collapse>
        <div class="panel-footer">
          <span>{{
            firstSync
              ? "确认后将基础资料保存到本地，已有的本地新增和编辑会保留。"
              : "本地新增与编辑会保留；来源移除的条目会标记保留。"
          }}</span
          ><n-button
            type="primary"
            :loading="pending"
            :disabled="pending"
            @click="emit('apply')"
            ><template #icon><ArrowDownToLine :size="16" /></template
            >启用这个版本</n-button
          >
        </div>
      </section>
      <section v-if="state.versions.length" class="panel">
        <div class="panel-heading">
          <div>
            <h2><History :size="16" />版本记录</h2>
            <p>回退基础资料时，本地新增和编辑会保留。</p>
          </div>
          <span class="muted">{{ state.versions.length }} 个版本</span>
        </div>
        <div class="version-list">
          <div
            v-for="version in state.versions"
            :key="version.id"
            class="version-row"
          >
            <div
              class="version-mark"
              :class="{ current: state.currentVersion?.id === version.id }"
            >
              <Check
                v-if="state.currentVersion?.id === version.id"
                :size="15"
              /><History v-else :size="15" />
            </div>
            <div class="version-info">
              <strong
                >{{ displayVersion(version.version) || version.sourceName
                }}<span
                  v-if="state.currentVersion?.id === version.id"
                  class="current-badge"
                  >当前使用</span
                ></strong
              >
              <p>
                {{ version.sourceName }} ·
                {{ version.count.toLocaleString() }} 条 ·
                {{ displayDate(version.importedAt) }}
              </p>
              <code>{{ version.revision.slice(0, 12) }}</code>
              <p v-if="version.imageSource">图片：{{ version.imageSource.version }} · {{ version.imageSource.revision.slice(0, 9) }}</p>
            </div>
            <n-button
              v-if="state.currentVersion?.id !== version.id"
              size="small"
              :disabled="busy || pending"
              @click="emit('rollback', version)"
              >回退到此版本</n-button
            >
          </div>
        </div>
      </section>
    </div>
  </section>
</template>
