<script setup lang="ts">
import { ArrowRightLeft, CirclePlay, MousePointer2, Shield, Sparkles, AlertCircle } from 'lucide-vue-next';
import type { FlowNode, GuideIssue, GuideTeam } from '../../shared/guides';
import { flowMemberName, flowNodeTitle, type FlowNodeContext } from '../../shared/guide-flow';
import type { EntryView } from '../../shared/types';

const props = withDefaults(defineProps<{
  nodes: FlowNode[];
  team: GuideTeam;
  entries: EntryView[];
  contexts: Record<string, FlowNodeContext>;
  issues: GuideIssue[];
  selectedId?: string;
  editable?: boolean;
  prefix?: string;
}>(), { selectedId: '', editable: false, prefix: '' });
const emit = defineEmits<{ select: [id: string] }>();
const icons = { switch: ArrowRightLeft, skill: Sparkles, attack: MousePointer2, dodge: Shield, qte: CirclePlay };
/** 操作序号仅用于阅读，实际选择仍使用稳定标识。 */
const number = (index: number): string => `${props.prefix}${index + 1}`;
/** 当前节点的精确错误不扩散到其他分支。 */
const hasError = (id: string): boolean => props.issues.some(issue => issue.path === `flow.nodes.${id}`);
/** 用明确成员名称描述推导结果，不把可能状态说成唯一在场角色。 */
const actor = (id: string): string => {
  const context = props.contexts[id];
  if (!context || context.unknownActive) return '在场机体待确定';
  const names = context.activeMemberIds.map(memberId => flowMemberName(props.team, props.entries, memberId));
  return `${names.length > 1 ? '可能在场' : '在场'}：${names.join(' / ')}`;
};
</script>

<template>
  <div class="flow-sequence">
    <div v-for="(node, index) in nodes" :key="node.id" class="flow-step" :data-flow-node="node.id">
      <component :is="editable ? 'button' : 'article'" class="flow-node-card"
        :class="{ selected: selectedId === node.id, invalid: hasError(node.id) }"
        :type="editable ? 'button' : undefined" :data-flow-id="node.id" :data-flow-type="node.type"
        :aria-label="editable ? `编辑节点 ${number(index)} ${flowNodeTitle(node, team, entries)}` : undefined"
        @click="editable && emit('select', node.id)">
        <div class="flow-node-top">
          <span class="flow-node-number">{{ number(index) }}</span>
          <span class="flow-action-icon" :data-skill="node.type === 'skill' ? node.skill : undefined"><component :is="icons[node.type]" :size="15" /></span>
          <strong>{{ flowNodeTitle(node, team, entries) }}</strong>
          <span v-if="node.durationSeconds !== null" class="flow-node-time">{{ node.durationSeconds }} 秒</span>
          <AlertCircle v-if="hasError(node.id)" :size="15" class="flow-invalid-mark" aria-label="需要调整" />
        </div>
        <div class="flow-node-actor">{{ actor(node.id) }}</div>
        <ol v-if="node.type === 'qte' && node.qteMemberIds.length" class="flow-qte-readonly">
          <li v-for="(memberId, qteIndex) in node.qteMemberIds" :key="qteIndex"><span>{{ qteIndex + 1 }}</span>{{ flowMemberName(team, entries, memberId) }}</li>
        </ol>
        <p v-if="node.notes" class="flow-node-notes">{{ node.notes }}</p>
      </component>
      <div v-if="node.branches.length" class="flow-parallel-group">
        <div class="flow-parallel-heading">与上方节点同时开始 · {{ node.branches.length }} 条分支</div>
        <div class="flow-branches">
          <section v-for="(branch, branchIndex) in node.branches" :key="branchIndex" class="flow-branch" :aria-label="`节点 ${number(index)} 的并行分支 ${branchIndex + 1}`">
            <div class="flow-branch-label">并行 {{ branchIndex + 1 }}</div>
            <GuideFlowSequence v-if="branch.length" :nodes="branch" :team="team" :entries="entries" :contexts="contexts" :issues="issues"
              :selected-id="selectedId" :editable="editable" :prefix="`${number(index)}.${branchIndex + 1}.`" @select="emit('select', $event)" />
            <div v-else class="flow-empty-branch">待添加操作</div>
          </section>
        </div>
        <div class="flow-join">全部分支汇合后继续</div>
      </div>
    </div>
  </div>
</template>
