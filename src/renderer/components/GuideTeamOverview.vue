<script setup lang="ts">
import DictionaryBadge from './DictionaryBadge.vue';
import { computed } from 'vue';
import { Crown, Flag, Sparkles, Users } from 'lucide-vue-next';
import type { CatalogEntry, EntryView } from '../../shared/types';
import { teamPositions, teamPositionLabels, type GuideMember, type GuideTeam } from '../../shared/guides';
import { guideEvolutionLabel, guideMemorySummary, guideOptions } from '../guide-team';
import EntryArtwork from './EntryArtwork.vue';
import LoadoutItem from './LoadoutItem.vue';
import ResonanceSummary from './ResonanceSummary.vue';
import './guide-team.css';

const props = defineProps<{ team: GuideTeam; entries: EntryView[]; guideName?: string; notes?: string }>();
const byId = computed(() => new Map(props.entries.map(entry => [entry.id, entry])));
const positions = computed(() => teamPositions.map(position => ({ position, member: props.team.members.find(member => member.position === position) })));
/** 保留配置中的资料身份，资料失效时给出可读状态。 */
const entryName = (id: string, empty = '未配置'): string => id ? byId.value.get(id)?.name ?? '资料暂不可用' : empty;
/** 头像缺失时沿用现有分类占位图，不提供深色底图。 */
const artwork = (id: string, category: CatalogEntry['category']): Pick<CatalogEntry, 'name' | 'image' | 'category'> => byId.value.get(id) ?? { name: entryName(id), image: '', category };
/** 实际辅助机品级，不借用图鉴初始品级。 */
const petQuality = (member: GuideMember): string => guideOptions(byId.value.get(member.pet.petId))?.partnerQualities?.find(quality => quality.quality === member.pet.quality)?.label ?? (member.pet.quality ? '原品级不可用' : '未选品级');
/** 实际谐振阶段描述和源件数。 */
const harmonization = (member: GuideMember) => guideOptions(byId.value.get(member.weaponId))?.harmonizationLevels?.find(level => level.level === member.harmonization.level);
/** 把成员的上下位共鸣转换为统一合计输入。 */
const resonanceSummary = (member: GuideMember) => ({ upper: member.memoryResonance.upper.map(item => ({ kind: 'entry' as const, value: item.resonanceId, count: item.count })), lower: member.memoryResonance.lower.map(item => ({ kind: 'entry' as const, value: item.resonanceId, count: item.count })) });
</script>

<template>
  <section class="guide-team-overview" aria-label="队伍配置一图流">
    <header class="guide-overview-heading">
      <h2>队伍配置</h2>
      <span class="guide-overview-member-count"><Users :size="15" />{{ team.members.length }} / 3</span>
    </header>
    <div class="guide-overview-grid">
      <article v-for="{ position, member } in positions" :key="position" class="guide-member-card" :data-position="position" :data-member-id="member?.id">
        <div class="guide-card-position"><span>{{ teamPositionLabels[position] }}</span><div v-if="member" class="guide-role-badges"><span v-if="team.captainMemberId === member.id"><Crown :size="12" />队长</span><span v-if="team.starterMemberId === member.id"><Flag :size="12" />首发</span></div></div>
        <template v-if="member">
          <div class="guide-card-character">
            <EntryArtwork :entry="artwork(member.characterId, 'character')" eager />
            <div><h3>{{ entryName(member.characterId, '未选择机体') }}</h3><strong class="guide-evolution">{{ guideEvolutionLabel(member, entries) }}</strong><p v-if="byId.get(member.characterId)"><DictionaryBadge :entries="entries" :value="byId.get(member.characterId)?.element" type="属性" /> <DictionaryBadge :entries="entries" :value="byId.get(member.characterId)?.profession" type="职业" /></p></div>
          </div>
          <section class="guide-card-section">
            <h4>意识搭配</h4>
            <div v-if="guideMemorySummary(member, entries).length" class="guide-memory-chips">
              <div v-for="allocation in guideMemorySummary(member, entries)" :key="allocation.memoryId" class="guide-memory-chip" :class="{ 'has-harmonization': allocation.bonusCount }">
                <LoadoutItem :entry="byId.get(allocation.memoryId)" :count="allocation.totalCount" :size="40" :extra="`基础 ${allocation.baseCount} 件 + 谐振 ${allocation.bonusCount} 件`" />

              </div>
            </div>
            <p v-else class="guide-config-empty">尚未配置意识</p>
            <ResonanceSummary :resonance="resonanceSummary(member)" :entries="entries" />
          </section>
          <section class="guide-card-section">
            <div class="guide-equipped-heading"><LoadoutItem :entry="byId.get(member.weaponId)" /><div><h4>武器</h4><strong>{{ entryName(member.weaponId) }}</strong></div></div>
            <div class="loadout-icon-row" aria-label="武器共鸣"><LoadoutItem v-for="slot in 3" :key="slot" :entry="byId.get(member.weaponResonanceIds[slot - 1])" :extra="`武器共鸣槽 ${slot}`" /></div>
            <div class="guide-harmonization"><span>谐振</span><div v-if="member.harmonization.level"><strong>{{ harmonization(member)?.label || '原阶段不可用' }}</strong><p><LoadoutItem :entry="byId.get(member.harmonization.memoryId)" :size="32" :count="harmonization(member)?.bonusPieces" :extra="`${harmonization(member)?.label || '谐振'} · 额外 ${harmonization(member)?.bonusPieces || 0} 件`" /></p></div><em v-else>未配置</em></div>
          </section>
          <section class="guide-card-section">
            <div class="guide-equipped-heading"><LoadoutItem :entry="byId.get(member.pet.petId)" /><div><h4>辅助机</h4><strong>{{ entryName(member.pet.petId) }}</strong><span v-if="member.pet.petId" class="guide-pet-quality">{{ petQuality(member) }}</span></div></div>
            <template v-if="member.pet.petId">
              <div class="guide-pet-active"><span>主动</span><div class="loadout-icon-row"><LoadoutItem v-if="member.pet.activeSkillId" :entry="byId.get(member.pet.petId)" :skill-id="member.pet.activeSkillId" /><em v-else>未配置</em></div></div>
              <div class="guide-pet-passive"><span>被动</span><div v-if="member.pet.passiveSkillIds.length" class="loadout-icon-row"><LoadoutItem v-for="skillId in member.pet.passiveSkillIds" :key="skillId" :entry="byId.get(member.pet.petId)" :skill-id="skillId" /></div><em v-else>未配置</em></div>
            </template>
          </section>
          <p v-if="member.notes" class="guide-member-notes">{{ member.notes }}</p>
        </template>
        <div v-else class="guide-empty-position"><Users :size="30" :stroke-width="1.2" /><p>空站位</p></div>
      </article>
    </div>
    <footer class="guide-team-effects"><span><Sparkles :size="16" />队伍效应</span><div v-if="team.effectIds.length"><strong v-for="effectId in team.effectIds" :key="effectId"><DictionaryBadge :entries="entries" :value="entryName(effectId)" type="队伍效应" /></strong></div><p v-else>未配置</p></footer>
    <p v-if="notes" class="guide-overview-notes">{{ notes }}</p>
  </section>
</template>
