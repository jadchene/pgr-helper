import type { CatalogEntry } from '../shared/types';
import type { PresetResonance } from '../shared/presets';
import { guideResonanceLabel } from './guide-team';

/** 合并上下位相同共鸣，保留来源身份与各侧次数供详情展示。 */
export const summarizeResonances = (resonance: { upper: PresetResonance[]; lower: PresetResonance[] }, entries: readonly CatalogEntry[]) => {
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  const result = new Map<string, { key: string; kind: PresetResonance['kind']; entry?: CatalogEntry; label: string; count: number; upper: number; lower: number }>();
  for (const side of ['upper', 'lower'] as const) for (const item of resonance[side]) {
    const key = `${item.kind}:${item.value}`;
    const entry = item.kind === 'entry' ? byId.get(item.value) : undefined;
    const row = result.get(key) || { key, kind: item.kind, entry, label: item.kind === 'entry' ? guideResonanceLabel(entry) : item.value, count: 0, upper: 0, lower: 0 };
    row.count += item.count; row[side] += item.count; result.set(key, row);
  }
  return [...result.values()];
};
