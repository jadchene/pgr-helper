<script setup lang="ts">
import { computed } from 'vue';
import type { GuideTeam } from '../../shared/guides';
import type { EntryView } from '../../shared/types';
import { flowMemberName } from '../../shared/guide-flow';
import LoadoutItem from './LoadoutItem.vue';
const props = defineProps<{ memberId: string; team: GuideTeam; entries: EntryView[] }>();
const entry = computed(() => props.entries.find(entry => entry.id === props.team.members.find(member => member.id === props.memberId)?.characterId));
</script>
<template><span class="flow-member-icon"><LoadoutItem :entry="entry" :size="28" :extra="flowMemberName(team, entries, memberId)" fallback="机体待确定" /></span></template>
