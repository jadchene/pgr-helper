<script setup lang="ts">
import { computed } from 'vue';
import { ArrowRightLeft, CirclePlay, MousePointer2, Shield, Sparkles, AlertCircle } from 'lucide-vue-next';
import type { FlowNode, GuideIssue, GuideTeam } from '../../shared/guides';
import { flowGroupActor, flowNodeTitle, type FlowNodeContext } from '../../shared/guide-flow';
import FlowMemberIcon from './FlowMemberIcon.vue';
import type { EntryView } from '../../shared/types';

const props = withDefaults(defineProps<{
  nodes: FlowNode[];
  groupNotes?: Record<string, string>;
  team: GuideTeam;
  entries: EntryView[];
  contexts: Record<string, FlowNodeContext>;
  issues: GuideIssue[];
  selectedId?: string;
  editable?: boolean;
  prefix?: string;
  offset?: number;
}>(), { groupNotes: () => ({}), selectedId: '', editable: false, prefix: '', offset: 0 });
/** 仅把连续、同角色的同组节点放入同一横行，分支后恢复竖向流程。 */
const rows = computed(() => {
  const result: { node: FlowNode; index: number }[][] = [];
  props.nodes.forEach((node, index) => {
    const row = result[result.length - 1];
    const previous = row?.[row.length - 1].node;
    const actor = flowGroupActor(node, props.contexts);
    if (node.group && previous?.group === node.group && !previous.branches.length && actor && actor === flowGroupActor(previous, props.contexts)) row.push({ node, index });
    else result.push([{ node, index }]);
  });
  return result;
});
const emit = defineEmits<{ select: [id: string] }>();
const icons = { switch: ArrowRightLeft, skill: Sparkles, attack: MousePointer2, dodge: Shield, qte: CirclePlay };
/** 操作序号仅用于阅读，实际选择仍使用稳定标识。 */
const number = (index: number): string => `${props.prefix}${index + props.offset + 1}`;
/** 当前节点的精确错误不扩散到其他分支。 */
const hasError = (id: string): boolean => props.issues.some(issue => issue.path === `flow.nodes.${id}`);
/** 切人节点展示目标，普通操作展示可能的在场成员，QTE 仅展示触发序列。 */
const actors = (node: FlowNode): string[] => node.type === 'qte' ? [] : node.type === 'switch' ? (node.memberId ? [node.memberId] : []) : props.contexts[node.id]?.activeMemberIds || [];
/** 无法确定角色时保留提示，避免把未知状态当作确定成员。 */
const uncertain = (node: FlowNode): boolean => node.type === 'switch' ? !node.memberId : node.type !== 'qte' && (!props.contexts[node.id] || props.contexts[node.id].unknownActive);
</script>

<template>
  <div class="flow-sequence">
    <div v-for="row in rows" :key="row[0].node.id" class="flow-row" :class="{ grouped: row.length > 1, 'unified-group': !!row[0].node.group }">
    <FlowMemberIcon v-if="row[0].node.group" class="flow-group-avatar" :member-id="flowGroupActor(row[0].node, contexts)" :team="team" :entries="entries" />
    <div class="flow-row-nodes">
    <div v-for="{ node, index } in row" :key="node.id" class="flow-step" :data-flow-node="node.id">
      <component :is="editable ? 'button' : 'article'" class="flow-node-card"
        :class="{ selected: selectedId === node.id, invalid: hasError(node.id), 'has-actor': node.type !== 'qte' && !node.group }"
        :type="editable ? 'button' : undefined" :data-flow-id="node.id" :data-flow-type="node.type"
        :aria-label="editable ? `编辑节点 ${number(index)} ${flowNodeTitle(node, team, entries)}` : undefined"
        @click="editable && emit('select', node.id)">
        <div v-if="node.type !== 'qte' && !node.group" class="flow-node-portraits" :aria-label="node.type === 'switch' ? '切换目标' : actors(node).length > 1 ? '可能在场机体' : '在场机体'">
          <FlowMemberIcon v-for="memberId in actors(node)" :key="memberId" :member-id="memberId" :team="team" :entries="entries" />
          <span v-if="uncertain(node)" class="flow-unknown-actor" title="在场机体待确定" aria-label="在场机体待确定">?</span>
        </div>
        <div class="flow-node-content">
        <div class="flow-node-top">
          <span class="flow-node-number">{{ number(index) }}</span>
          <span class="flow-action-icon" :data-skill="node.type === 'skill' ? node.skill : undefined"><component :is="icons[node.type]" :size="15" /></span>
          <strong>{{ node.type === 'switch' ? '切换机体' : flowNodeTitle(node, team, entries) }}</strong>
          <AlertCircle v-if="hasError(node.id)" :size="15" class="flow-invalid-mark" aria-label="需要调整" />
        </div>
        <ol v-if="node.type === 'qte' && node.qteMemberIds.length" class="flow-qte-readonly">
          <li v-for="(memberId, qteIndex) in node.qteMemberIds" :key="qteIndex"><span>{{ qteIndex + 1 }}</span><FlowMemberIcon :member-id="memberId" :team="team" :entries="entries" /></li>
        </ol>
        <p v-if="node.notes" class="flow-node-notes">{{ node.notes }}</p>
        </div>
      </component>
      <div v-if="node.branches.length" class="flow-parallel-group">
        <div class="flow-parallel-heading">与上方节点同时开始 · {{ node.branches.length }} 条分支</div>
        <div class="flow-branches">
          <section v-for="(branch, branchIndex) in node.branches" :key="branchIndex" class="flow-branch" :aria-label="`节点 ${number(index)} 的并行分支 ${branchIndex + 1}`">
            <div class="flow-branch-label">并行 {{ branchIndex + 1 }}</div>
            <GuideFlowSequence v-if="branch.length" :nodes="branch" :team="team" :entries="entries" :group-notes="groupNotes" :contexts="contexts" :issues="issues"
              :selected-id="selectedId" :editable="editable" :prefix="`${number(index)}.${branchIndex + 1}.`" @select="emit('select', $event)" />
            <div v-else class="flow-empty-branch">待添加操作</div>
          </section>
        </div>
        <div class="flow-join">全部分支汇合后继续</div>
      </div>
    </div>
    </div>
    <p v-if="row[0].node.group && groupNotes[row[0].node.group]" class="flow-group-note">{{ groupNotes[row[0].node.group] }}</p>
    </div>
  </div>
</template>
