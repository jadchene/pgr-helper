<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watchEffect } from "vue";
import {
  NConfigProvider,
  NDialogProvider,
  NGlobalStyle,
  NMessageProvider,
  darkTheme,
  zhCN,
  dateZhCN,
} from "naive-ui";
import type { GlobalThemeOverrides } from "naive-ui";
import type { AppSettings } from "../shared/types";
import Workspace from "./Workspace.vue";
import { fontFamilyCss } from "./font-family";

const themeMode = ref<AppSettings["theme"]>("system");
const fontFamily = ref("");
const fontStack = computed(() => fontFamilyCss(fontFamily.value));
const media = window.matchMedia("(prefers-color-scheme: dark)");
const systemDark = ref(media.matches);
const updateSystem = () => {
  systemDark.value = media.matches;
};
const isDark = computed(
  () =>
    themeMode.value === "dark" ||
    (themeMode.value === "system" && systemDark.value),
);
const overrides = computed<GlobalThemeOverrides>(() => ({
  common: {
    primaryColor: "#f97316",
    primaryColorHover: "#fb923c",
    primaryColorPressed: "#ea580c",
    primaryColorSuppl: "#f97316",
    borderRadius: "7px",
    fontFamily: fontStack.value,
    fontSize: "13px",
    ...(isDark.value
      ? {
          bodyColor: "#1c1c1e",
          cardColor: "#232326",
          modalColor: "#232326",
          popoverColor: "#29292d",
          borderColor: "#3f3f46",
        }
      : {}),
  },
  Button: { fontWeight: "500" },
  Input: {
    color: isDark.value ? "#202023" : "#ffffff",
    colorFocus: isDark.value ? "#202023" : "#ffffff",
  },
}));
watchEffect(() => {
  document.documentElement.dataset.theme = isDark.value ? "dark" : "light";
  document.documentElement.style.setProperty(
    "--app-font-family",
    fontStack.value,
  );
});
onMounted(() => media.addEventListener("change", updateSystem));
onUnmounted(() => media.removeEventListener("change", updateSystem));
</script>

<template>
  <n-config-provider
    :theme="isDark ? darkTheme : null"
    :theme-overrides="overrides"
    :locale="zhCN"
    :date-locale="dateZhCN"
  >
    <n-global-style />
    <n-dialog-provider
      ><n-message-provider placement="top" :max="4"
        ><Workspace
          :is-dark="isDark"
          @theme-change="themeMode = $event"
          @font-change="fontFamily = $event" /></n-message-provider
    ></n-dialog-provider>
  </n-config-provider>
</template>
