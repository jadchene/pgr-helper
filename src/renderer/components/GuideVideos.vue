<script setup lang="ts">
import { NButton, NInput } from 'naive-ui';
import { Trash2 } from 'lucide-vue-next';
import { computed } from 'vue';
const props = defineProps<{ modelValue: string[] }>();
const emit = defineEmits<{ 'update:modelValue': [value: string[]] }>();
const videos = computed(() => props.modelValue.map((url, index) => ({ url, index })));
/** 参考视频按顺序保存，每次更新保持父组件独立草稿。 */
const update = (index: number, value: string): void => emit('update:modelValue', props.modelValue.map((item, position) => position === index ? value : item));
/** 删除明确选中的链接。 */
const remove = (index: number): void => emit('update:modelValue', props.modelValue.filter((_, position) => position !== index));
</script>

<template>
  <section class="guide-video-editor">
    <div class="section-toolbar"><h2>参考视频</h2><n-button size="small" :disabled="modelValue.length >= 30" @click="emit('update:modelValue', [...modelValue, ''])">添加视频网址</n-button></div>
    <div v-for="video in videos" :key="video.index" class="guide-video-row">
      <n-input :value="video.url" :aria-label="`参考视频网址${video.index + 1}`" placeholder="输入 HTTPS 视频网址" @update:value="value => update(video.index, value)" />
      <n-button quaternary type="error" :aria-label="`删除参考视频${video.index + 1}`" @click="remove(video.index)"><Trash2 :size="16" /></n-button>
    </div>
    <p v-if="!modelValue.length" class="muted">保存后点击网址，使用系统浏览器观看。</p>
  </section>
</template>
