import { describe, expect, it } from 'vitest';
import { summarizeResonances } from '../src/renderer/loadout-summary';

describe('共鸣合计', () => {
  it('合并上下位与同侧重复条目，并保留各侧数量', () => {
    const result = summarizeResonances({ upper: [{ kind: 'skillType', value: '攻击', count: 2 }, { kind: 'skillType', value: '攻击', count: 1 }], lower: [{ kind: 'skillType', value: '攻击', count: 3 }, { kind: 'skillType', value: '核心', count: 3 }] }, []);
    expect(result.map(({ label, count, upper, lower }) => ({ label, count, upper, lower }))).toEqual([{ label: '攻击', count: 6, upper: 3, lower: 3 }, { label: '核心', count: 3, upper: 0, lower: 3 }]);
  });
  it('不将同名技能类型与具体共鸣身份混为一个配置', () => {
    const result = summarizeResonances({ upper: [{ kind: 'skillType', value: 'same', count: 2 }], lower: [{ kind: 'entry', value: 'same', count: 3 }] }, []);
    expect(result).toHaveLength(2);
    expect(summarizeResonances({ upper: [], lower: [] }, [])).toEqual([]);
  });
});
