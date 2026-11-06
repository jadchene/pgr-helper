<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import type { EntrySection } from '../../shared/types';
import { groupSkillSections, resolveSkillSelection, skillSelectionKeys, type SkillFamily, type SkillGroup, type SkillSelection, type SkillVariant } from '../skill-book';
import './skill-book.css';

const props = defineProps<{ sections: EntrySection[] }>();
const instanceId = useId();
const groups = computed(() => groupSkillSections(props.sections));
const selectedKeys = ref<SkillSelection | null>(null);
const current = computed(() => resolveSkillSelection(groups.value, selectedKeys.value));
const contentHeading = ref<HTMLElement | null>(null);
const familyCount = computed(() => groups.value.reduce((count, group) => count + group.families.length, 0));
const groupIndex = computed(() => groups.value.findIndex(group => group.key === current.value?.group.key));
const familyIndex = computed(() => current.value?.group.families.findIndex(family => family.key === current.value?.family.key) ?? -1);
const hasElement = computed(() => current.value?.family.variants.some(variant => !!variant.section.skill.element) ?? false);

// 始终从最新 props 找段落，保存或同步替换内容后不会继续展示旧正文。
watch(groups, value => {
  const resolved = resolveSkillSelection(value, selectedKeys.value);
  selectedKeys.value = resolved ? skillSelectionKeys(resolved) : null;
}, { immediate: true });

/** 切换后让技能标题处于可见区域，键盘焦点仍留在选择按钮。 */
const selectSkill = async (group: SkillGroup, family: SkillFamily, variant: SkillVariant): Promise<void> => {
  selectedKeys.value = { groupKey: group.key, familyKey: family.key, variantKey: variant.key };
  await nextTick();
  contentHeading.value?.scrollIntoView({ block: 'nearest' });
};

/** 进入新大类时选择其来源顺序中的第一项。 */
const selectGroup = (group: SkillGroup): void => {
  const family = group.families[0];
  if (family?.variants[0]) void selectSkill(group, family, family.variants[0]);
};

/** 进入另一技能时展示该家族的首个完整说明。 */
const selectFamily = (family: SkillFamily): void => {
  if (current.value && family.variants[0]) void selectSkill(current.value.group, family, family.variants[0]);
};

/** 箭头键与首尾键切换当前一层页签，不影响其他导航层。 */
const navigateTabs = (event: KeyboardEvent, orientation: 'horizontal' | 'vertical'): void => {
  const previous = orientation === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
  const next = orientation === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
  if (![previous, next, 'Home', 'End'].includes(event.key)) return;
  const container = event.currentTarget as HTMLElement;
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button[role="tab"], button[aria-pressed]')];
  const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0 || !buttons.length) return;
  event.preventDefault();
  const target = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
    : (index + (event.key === next ? 1 : -1) + buttons.length) % buttons.length;
  buttons[target].focus({ preventScroll: true });
  buttons[target].click();
};

/** 当前技能列表同步显示所选变体的真实名称，其他技能以首条名称作导航。 */
const familyTitle = (family: SkillFamily): string => current.value?.family.key === family.key
  ? current.value.variant.section.title
  : family.variants[0].section.title;
</script>

<template>
  <section v-if="current" class="skill-book" :aria-labelledby="`${instanceId}-heading`">
    <header class="skill-book-heading">
      <h2 :id="`${instanceId}-heading`">技能</h2>
      <span>共 {{ familyCount }} 项技能</span>
    </header>
    <div class="skill-group-tabs" role="tablist" aria-label="技能分类" @keydown="navigateTabs($event, 'horizontal')">
      <button v-for="(group, index) in groups" :id="`${instanceId}-group-${index}`" :key="group.key"
        type="button" role="tab" :data-skill-group="group.id"
        :aria-selected="current.group.key === group.key" :aria-controls="`${instanceId}-group-panel`"
        :tabindex="current.group.key === group.key ? 0 : -1" @click="selectGroup(group)">
        {{ group.name }}<span class="skill-group-count">{{ group.families.length }}</span>
      </button>
    </div>
    <div :id="`${instanceId}-group-panel`" class="skill-book-layout" role="tabpanel" :aria-labelledby="`${instanceId}-group-${groupIndex}`">
      <div class="skill-family-list" role="tablist" aria-orientation="vertical" :aria-label="`${current.group.name}技能列表`" @keydown="navigateTabs($event, 'vertical')">
        <button v-for="(family, index) in current.group.families" :id="`${instanceId}-family-${index}`" :key="family.key"
          type="button" role="tab" :data-skill-family="family.id"
          :aria-selected="current.family.key === family.key" :aria-controls="`${instanceId}-skill-panel`"
          :tabindex="current.family.key === family.key ? 0 : -1" @click="selectFamily(family)">
          <strong>{{ family.name }}</strong>
          <span v-if="familyTitle(family) !== family.name" class="skill-family-title">{{ familyTitle(family) || '未命名技能' }}</span>
          <small v-if="family.variants.length > 1">{{ family.variants.length }} 个版本</small>
        </button>
      </div>
      <article :id="`${instanceId}-skill-panel`" class="skill-content" role="tabpanel" :data-skill-id="current.variant.section.skill.id" :aria-labelledby="`${instanceId}-family-${familyIndex}`">
        <header ref="contentHeading" class="skill-content-heading">
          <div class="skill-current-type">
            <span>{{ current.variant.section.skill.typeName }}</span>
            <span v-if="current.variant.section.skill.level !== undefined">Lv.{{ current.variant.section.skill.level }}</span>
          </div>
          <h3>{{ current.variant.section.title || '未命名技能' }}</h3>
        </header>
        <div v-if="current.family.variants.length > 1 || hasElement" class="skill-variant-picker">
          <span class="skill-variant-label">{{ hasElement ? '属性' : '技能说明' }}</span>
          <div class="skill-variants" role="group" :aria-label="hasElement ? '技能属性' : '技能版本'" @keydown="navigateTabs($event, 'horizontal')">
            <button v-for="variant in current.family.variants" :key="variant.key" type="button"
              :data-skill-id="variant.section.skill.id" :aria-pressed="current.variant.key === variant.key"
              :tabindex="current.variant.key === variant.key ? 0 : -1"
              @click="selectSkill(current.group, current.family, variant)">
              {{ variant.label }}
            </button>
          </div>
        </div>
        <div class="skill-body rich-text" tabindex="0">{{ current.variant.section.body || '暂无内容' }}</div>
      </article>
    </div>
  </section>
</template>
