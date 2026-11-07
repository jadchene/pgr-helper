<script setup lang="ts">
import { useCatalogSelectLabel } from '../catalog-select-label';
import { computed, ref, watch } from 'vue';
import { NAlert, NButton, NInput, NInputNumber, NSelect, useDialog } from 'naive-ui';
import { ArrowDown, ArrowUp, Copy, GitBranch, Plus, Trash2, X } from 'lucide-vue-next';
import type { FlowNode, FlowNodeType, GuideFlow, GuideTeam } from '../../shared/guides';
import { analyzeGuideFlow, canRepeatFlowNode, flowGroupActor, normalizeFlowGroups, createFlowNode, findFlowNode, flattenFlowNodes, flowLimits, flowMemberName, flowNodeLabels, flowSkillLabels } from '../../shared/guide-flow';
import type { EntryView } from '../../shared/types';
import GuideFlowView from './GuideFlowView.vue';
import './guide-flow.css';
import { useGuideSelectMenus } from '../guide-select-menus';

const props = defineProps<{ modelValue: GuideFlow; team: GuideTeam; entries: EntryView[] }>();
const { renderCatalogLabel } = useCatalogSelectLabel(() => props.entries, value => props.entries.find(entry => entry.id === props.team.members.find(member => member.id === value)?.characterId));
const emit = defineEmits<{ 'update:modelValue': [flow: GuideFlow] }>();
const dialog = useDialog();
const selectedId = ref('');
const { selectMenu, closeSelectMenus } = useGuideSelectMenus();
watch(selectedId, closeSelectMenus);
const newType = ref<FlowNodeType>('attack');
const locations = computed(() => flattenFlowNodes(props.modelValue));
const selected = computed(() => findFlowNode(props.modelValue, selectedId.value));
const analysis = computed(() => analyzeGuideFlow(props.modelValue, props.team));
const context = computed(() => analysis.value.contexts[selectedId.value]);
const canAdd = computed(() => locations.value.length < flowLimits.nodes);
const typeOptions = Object.entries(flowNodeLabels).map(([value, label]) => ({ value, label }));
const skillOptions = Object.entries(flowSkillLabels).map(([value, label]) => ({ value, label }));
const memberOptions = computed(() => props.team.members.filter(member => member.characterId).map(member => ({ value: member.id, label: flowMemberName(props.team, props.entries, member.id) })));
const qteOptions = computed(() => memberOptions.value.filter(option => context.value?.qteMemberIds.includes(option.value)));
const invalidQte = (memberId: string): boolean => !context.value?.qteMemberIds.includes(memberId);

watch(() => props.modelValue, value => {
  if (!findFlowNode(value, selectedId.value)) selectedId.value = value.nodes[0]?.id || '';
}, { immediate: true, deep: true });

/** 每次编辑提交独立值，不直接修改父级草稿。 */
const mutate = (change: (copy: GuideFlow) => void): void => {
  const copy = JSON.parse(JSON.stringify(props.modelValue)) as GuideFlow;
  change(copy);
  normalizeFlowGroups(copy, props.team);
  emit('update:modelValue', copy);
};
/** 当前节点字段修改保留并行分支和其他已填写内容。 */
const update = (patch: Partial<FlowNode>): void => {
  mutate(copy => {
    const target = findFlowNode(copy, selectedId.value);
    if (target) Object.assign(target.node, patch);
  });
};
/** 仅提供同一在场机体的相邻分组，避免移动操作顺序。 */
const groupOptions = computed(() => {
  const target = selected.value;
  if (!target) return [];
  const actor = flowGroupActor(target.node, analysis.value.contexts);
  return [...new Set([target.node.group, ...[-1, 1].map(offset => {
    const adjacent = target.sequence[target.index + offset];
    if (!adjacent || !actor || flowGroupActor(adjacent, analysis.value.contexts) !== actor) return 0;
    const left = offset === -1 ? adjacent : target.node;
    const right = offset === -1 ? target.node : adjacent;
    return !left.branches.length && !(props.modelValue.mode === 'loop' && props.modelValue.loopStartId === right.id) ? adjacent.group : 0;
  })])].filter(Boolean).map(value => ({ value, label: `分组 ${value}` }));
});
/** 自动使用当前最大编号之后的新编号，不复用仍存在的组。 */
const createGroup = (): void => update({ group: Math.max(0, ...locations.value.map(item => item.node.group || 0)) + 1 });
/** 整组共享备注，修改任一成员的组备注都会更新同一份内容。 */
const updateGroupNote = (text: string): void => {
  const group = selected.value?.node.group;
  if (!group) return;
  mutate(copy => { copy.groupNotes = { ...copy.groupNotes, [group]: text }; });
};
/** 改变动作时清理已不适用的角色引用，不沿用隐藏的 QTE 或切人目标。 */
const changeType = (type: FlowNodeType): void => update({ type, memberId: '', qteMemberIds: [], count: 1, group: 0 });

/** 添加到主流程末尾；在分支编辑时也能明确回到主线继续记录。 */
const appendMain = (): void => {
  if (!canAdd.value) return;
  const node = createFlowNode(newType.value);
  mutate(copy => { node.group = copy.nodes.at(-1)?.group || 0; copy.nodes.push(node); });
  selectedId.value = node.id;
};
/** 在所选节点的同一连续流程中插入，避免误把串行操作变为并行。 */
const insert = (offset: 0 | 1): void => {
  if (!canAdd.value) return;
  const node = createFlowNode(newType.value);
  mutate(copy => {
    const target = findFlowNode(copy, selectedId.value);
    if (target) { node.group = target.node.group; target.sequence.splice(target.index + offset, 0, node); }
  });
  selectedId.value = node.id;
};
/** 相邻调整只改变当前分支的顺序，其余并行关系保持不变。 */
const move = (offset: -1 | 1): void => {
  mutate(copy => {
    const target = findFlowNode(copy, selectedId.value);
    if (!target) return;
    const next = target.index + offset;
    if (next < 0 || next >= target.sequence.length) return;
    target.sequence.splice(target.index, 1);
    target.sequence.splice(next, 0, target.node);
  });
};
/** 复制完整子树时为所有节点生成新标识，避免重复 ID。 */
const duplicate = (): void => {
  if (!selected.value) return;
  const count = flattenFlowNodes({ mode: 'single', nodes: [selected.value.node] }).length;
  if (locations.value.length + count > flowLimits.nodes) return;
  let newId = '';
  mutate(copy => {
    const target = findFlowNode(copy, selectedId.value);
    if (!target) return;
    const clone = JSON.parse(JSON.stringify(target.node)) as FlowNode;
    const renew = (node: FlowNode): void => {
      node.id = crypto.randomUUID();
      node.branches.forEach(branch => branch.forEach(renew));
    };
    renew(clone);
    newId = clone.id;
    target.sequence.splice(target.index + 1, 0, clone);
  });
  if (newId) selectedId.value = newId;
};
/** 删除节点连同其子分支；包含多节点时明确显示影响范围。 */
const remove = (): void => {
  if (!selected.value) return;
  const targetId = selectedId.value;
  const count = flattenFlowNodes({ mode: 'single', nodes: [selected.value.node] }).length;
  const perform = (): void => {
    let nextId = '';
    mutate(copy => {
      const target = findFlowNode(copy, targetId);
      if (!target) return;
      target.sequence.splice(target.index, 1);
      nextId = target.sequence[target.index]?.id || target.sequence[target.index - 1]?.id || target.parent?.id || '';
    });
    selectedId.value = nextId;
  };
  if (count === 1) perform();
  else dialog.warning({ title: '删除节点及并行分支？', content: `将移除当前节点及其子分支中的共 ${count} 个节点。`, positiveText: '删除这些节点', negativeText: '取消', onPositiveClick: perform });
};

/** 新分支默认放一个可编辑 QTE，适合长按动作同时拉 QTE 的常用场景。 */
const addBranch = (): void => {
  if (!selected.value || !canAdd.value || selected.value.depth >= flowLimits.depth || selected.value.node.branches.length >= flowLimits.branches) return;
  const node = createFlowNode('qte');
  mutate(copy => { findFlowNode(copy, selectedId.value)?.node.branches.push([node]); });
  selectedId.value = node.id;
};
/** 向指定并行分支追加连续动作。 */
const appendBranch = (index: number): void => {
  if (!canAdd.value) return;
  const node = createFlowNode(newType.value);
  mutate(copy => { findFlowNode(copy, selectedId.value)?.node.branches[index]?.push(node); });
  selectedId.value = node.id;
};
/** 移除整个分支时确认真实节点数，空分支直接移除。 */
const removeBranch = (index: number): void => {
  if (!selected.value) return;
  const parentId = selectedId.value;
  const count = flattenFlowNodes({ mode: 'single', nodes: selected.value.node.branches[index] }).length;
  const perform = (): void => mutate(copy => { findFlowNode(copy, parentId)?.node.branches.splice(index, 1); });
  if (!count) perform();
  else dialog.warning({ title: '删除并行分支？', content: `将删除此分支中的 ${count} 个操作节点。`, positiveText: '删除分支', negativeText: '取消', onPositiveClick: perform });
};

/** 每次点击加入一次，允许同一非在场机体多次触发。 */
const addQte = (memberId: string): void => {
  if (!selected.value || !context.value?.qteMemberIds.includes(memberId) || selected.value.node.qteMemberIds.length >= flowLimits.qte) return;
  update({ qteMemberIds: [...selected.value.node.qteMemberIds, memberId] });
};
/** QTE 按触发序列移动，不按成员去重或排序。 */
const moveQte = (index: number, offset: -1 | 1): void => {
  if (!selected.value) return;
  const sequence = [...selected.value.node.qteMemberIds];
  const next = index + offset;
  if (next < 0 || next >= sequence.length) return;
  [sequence[index], sequence[next]] = [sequence[next], sequence[index]];
  update({ qteMemberIds: sequence });
};
/** 移除一次 QTE，不影响同机体的其他触发。 */
const removeQte = (index: number): void => {
  if (!selected.value) return;
  update({ qteMemberIds: selected.value.node.qteMemberIds.filter((_, i) => i !== index) });
};
/** 点击校验说明定位到相关节点。 */
const selectIssue = (path: string): void => {
  const id = path.startsWith('flow.nodes.') ? path.slice('flow.nodes.'.length) : '';
  if (id && findFlowNode(props.modelValue, id)) selectedId.value = id;
};
</script>

<template>
  <section class="guide-flow-editor">
    <div class="flow-editor-toolbar">
      <div class="flow-add-main">
        <n-select v-bind="selectMenu('new-type')" v-model:value="newType" :options="typeOptions" aria-label="新增动作类型" class="flow-new-type" />
        <n-button :disabled="!canAdd" @click="appendMain"><template #icon><Plus :size="15" /></template>添加主流程节点</n-button>
      </div>
    </div>
    <div class="flow-field">
      <span>循环从哪一步开始</span>
      <n-select v-bind="selectMenu('loop-start')" :value="modelValue.mode === 'loop' ? modelValue.loopStartId || modelValue.nodes[0]?.id || null : null" :options="modelValue.nodes.map((node, index) => ({ value: node.id, label: `第 ${index + 1} 步 · ${flowNodeLabels[node.type]}` }))" clearable aria-label="循环入口" placeholder="不循环，所有步骤只执行一次" @update:value="value => mutate(copy => { copy.loopStartId = value || ''; copy.mode = value ? 'loop' : 'single'; })" />
      <small>不设置入口时，全部步骤只执行一次；设置后，入口之前只执行一次，入口及后续步骤循环执行。</small>
    </div>
    <n-alert v-if="analysis.issues.length" type="warning" :bordered="false" class="flow-validation">
      <details><summary>{{ analysis.issues.length }} 处操作需要补充或调整</summary><ul><li v-for="(issue, index) in analysis.issues" :key="index"><button type="button" class="text-button" @click="selectIssue(issue.path)">{{ issue.message }}</button></li></ul></details>
    </n-alert>
    <div class="flow-editor-layout">
      <GuideFlowView :flow="modelValue" :team="team" :entries="entries" :selected-id="selectedId" editable @select="selectedId = $event" />
      <aside v-if="selected" class="flow-node-form" :data-selected-flow-node="selected.node.id" aria-label="节点设置">
        <div class="flow-form-heading"><h3>节点设置</h3><span>{{ selected.parent ? `并行分支 ${(selected.branchIndex ?? 0) + 1}` : '主流程' }} · 第 {{ selected.index + 1 }} 步</span></div>
        <div class="flow-node-tools">
          <n-button size="small" :disabled="selected.index === 0" aria-label="上移节点" title="上移节点" @click="move(-1)"><template #icon><ArrowUp :size="14" /></template></n-button>
          <n-button size="small" :disabled="selected.index === selected.sequence.length - 1" aria-label="下移节点" title="下移节点" @click="move(1)"><template #icon><ArrowDown :size="14" /></template></n-button>
          <n-button size="small" :disabled="!canAdd" @click="insert(0)">前插</n-button>
          <n-button size="small" :disabled="!canAdd" @click="insert(1)">后插</n-button>
          <n-button size="small" :disabled="locations.length + flattenFlowNodes({ mode: 'single', nodes: [selected.node] }).length > flowLimits.nodes" aria-label="复制节点" title="复制节点及分支" @click="duplicate"><template #icon><Copy :size="14" /></template></n-button>
          <n-button size="small" type="error" quaternary aria-label="删除节点" title="删除节点" @click="remove"><template #icon><Trash2 :size="14" /></template></n-button>
        </div>
        <div class="flow-field"><span>节点类型</span><n-select v-bind="selectMenu('node-type')" :value="selected.node.type" :options="typeOptions" aria-label="节点类型" @update:value="changeType" /></div>
        <div v-if="selected.node.type === 'switch'" class="flow-field"><span>切换到</span><n-select v-bind="selectMenu('switch-target')" :value="selected.node.memberId || null" :options="memberOptions" :render-label="renderCatalogLabel" placeholder="选择队伍中的机体" aria-label="切换目标机体" @update:value="update({ memberId: $event })" /></div>
        <div v-if="selected.node.type === 'skill'" class="flow-field"><span>技能操作</span><n-select v-bind="selectMenu('skill')" :value="selected.node.skill" :options="skillOptions" aria-label="技能操作" @update:value="update({ skill: $event, count: 1 })" /></div>
        <div v-if="['skill', 'attack', 'dodge'].includes(selected.node.type)" class="flow-field"><span>按法</span><div class="flow-press-picker" role="group" aria-label="按法"><button type="button" :aria-pressed="selected.node.press === 'tap'" @click="update({ press: 'tap' })">短按</button><button type="button" :aria-pressed="selected.node.press === 'hold'" @click="update({ press: 'hold' })">长按</button></div></div>
        <div v-if="selected.node.type === 'qte'" class="flow-qte-editor">
          <h4>QTE 触发顺序</h4>
          <p>每点一次加入一次，可重复添加同一机体。</p>
          <div class="flow-qte-add"><n-button v-for="option in qteOptions" :key="option.value" size="small" :disabled="selected.node.qteMemberIds.length >= flowLimits.qte" @click="addQte(option.value)"><template #icon><Plus :size="13" /></template>{{ option.label }}</n-button></div>
          <p v-if="!qteOptions.length" class="flow-qte-unavailable">{{ context?.unknownActive ? '请先设置首发并补全前面的切人目标。' : '当前没有确定不在场的机体，请检查队伍或并行切人。' }}</p>
          <ol class="flow-qte-sequence"><li v-for="(memberId, index) in selected.node.qteMemberIds" :key="index" :class="{ invalid: invalidQte(memberId) }"><span class="flow-qte-index">{{ index + 1 }}</span><span class="flow-qte-name">{{ flowMemberName(team, entries, memberId) }}</span><div class="flow-qte-tools"><button type="button" :disabled="index === 0" :aria-label="`上移第 ${index + 1} 次 QTE`" @click="moveQte(index, -1)"><ArrowUp :size="13" /></button><button type="button" :disabled="index === selected.node.qteMemberIds.length - 1" :aria-label="`下移第 ${index + 1} 次 QTE`" @click="moveQte(index, 1)"><ArrowDown :size="13" /></button><button type="button" :aria-label="`移除第 ${index + 1} 次 QTE`" @click="removeQte(index)"><X :size="13" /></button></div></li></ol>
        </div>
        <label v-if="canRepeatFlowNode(selected.node)" class="flow-field"><span>次数</span><n-input-number :value="selected.node.count" :min="1" :max="999" :precision="0" aria-label="操作次数" @update:value="update({ count: $event ?? 1 })" /></label>
        <div class="flow-field"><span>节点分组</span><div class="flow-group-controls"><n-select v-bind="selectMenu('node-group')" :value="selected.node.group || null" :options="groupOptions" clearable placeholder="不分组" aria-label="节点分组" :disabled="!flowGroupActor(selected.node, analysis.contexts)" @update:value="update({ group: $event || 0 })" /><n-button :disabled="!flowGroupActor(selected.node, analysis.contexts)" @click="createGroup">新建分组</n-button></div><small>同一在场机体的相邻节点可排在一行，切人和循环入口保持分隔。</small></div>
        <label v-if="selected.node.group" class="flow-field"><span>分组备注</span><n-input :value="modelValue.groupNotes?.[selected.node.group] || ''" type="textarea" :autosize="{ minRows: 2, maxRows: 5 }" :maxlength="4000" placeholder="整组操作的说明或触发条件" aria-label="分组备注" @update:value="updateGroupNote" /></label>
        <label class="flow-field"><span>节点备注</span><n-input :value="selected.node.notes" class="flow-node-notes-input" type="textarea" :autosize="{ minRows: 2, maxRows: 7 }" :maxlength="4000" placeholder="触发条件、时机或操作细节" aria-label="节点备注" @update:value="update({ notes: $event })" /></label>
        <section class="flow-branch-editor">
          <div class="flow-branch-editor-heading"><h4>并行操作</h4><n-button size="small" :disabled="!canAdd || selected.depth >= flowLimits.depth || selected.node.branches.length >= flowLimits.branches" @click="addBranch"><template #icon><GitBranch :size="14" /></template>添加分支</n-button></div>
          <p>分支与当前节点同时开始，全部完成后再进入下一个节点。</p>
          <div v-for="(branch, index) in selected.node.branches" :key="index" class="flow-branch-control"><span>分支 {{ index + 1 }} · {{ flattenFlowNodes({ mode: 'single', nodes: branch }).length }} 个节点</span><div><n-button v-if="branch.length" size="tiny" @click="selectedId = branch[0].id">查看</n-button><n-button size="tiny" :disabled="!canAdd" @click="appendBranch(index)">追加操作</n-button><n-button size="tiny" type="error" quaternary :aria-label="`删除分支 ${index + 1}`" @click="removeBranch(index)"><template #icon><Trash2 :size="13" /></template></n-button></div></div>
          <n-button v-if="selected.parent" size="small" quaternary class="flow-parent-button" @click="selectedId = selected.parent!.id">返回父节点设置</n-button>
        </section>
      </aside>
      <aside v-else class="flow-node-form flow-form-empty">添加节点后，点击流程卡片编辑操作、备注和并行分支。</aside>
    </div>
  </section>
</template>
