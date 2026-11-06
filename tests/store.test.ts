import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import type { AppSettings, CatalogEntry, CatalogSnapshot } from '../src/shared/types';
import { CatalogStore } from '../src/main/store';

const directories: string[] = [];
const stores: CatalogStore[] = [];

/** 创建仅由此测试持有的临时目录。 */
const directory = (): string => {
  const result = mkdtempSync(join(tmpdir(), 'pgr-store-test-'));
  directories.push(result);
  return result;
};
/** 独立资料样本，围绕用户可观察的数据结果断言。 */
const item = (id: string, changes: Partial<CatalogEntry> = {}): CatalogEntry => ({
  id, category: 'character', name: '露西亚', subtitle: '原始副标题', description: '原始简介', aliases: [], tags: ['测试'],
  element: '雷', profession: '进攻型', rarity: 'S', image: '', attributes: { '定位': '输出' }, sections: [], relatedIds: [],
  sourceKey: id.startsWith('local:') ? '' : id.split(':')[1], ...changes,
});
/** 生成可独立选择的资料版本。 */
const snapshot = (revision: string, entries: CatalogEntry[]): CatalogSnapshot => ({
  schemaVersion: 1, provider: 'myssal', region: 'cn', revision: revision.repeat(40), version: `CN ${revision}`,
  builtAt: '2026-11-06T00:00:00.000Z', fingerprints: { 'test.json': 'f'.repeat(64) }, entries, warnings: [],
});
/** 登记数据库，保证失败的测试也能关闭连接。 */
const open = (path = directory(), initialSnapshot?: CatalogSnapshot): CatalogStore => {
  const store = new CatalogStore(path);
  stores.push(store);
  if (initialSnapshot) store.applySnapshot(initialSnapshot, '测试准备版本');
  return store;
};

afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.close(); } catch { /* 测试重启场景可能已关闭旧连接。 */ }
  }
  for (const path of directories.splice(0)) {
    const target = resolve(path);
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('pgr-store-test-')) throw new Error('拒绝清理非测试目录');
    rmSync(target, { recursive: true, force: true });
  }
});

describe('SQLite 资料与用户修改', () => {
  it('首次启动是空库，仅配置远程仓库且不自动检查', () => {
    const store = open();
    expect(store.listEntries()).toEqual([]);
    expect(store.listVersions()).toEqual([]);
    expect(store.getCurrentSnapshot()).toBeNull();
    expect(store.getSettings()).toMatchObject({ checkOnStartup: false, activeSourceId: 'myssal-github', sources: [{ id: 'myssal-github', transport: 'github' }] });
    expect(store.getSettings().sources).toHaveLength(1);
    expect(store.getSettings().sources[0]).not.toHaveProperty('directory');
  });

  it('新设置接口拒绝本地来源和遗留目录字段，不改变设置', () => {
    const store = open();
    const settings = store.getSettings();
    expect(() => store.saveSettings({ ...settings, sources: [{ ...settings.sources[0], transport: 'directory', directory: 'X:/old' }] } as unknown as AppSettings)).toThrow();
    expect(() => store.saveSettings({ ...settings, sources: [{ ...settings.sources[0], directory: '' }] } as unknown as AppSettings)).toThrow();
    expect(store.getSettings()).toEqual(settings);
  });

  it('本地新增、修改、回收与恢复经过数据库重启后仍完整保留', () => {
    const path = directory();
    let store = open(path);
    const local = item('local:manual-0001', { name: '我的机体', image: 'data:image/png;base64,aGVsbG8=' });
    store.saveEntry(local);
    store.saveEntry({ ...local, name: '修订机体', sections: [{ title: '说明', body: '用户保存的正文' }] });
    store.setHidden(local.id, true);
    store.close();
    store = open(path);
    expect(store.listEntries()).toEqual([expect.objectContaining({ name: '修订机体', hidden: true, origin: 'local', image: local.image, sections: [{ title: '说明', body: '用户保存的正文' }] })]);
    store.setHidden(local.id, false);
    store.close();
    store = open(path);
    expect(store.listEntries()[0].hidden).toBe(false);
  });

  it('只覆盖用户修改字段，源描述和新增属性继续随新版本更新', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    store.saveEntry({ ...original, name: '我的简称' });
    store.applySnapshot(snapshot('b', [{ ...original, description: '新版简介', attributes: { ...original.attributes, '效应': '焚烧' } }]), '新资料');
    expect(store.listEntries()[0]).toMatchObject({ name: '我的简称', description: '新版简介', attributes: { '定位': '输出', '效应': '焚烧' }, modified: true });
    store.resetEntry(original.id);
    expect(store.listEntries()[0]).toMatchObject({ name: original.name, description: '新版简介', modified: false });
  });

  it('编辑来源名称不锁住排序和专属筛选，后续同步继续采用新的来源规则', () => {
    const original = item('character:1', { catalog: { order: [100], basis: 'source-priority', facets: { enhancement: ['无跃升技能'] } } });
    const store = open(undefined, snapshot('a', [original]));
    store.saveEntry({ ...original, name: '我的名称' });
    const next = { ...original, catalog: { ...original.catalog!, order: [110], facets: { enhancement: ['有跃升技能'] } } };
    store.applySnapshot(snapshot('b', [next]), '更新排序和筛选');
    expect(store.listEntries()[0]).toMatchObject({ name: '我的名称', catalog: next.catalog });
  });

  it('技能分类经编辑、同步、重启和备份恢复后保留，普通备注可共存', () => {
    const original = item('pet:1', { category: 'pet', sections: [{ title: '技能原名', body: '物理伤害 800%', skill: {
      kind: 'pet-active', id: 'main:1:11', groupId: 'pet-active', groupName: '主动技能', groupOrder: 1,
      familyId: 'main:1', familyName: '主动技能 1', typeName: '主动技能', level: 5, element: { id: 1, name: '物理' },
    } }] });
    const path = directory();
    let store = open(path, snapshot('a', [original]));
    store.saveEntry({ ...original, name: '个人名称' });
    const next = { ...original, sections: original.sections.map(section => ({ ...section, body: '物理伤害 900%' })) };
    store.applySnapshot(snapshot('b', [next]), '技能更新');
    expect(store.listEntries()[0]).toMatchObject({ name: '个人名称', sections: next.sections });
    const sections = [{ ...next.sections[0], title: '自定义技能名称', body: '个人完整说明' }, { title: '个人备注', body: '用于日常' }];
    store.saveEntry({ ...next, name: '个人名称', sections });
    store.applySnapshot(snapshot('c', [{ ...next, sections: original.sections }]), '再次同步');
    store.close();
    store = open(path);
    expect(store.listEntries()[0].sections).toEqual(sections);
    const backupPath = join(directory(), 'skills.json');
    store.exportBackup(backupPath);
    const restored = open();
    restored.importBackup(backupPath);
    expect(restored.listEntries()[0].sections).toEqual(sections);
    restored.resetEntry(original.id);
    expect(restored.listEntries()[0].sections).toEqual(original.sections);
  });

  it('拒绝无效技能结构且不改动已有资料', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    const invalid = { ...original, sections: [{ title: '技能', body: '正文', skill: { kind: 'character', groupOrder: Number.NaN } }] };
    expect(() => store.saveEntry(invalid as CatalogEntry)).toThrow();
    expect(store.listEntries()[0].sections).toEqual([]);
  });

  it('属性逐键增改删与上游新增并存，重启和备份恢复后仍按键保留', () => {
    const original = item('character:1', { attributes: { '定位': '输出', '旧说明': '用户要删除', '版本说明': '旧值' } });
    const path = directory();
    let store = open(path, snapshot('a', [original]));
    store.saveEntry({ ...original, attributes: { '定位': '辅助', '版本说明': '旧值', '个人备注': '常用' } });
    const next = { ...original, attributes: { '定位': '进攻', '旧说明': '源里仍有', '版本说明': '新值', '新增效应': '焚烧' } };
    store.applySnapshot(snapshot('b', [next]), '新增属性版本');
    store.close();
    store = open(path);
    const expected = { '定位': '辅助', '版本说明': '新值', '新增效应': '焚烧', '个人备注': '常用' };
    expect(store.listEntries()[0].attributes).toEqual(expected);
    const backupPath = join(directory(), 'attributes.json');
    store.exportBackup(backupPath);
    const restored = open();
    restored.importBackup(backupPath);
    expect(restored.listEntries()[0].attributes).toEqual(expected);
    restored.applySnapshot(snapshot('c', [{ ...next, attributes: { ...next.attributes, '版本说明': '再更新', '新增机制': '冻结' } }]), '再次更新');
    expect(restored.listEntries()[0].attributes).toEqual({ ...expected, '版本说明': '再更新', '新增机制': '冻结' });
    restored.resetEntry(original.id);
    expect(restored.listEntries()[0].attributes).toEqual({ ...next.attributes, '版本说明': '再更新', '新增机制': '冻结' });
  });

  it('更新版本数据库被拒绝打开且不降低其结构版本', () => {
    const path = directory();
    const store = open(path, snapshot('a', [item('character:1')]));
    store.db.exec('PRAGMA user_version=2');
    expect(() => new CatalogStore(path)).toThrow(/更新版本/);
    expect(store.db.prepare('PRAGMA user_version').get()?.user_version).toBe(2);
    expect(store.getCurrentSnapshot()?.revision).toBe('a'.repeat(40));
  });

  it('回收站条目不会被同步或恢复源原文复活，用户恢复后才显示', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    store.saveEntry({ ...original, name: '本地别名' });
    store.setHidden(original.id, true);
    store.applySnapshot(snapshot('b', [{ ...original, description: '更新后的说明' }]), '新资料');
    expect(store.listEntries()[0]).toMatchObject({ hidden: true, name: '本地别名' });
    store.resetEntry(original.id);
    expect(store.listEntries()[0]).toMatchObject({ hidden: true, name: original.name, modified: false });
    store.setHidden(original.id, false);
    expect(store.listEntries()[0]).toMatchObject({ hidden: false, description: '更新后的说明' });
  });

  it('上游移除保留退役原文与本地修改，再次出现时解除退役且不覆盖修改', () => {
    const original = item('character:1');
    const other = item('character:2', { name: '其他机体' });
    const store = open(undefined, snapshot('a', [original, other]));
    store.saveEntry({ ...original, name: '自定义名称' });
    store.applySnapshot(snapshot('b', [other]), '移除版本');
    expect(store.listEntries().find(row => row.id === original.id)).toMatchObject({ retired: true, name: '自定义名称', hidden: false });
    store.applySnapshot(snapshot('c', [{ ...original, description: '恢复的新版说明' }, other]), '恢复版本');
    expect(store.listEntries().find(row => row.id === original.id)).toMatchObject({ retired: false, name: '自定义名称', description: '恢复的新版说明' });
  });

  it('回退基础版本不改本地修改、本地新增和回收站状态', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    const firstVersion = store.getState().currentVersion!.id;
    store.saveEntry({ ...original, name: '个人名称' });
    store.setHidden(original.id, true);
    store.saveEntry(item('local:manual-0002', { name: '用户新增' }));
    store.applySnapshot(snapshot('b', [{ ...original, description: '新版' }, item('character:2')]), '新版');
    store.rollback(firstVersion);
    expect(store.getCurrentSnapshot()?.revision).toBe('a'.repeat(40));
    expect(store.listEntries().find(row => row.id === original.id)).toMatchObject({ name: '个人名称', description: original.description, hidden: true });
    expect(store.listEntries().find(row => row.id === 'character:2')?.retired).toBe(true);
    expect(store.listEntries().find(row => row.id === 'local:manual-0002')).toMatchObject({ name: '用户新增', retired: false });
  });

  it('重复源主键和断裂引用在写入前被拒绝，已有版本不变', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    const before = store.getState();
    expect(() => store.applySnapshot(snapshot('b', [original, original]), '重复')).toThrow(/重复/);
    expect(() => store.applySnapshot(snapshot('c', [{ ...original, relatedIds: ['weapon:missing'] }]), '断链')).toThrow(/引用缺失/);
    expect(store.getState()).toEqual(before);
  });

  it('启用版本中途写入失败时，版本清单、旧条目和退役状态一起回滚', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    const before = store.getState();
    store.db.exec("CREATE TRIGGER simulate_write_error BEFORE INSERT ON source_entries WHEN NEW.id='character:2' BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;");
    expect(() => store.applySnapshot(snapshot('b', [{ ...original, description: '不应生效' }, item('character:2')]), '失败版本')).toThrow('simulated disk failure');
    expect(store.getState()).toEqual(before);
    expect(store.getCurrentSnapshot()?.entries).toEqual([original]);
  });

  it('本地条目必须使用独立标识且关联真实存在的资料', () => {
    const store = open();
    expect(() => store.saveEntry(item('character:unknown'))).toThrow(/本地标识/);
    expect(() => store.saveEntry(item('local:manual-0003', { relatedIds: ['weapon:missing'] }))).toThrow(/关联资料/);
    expect(store.listEntries()).toEqual([]);
  });
});

describe('完整备份', () => {
  it('尚未同步的空库也能备份和恢复，不引入基础资料', () => {
    const store = open();
    const path = join(directory(), 'empty-backup.json');
    store.exportBackup(path);
    const restored = open();
    restored.importBackup(path);
    expect(restored.listEntries()).toEqual([]);
    expect(restored.listVersions()).toEqual([]);
    expect(restored.getCurrentSnapshot()).toBeNull();
    expect(restored.getSettings()).toEqual(store.getSettings());
  });

  it('跨数据库恢复偏好、历史版本、退役资料、覆盖、回收站及内嵌图片', () => {
    const original = item('character:1');
    const retired = item('character:2', { name: '退役机体' });
    const store = open(undefined, snapshot('a', [original, retired]));
    store.applySnapshot(snapshot('b', [{ ...original, description: '新版简介' }]), '国服新版本');
    store.saveEntry({ ...original, description: '新版简介', name: '个人简称', relatedIds: [retired.id] });
    store.setHidden(original.id, true);
    store.saveEntry(item('local:manual-0004', { image: 'data:image/png;base64,aGVsbG8=', relatedIds: [original.id] }));
    store.setHidden('local:manual-0004', true);
    store.saveSettings({ ...store.getSettings(), theme: 'dark', viewMode: 'list', checkOnStartup: true });
    const path = join(directory(), 'backup.json');
    store.exportBackup(path);
    const restored = open(undefined, snapshot('c', [item('character:obsolete')]));
    restored.importBackup(path);
    expect(restored.listEntries()).toEqual(store.listEntries());
    expect(restored.getSettings()).toEqual(store.getSettings());
    expect(restored.getCurrentSnapshot()).toEqual(store.getCurrentSnapshot());
    expect(restored.listVersions().map(({ revision, sourceName, count }) => ({ revision, sourceName, count }))).toEqual(store.listVersions().map(({ revision, sourceName, count }) => ({ revision, sourceName, count })));
  });

  it('无效备份和事务内唯一约束失败都不会破坏已有库', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    store.saveEntry({ ...original, name: '个人修改' });
    const path = join(directory(), 'backup.json');
    store.exportBackup(path);
    const backup = JSON.parse(readFileSync(path, 'utf8'));
    const before = store.getState();
    const malformed = join(directory(), 'malformed.json');
    writeFileSync(malformed, '{bad');
    expect(() => store.importBackup(malformed)).toThrow();
    expect(store.getState()).toEqual(before);
    backup.overrides.push(backup.overrides[0]);
    const conflict = join(directory(), 'conflict.json');
    writeFileSync(conflict, JSON.stringify(backup));
    expect(() => store.importBackup(conflict)).toThrow();
    expect(store.getState()).toEqual(before);
  });

  it('导出到已存在文件时保留文件内容及当前数据库', () => {
    const store = open(undefined, snapshot('a', [item('character:1')]));
    const path = join(directory(), 'existing.json');
    writeFileSync(path, 'existing');
    const before = store.getState();
    expect(() => store.exportBackup(path)).toThrow();
    expect(readFileSync(path, 'utf8')).toBe('existing');
    expect(store.getState()).toEqual(before);
  });

  it('拒绝备份中本地关联产生的断链，保持原库', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    store.saveEntry(item('local:manual-0005', { relatedIds: [original.id] }));
    const path = join(directory(), 'backup.json');
    store.exportBackup(path);
    const backup = JSON.parse(readFileSync(path, 'utf8'));
    backup.localEntries[0].entry.relatedIds = ['weapon:missing'];
    const broken = join(directory(), 'broken.json');
    writeFileSync(broken, JSON.stringify(backup));
    const before = store.getState();
    expect(() => store.importBackup(broken)).toThrow();
    expect(store.getState()).toEqual(before);
  });

  it('拒绝字段修正中产生的断链，即使原始源版本的引用仍合法', () => {
    const original = item('character:1');
    const store = open(undefined, snapshot('a', [original]));
    store.saveEntry({ ...original, name: '个人名称' });
    const path = join(directory(), 'backup.json');
    store.exportBackup(path);
    const backup = JSON.parse(readFileSync(path, 'utf8'));
    backup.overrides[0].patch.relatedIds = ['weapon:missing'];
    const broken = join(directory(), 'broken-override.json');
    writeFileSync(broken, JSON.stringify(backup));
    const before = store.getState();
    expect(() => store.importBackup(broken)).toThrow();
    expect(store.getState()).toEqual(before);
  });

  it('同一上游提交重建过资料包时，备份仍恢复用户实际选中的版本', () => {
    const original = item('character:1');
    const first = snapshot('a', [original]);
    const second = { ...first, version: '同提交重新规范化', entries: [{ ...original, description: '重新规范化后的正文' }] };
    const store = open(undefined, first);
    const firstId = store.getState().currentVersion!.id;
    store.applySnapshot(second, '重新构建');
    store.rollback(firstId);
    const path = join(directory(), 'backup.json');
    store.exportBackup(path);
    const restored = open();
    restored.importBackup(path);
    expect(restored.getCurrentSnapshot()).toEqual(first);
    expect(restored.listEntries().find(row => row.id === original.id)?.description).toBe(original.description);
  });
});
