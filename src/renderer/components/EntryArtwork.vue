<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { CatalogEntry } from "../../shared/types";
import { isTrustedAssetImageUrl } from "../../shared/asset-image";
import { categoryMeta } from "../ui";

const props = defineProps<{
  entry: Pick<CatalogEntry, "name" | "image" | "category">;
  small?: boolean;
  eager?: boolean;
}>();
const failed = ref(false);
const container = ref<HTMLElement | null>(null);
const visible = ref(!!props.eager);
const cachedImage = ref<string | null>(null);
const trustedImage = computed(() => !!props.entry.image && isTrustedAssetImageUrl(props.entry.image));
const displayedImage = computed(() => trustedImage.value ? cachedImage.value : props.entry.image);
let requestVersion = 0;
let currentImage: string | undefined;
let observer: IntersectionObserver | undefined;

/** 旧图片的迟到错误不应隐藏已经切换的新图片。 */
const handleImageError = (event: Event): void => {
  if ((event.target as HTMLImageElement | null)?.getAttribute('src') === displayedImage.value) failed.value = true;
};

/** 图片进入可视区域后才读取缓存，较早请求不能覆盖已切换的条目。 */
watch(
  [() => props.entry.image, visible],
  async ([image, inView]) => {
    const version = ++requestVersion;
    if (currentImage !== image) {
      currentImage = image;
      failed.value = false;
      cachedImage.value = null;
    }
    if (!image || !inView || !isTrustedAssetImageUrl(image)) return;
    if (cachedImage.value) return;
    failed.value = false;
    try {
      const result = await window.desktop.resolveAssetImage(image);
      if (requestVersion !== version) return;
      cachedImage.value = result;
      failed.value = !result;
    } catch {
      if (requestVersion === version) failed.value = true;
    }
  },
  { immediate: true },
);

onMounted(() => {
  if (props.eager) return;
  observer = new IntersectionObserver(entries => {
    const entry = entries.find(item => item.target === container.value);
    if (entry) visible.value = entry.isIntersecting;
  });
  if (container.value) observer.observe(container.value);
});
onUnmounted(() => {
  requestVersion++;
  observer?.disconnect();
});
</script>

<template>
  <div ref="container" class="entry-artwork" :data-artwork-loading="trustedImage && visible && !cachedImage && !failed" :class="[{ small, 'source-artwork': trustedImage }, `artwork-${entry.category}`]">
    <img
      v-if="displayedImage && !failed"
      :key="displayedImage"
      :src="displayedImage"
      :alt="entry.name"
      :loading="eager ? 'eager' : 'lazy'"
      @error="handleImageError"
    />
    <template v-else
      ><component
        :is="categoryMeta[entry.category].icon"
        :size="small ? 20 : 27"
        :stroke-width="1.5"
      /><span v-if="!small">{{
        categoryMeta[entry.category].short
      }}</span></template
    >
  </div>
</template>
