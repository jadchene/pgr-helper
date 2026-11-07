import assert from 'node:assert/strict';
import { CatalogStore } from '../src/main/store';
import { validateGuide } from '../src/shared/guide-validation';
import { validatePreset } from '../src/shared/preset-validation';
import { guideRecordSchema } from '../src/main/guide-schema';
import { presetRecordSchema } from '../src/main/preset-schema';
import { resolve } from 'node:path';
const store = new CatalogStore(resolve(import.meta.dirname, '../data'));
try {
  const state = store.getState();
  const issues = [...state.guides.map(item => ({ name: item.name, schema: guideRecordSchema.safeParse(item).success, issues: validateGuide(item, state.entries) })), ...state.presets.map(item => ({ name: item.name, schema: presetRecordSchema.safeParse(item).success, issues: validatePreset(item, state.entries) }))];
  assert(issues.every(item => item.schema && item.issues.length === 0), '默认数据包含不符合规则的攻略或预设');
  console.log(JSON.stringify({ entries: state.entries.length, guides: state.guides.length, presets: state.presets.length, results: issues }, null, 2));
} finally { store.close(); }
