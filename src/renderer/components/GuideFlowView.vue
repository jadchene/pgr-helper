<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircle2, Repeat2 } from 'lucide-vue-next';
import type { GuideFlow, GuideTeam } from '../../shared/guides';
import { analyzeGuideFlow, flattenFlowNodes } from '../../shared/guide-flow';
import type { EntryView } from '../../shared/types';
import FlowMemberIcon from './FlowMemberIcon.vue';
import GuideFlowSequence from './GuideFlowSequence.vue';
import './guide-flow.css';

const props = withDefaults(defineProps<{ flow: GuideFlow; team: GuideTeam; entries: EntryView[]; selectedId?: string; editable?: boolean }>(), { selectedId: '', editable: false });
const emit = defineEmits<{ select: [id: string] }>();
const analysis = computed(() => analyzeGuideFlow(props.flow, props.team));
const count = computed(() => flattenFlowNodes(props.flow).length);
const loopIndex = computed(() => props.flow.mode === 'loop' && props.flow.loopStartId ? props.flow.nodes.findIndex(node => node.id === props.flow.loopStartId) : 0);
const startup = computed(() => props.flow.mode === 'loop' ? props.flow.nodes.slice(0, Math.max(0, loopIndex.value)) : []);
const cycle = computed(() => props.flow.nodes.slice(startup.value.length));
</script>

<template>
  <section class="guide-flow-view" :data-flow-mode="flow.mode">
    <header class="flow-view-heading">
      <div><component :is="flow.mode === 'loop' ? Repeat2 : CheckCircle2" :size="17" /><h3>操作流程</h3></div>
      <span>{{ count }} 个节点</span>
    </header>
    <p class="flow-mode-description">{{ flow.mode === 'loop' ? (loopIndex < 0 ? '循环入口已失效，请重新选择。' : `启动流程只执行一次，之后从第 ${loopIndex + 1} 步开始循环，持续至战斗时间结束。`) : '未设置循环入口，启动流程按顺序执行一次。' }}</p>
    <div v-if="!flow.nodes.length" class="flow-empty">{{ editable ? '添加第一个节点，开始记录操作。' : '尚未记录操作流程。' }}</div>
    <div v-else class="flow-view-canvas" tabindex="0" role="region" aria-label="操作流程连线图">
      <div class="flow-path">
        <div class="flow-endpoint flow-start">开始 <FlowMemberIcon :member-id="team.starterMemberId" :team="team" :entries="entries" /></div>
        <section v-if="startup.length" class="flow-startup-section" aria-label="启动流程，只执行一次">
          <h4>启动流程 · 只执行一次</h4>
          <GuideFlowSequence :nodes="startup" :team="team" :entries="entries" :group-notes="flow.groupNotes" :contexts="analysis.contexts" :issues="analysis.issues" :selected-id="selectedId" :editable="editable" @select="emit('select', $event)" />
        </section>
        <div class="flow-path" :class="{ looping: flow.mode === 'loop' }">
        <div v-if="flow.mode === 'loop'" class="flow-endpoint flow-start">循环入口 · 第 {{ Math.max(0, loopIndex) + 1 }} 步</div>
        <GuideFlowSequence :nodes="cycle" :offset="startup.length" :team="team" :entries="entries" :group-notes="flow.groupNotes" :contexts="analysis.contexts" :issues="analysis.issues"
          :selected-id="selectedId" :editable="editable" @select="emit('select', $event)" />
        <div class="flow-endpoint flow-end"><component :is="flow.mode === 'loop' ? Repeat2 : CheckCircle2" :size="15" />{{ flow.mode === 'loop' ? `回到第 ${Math.max(0, loopIndex) + 1} 步 · 继续下一轮` : '流程结束' }}</div>
        <div v-if="flow.mode === 'loop'" class="flow-return-edge" :aria-label="`循环连接：末尾回到第 ${Math.max(0, loopIndex) + 1} 步`"><span>下一轮</span></div>
        </div>
      </div>
    </div>
  </section>
</template>
