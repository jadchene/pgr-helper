import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import type { CatalogSnapshot } from '../src/shared/types';
import type { GuideDocument } from '../src/shared/guides';
import { CatalogStore } from '../src/main/store';
import { buildGuideFixture, loadGuideSnapshot } from './helpers/guide-fixture';

const repository = process.env.PGR_DATA_REPOSITORY;
const directories: string[] = [];
const stores: CatalogStore[] = [];
let snapshot: CatalogSnapshot;
let guide: GuideDocument;

/** 临时数据库目录仅由当前用例持有，不触及程序真实 data。 */
const directory = (): string => {
  const path = mkdtempSync(join(tmpdir(), 'pgr-guide-store-test-'));
  directories.push(path);
  return path;
};

/** 登记数据库句柄，并按需安装完整真实源快照。 */
const open = (path = directory(), install = true): CatalogStore => {
  const store = new CatalogStore(path);
  stores.push(store);
  if (install) store.applySnapshot(snapshot, '攻略真实源验证');
  return store;
};

/** 对完整应用状态做摘要，失败恢复不能悄悄改变其他表。 */
const digest = (store: CatalogStore): string => createHash('sha256').update(JSON.stringify(store.getState())).digest('hex');

afterEach(() => {
  for (const store of stores.splice(0)) {
    try { store.close(); } catch { /* 重启测试中的旧连接可能已经关闭。 */ }
  }
  for (const path of directories.splice(0)) {
    const target = resolve(path);
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('pgr-guide-store-test-')) throw new Error('拒绝清理非攻略测试目录');
    rmSync(target, { recursive: true, force: true });
  }
});

describe.skipIf(!repository || !existsSync(repository))('攻略 SQLite 与完整备份', () => {
  beforeAll(async () => {
    snapshot = await loadGuideSnapshot(repository!);
    guide = buildGuideFixture(snapshot.entries);
  }, 30_000);

  it('完整三人攻略保存修改并重启，重复QTE、并行分支、装备及SSS3完整保留', () => {
    const path = directory();
    let store = open(path);
    const created = store.saveGuide(guide, null);
    expect(created).toMatchObject({ ...guide, hidden: false, revision: 1 });
    expect(created.createdAt).toBe(created.updatedAt);
    const changed = { ...guide, notes: '重启后仍在的攻略备注', name: `${guide.name}修订` };
    const saved = store.saveGuide(changed, created.revision);
    expect(saved.revision).toBe(2);
    store.close();
    store = open(path, false);
    expect(store.listGuides()).toEqual([saved]);
    expect(store.getState().guides).toEqual([saved]);
    expect(saved.flow.nodes[0].branches[0][0].qteMemberIds).toEqual(guide.flow.nodes[0].branches[0][0].qteMemberIds);
    expect(saved.team.members[0].evolutionId).toBe('5:3');
  });

  it('重复创建、旧修订和已回收编辑拒绝，回收恢复保留全部内容并更新修订', () => {
    const path = directory();
    const first = open(path);
    const second = open(path, false);
    const original = first.saveGuide(guide, null);
    expect(() => second.saveGuide(guide, null)).toThrow(/更新/);
    const edited = first.saveGuide({ ...guide, notes: '窗口一的新备注' }, original.revision);
    expect(() => second.saveGuide({ ...guide, notes: '过期窗口的备注' }, original.revision)).toThrow(/更新/);
    expect(() => second.setGuideHidden(guide.id, true, original.revision)).toThrow(/更新/);
    const hidden = first.setGuideHidden(guide.id, true, edited.revision);
    expect(hidden).toMatchObject({ hidden: true, revision: 3, notes: '窗口一的新备注' });
    expect(() => first.saveGuide(guide, hidden.revision)).toThrow(/恢复/);
    const restored = second.setGuideHidden(guide.id, false, hidden.revision);
    expect(restored).toMatchObject({ hidden: false, revision: 4, team: guide.team, flow: guide.flow });
    expect(first.listGuides()).toEqual([restored]);
  });

  it('基础资料更新、条目退役和版本回退不会修改攻略培养配置与流程', () => {
    const store = open();
    const saved = store.saveGuide(guide, null);
    const firstVersion = store.getState().currentVersion!.id;
    const retiredStageId = guide.stageIds[0];
    const next = { ...snapshot, revision: 'b'.repeat(40), version: '测试新版', entries: snapshot.entries.filter(entry => entry.id !== retiredStageId).map(entry => ({ ...entry, relatedIds: entry.relatedIds.filter(id => id !== retiredStageId), ...(entry.id === guide.team.members[0].characterId ? { description: '源机体说明更新' } : {}) })) };
    store.applySnapshot(next, '基础资料变化');
    expect(store.listEntries().find(entry => entry.id === retiredStageId)?.retired).toBe(true);
    expect(store.listGuides()).toEqual([saved]);
    store.rollback(firstVersion);
    expect(store.listEntries().find(entry => entry.id === retiredStageId)?.retired).toBe(false);
    expect(store.listGuides()).toEqual([saved]);
  });

  it('备份跨库恢复攻略、回收状态、修订与源版本，恢复后可继续编辑', () => {
    const store = open();
    const saved = store.saveGuide(guide, null);
    const another: GuideDocument = { ...structuredClone(guide), id: 'guide:second-guide-0001', name: '单套备份攻略', flow: { ...structuredClone(guide.flow), mode: 'single' } };
    const second = store.saveGuide(another, null);
    store.setGuideHidden(second.id, true, second.revision);
    const path = join(directory(), 'guides-backup.json');
    store.exportBackup(path);
    const restoredDirectory = directory();
    let restored = open(restoredDirectory, false);
    restored.importBackup(path);
    expect(restored.listGuides()).toEqual(store.listGuides());
    expect(restored.getCurrentSnapshot()).toEqual(store.getCurrentSnapshot());
    restored.close();
    restored = open(restoredDirectory, false);
    const edited = restored.saveGuide({ ...guide, notes: '恢复后的新备注' }, saved.revision);
    expect(edited.revision).toBe(saved.revision + 1);
    expect(edited.notes).toBe('恢复后的新备注');
    expect(restored.listGuides().find(value => value.id === second.id)?.hidden).toBe(true);
  }, 30_000);

  it('格式、重复攻略和非法在场QTE备份均拒绝，事务内失败也完整回滚', () => {
    const store = open();
    store.saveGuide(guide, null);
    const validPath = join(directory(), 'valid.json');
    store.exportBackup(validPath);
    const validText = readFileSync(validPath, 'utf8');
    const before = digest(store);
    const malformed = join(directory(), 'malformed.json');
    writeFileSync(malformed, '{bad json');
    expect(() => store.importBackup(malformed)).toThrow();
    expect(digest(store)).toBe(before);
    const duplicate = JSON.parse(validText);
    duplicate.guides.push(duplicate.guides[0]);
    const duplicatePath = join(directory(), 'duplicate.json');
    writeFileSync(duplicatePath, JSON.stringify(duplicate));
    expect(() => store.importBackup(duplicatePath)).toThrow(/重复攻略/);
    expect(digest(store)).toBe(before);
    const invalidQte = JSON.parse(validText);
    invalidQte.guides[0].flow.nodes[0].branches[0][0].qteMemberIds = [guide.team.starterMemberId];
    const invalidQtePath = join(directory(), 'invalid-qte.json');
    writeFileSync(invalidQtePath, JSON.stringify(invalidQte));
    expect(() => store.importBackup(invalidQtePath)).toThrow(/在场|流程/);
    expect(digest(store)).toBe(before);
    store.db.exec("CREATE TRIGGER reject_guide_restore BEFORE INSERT ON guides BEGIN SELECT RAISE(ABORT, 'simulated guide write failure'); END;");
    expect(() => store.importBackup(validPath)).toThrow('simulated guide write failure');
    expect(digest(store)).toBe(before);
  }, 30_000);

  it('五份完整61表历史版本和三人攻略可完整备份恢复，并记录真实备份体积', () => {
    const store = open();
    const saved = store.saveGuide(guide, null);
    for (const character of ['b', 'c', 'd', 'e']) store.applySnapshot({ ...snapshot, revision: character.repeat(40), version: `完整历史 ${character}` }, '完整源版本');
    const path = join(directory(), 'five-versions.json');
    store.exportBackup(path);
    const bytes = statSync(path).size;
    console.log(`完整攻略备份体积：${bytes} 字节；5 个版本 × ${snapshot.entries.length} 条，另含当前源条目与攻略。`);
    const restored = open(undefined, false);
    restored.importBackup(path);
    expect(restored.listVersions()).toHaveLength(5);
    expect(restored.listEntries()).toHaveLength(1799);
    expect(restored.listGuides()).toEqual([saved]);
    expect(restored.getCurrentSnapshot()?.revision).toBe('e'.repeat(40));
  }, 60_000);
});
