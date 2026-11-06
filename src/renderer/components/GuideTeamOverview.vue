<script setup lang="ts">
import { computed } from 'vue';
import { Crown, Flag, Sparkles, Users } from 'lucide-vue-next';
import type { CatalogEntry, EntryView } from '../../shared/types';
import { teamPositions, teamPositionLabels, type GuideMember, type GuideTeam } from '../../shared/guides';
import { guideEvolutionLabel, guideMemorySummary, guideOptions, guidePetSkillLabel, guideResonanceLabel } from '../guide-team';
import EntryArtwork from './EntryArtwork.vue';
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
/** 上下位分别展示每类共鸣及数量，空槽也明确可见。 */
const resonanceSummary = (member: GuideMember, side: 'upper' | 'lower'): string[] => member.memoryResonance[side].map(allocation => `${guideResonanceLabel(byId.value.get(allocation.resonanceId))} × ${allocation.count}`);
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
            <div><h3>{{ entryName(member.characterId, '未选择机体') }}</h3><strong class="guide-evolution">{{ guideEvolutionLabel(member, entries) }}</strong><p v-if="byId.get(member.characterId)">{{ [byId.get(member.characterId)?.element, byId.get(member.characterId)?.profession].filter(Boolean).join(' · ') }}</p></div>
          </div>
          <section class="guide-card-section">
            <h4>意识搭配</h4>
            <div v-if="guideMemorySummary(member, entries).length" class="guide-memory-chips">
              <div v-for="allocation in guideMemorySummary(member, entries)" :key="allocation.memoryId" class="guide-memory-chip" :class="{ 'has-harmonization': allocation.bonusCount }">
                <span>{{ entryName(allocation.memoryId) }}</span><strong>{{ allocation.totalCount }} 件</strong>
                <small v-if="allocation.bonusCount">基础 {{ allocation.baseCount }} + 谐振 {{ allocation.bonusCount }}</small>
              </div>
            </div>
            <p v-else class="guide-config-empty">尚未配置意识</p>
            <div class="guide-memory-resonance" aria-label="意识上下位共鸣">
              <div v-for="side in (['upper', 'lower'] as const)" :key="side"><span>{{ side === 'upper' ? '上位' : '下位' }}</span><ul v-if="resonanceSummary(member, side).length"><li v-for="(text, index) in resonanceSummary(member, side)" :key="index">{{ text }}</li></ul><em v-else>未配置</em></div>
            </div>
          </section>
          <section class="guide-card-section">
            <div class="guide-equipped-heading"><EntryArtwork :entry="artwork(member.weaponId, 'weapon')" small eager /><div><h4>武器</h4><strong>{{ entryName(member.weaponId) }}</strong></div></div>
            <ol class="guide-weapon-resonances" aria-label="武器共鸣">
              <li v-for="slot in 3" :key="slot"><span>{{ slot }}</span>{{ entryName(member.weaponResonanceIds[slot - 1] || '') }}</li>
            </ol>
            <div class="guide-harmonization"><span>谐振</span><div v-if="member.harmonization.level"><strong>{{ harmonization(member)?.label || '原阶段不可用' }}</strong><p>{{ entryName(member.harmonization.memoryId) }}<template v-if="harmonization(member)"> +{{ harmonization(member)!.bonusPieces }} 件</template></p></div><em v-else>未配置</em></div>
          </section>
          <section class="guide-card-section">
            <div class="guide-equipped-heading"><EntryArtwork :entry="artwork(member.pet.petId, 'pet')" small eager /><div><h4>辅助机</h4><strong>{{ entryName(member.pet.petId) }}</strong><span v-if="member.pet.petId" class="guide-pet-quality">{{ petQuality(member) }}</span></div></div>
            <template v-if="member.pet.petId">
              <div class="guide-pet-active"><span>主动</span><p>{{ guidePetSkillLabel(byId.get(member.pet.petId), member.pet.activeSkillId) }}</p></div>
              <div class="guide-pet-passive"><span>被动</span><ul v-if="member.pet.passiveSkillIds.length" class="guide-passive-chips"><li v-for="skillId in member.pet.passiveSkillIds" :key="skillId">{{ guidePetSkillLabel(byId.get(member.pet.petId), skillId) }}</li></ul><em v-else>未配置</em></div>
            </template>
          </section>
          <p v-if="member.notes" class="guide-member-notes">{{ member.notes }}</p>
        </template>
        <div v-else class="guide-empty-position"><Users :size="30" :stroke-width="1.2" /><p>空站位</p></div>
      </article>
    </div>
    <footer class="guide-team-effects"><span><Sparkles :size="16" />队伍效应</span><div v-if="team.effectIds.length"><strong v-for="effectId in team.effectIds" :key="effectId">{{ entryName(effectId) }}</strong></div><p v-else>未配置</p></footer>
    <p v-if="notes" class="guide-overview-notes">{{ notes }}</p>
  </section>
</template>
