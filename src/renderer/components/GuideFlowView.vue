<script setup lang="ts">
import { computed } from 'vue';
import { CheckCircle2, Repeat2 } from 'lucide-vue-next';
import type { GuideFlow, GuideTeam } from '../../shared/guides';
import { analyzeGuideFlow, flattenFlowNodes, flowDuration, flowMemberName } from '../../shared/guide-flow';
import type { EntryView } from '../../shared/types';
import GuideFlowSequence from './GuideFlowSequence.vue';
import './guide-flow.css';

const props = withDefaults(defineProps<{ flow: GuideFlow; team: GuideTeam; entries: EntryView[]; selectedId?: string; editable?: boolean }>(), { selectedId: '', editable: false });
const emit = defineEmits<{ select: [id: string] }>();
const analysis = computed(() => analyzeGuideFlow(props.flow, props.team));
const count = computed(() => flattenFlowNodes(props.flow).length);
const duration = computed(() => flowDuration(props.flow));
</script>

<template>
  <section class="guide-flow-view" :data-flow-mode="flow.mode">
    <header class="flow-view-heading">
      <div><component :is="flow.mode === 'loop' ? Repeat2 : CheckCircle2" :size="17" /><h3>{{ flow.mode === 'loop' ? '循环流程' : '单套流程' }}</h3></div>
      <span>{{ count }} 个节点<span v-if="duration.complete && count"> · {{ flow.mode === 'loop' ? '每轮' : '节点合计' }} {{ Number(duration.seconds.toFixed(2)) }} 秒</span></span>
    </header>
    <p class="flow-mode-description">{{ flow.mode === 'loop' ? '完成一轮后回到起点，持续轮换至战斗时间结束。' : '按顺序完成这套操作，击败目标后结束。' }}</p>
    <div v-if="!flow.nodes.length" class="flow-empty">{{ editable ? '添加第一个节点，开始记录操作。' : '尚未记录操作流程。' }}</div>
    <div v-else class="flow-view-canvas" tabindex="0" role="region" aria-label="操作流程连线图">
      <div class="flow-path" :class="{ looping: flow.mode === 'loop' }">
        <div class="flow-endpoint flow-start">开始 · {{ flowMemberName(team, entries, team.starterMemberId) }}</div>
        <GuideFlowSequence :nodes="flow.nodes" :team="team" :entries="entries" :contexts="analysis.contexts" :issues="analysis.issues"
          :selected-id="selectedId" :editable="editable" @select="emit('select', $event)" />
        <div class="flow-endpoint flow-end"><component :is="flow.mode === 'loop' ? Repeat2 : CheckCircle2" :size="15" />{{ flow.mode === 'loop' ? '回到流程开始 · 继续下一轮' : '单套结束 · 目标击败后停止' }}</div>
        <div v-if="flow.mode === 'loop'" class="flow-return-edge" aria-label="循环连接：末尾回到流程开始"><span>下一轮</span></div>
      </div>
    </div>
  </section>
</template>
