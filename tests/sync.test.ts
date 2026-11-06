import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import type { CatalogEntry, CatalogSnapshot } from '../src/shared/types';
import { CatalogStore } from '../src/main/store';
import { SyncService } from '../src/main/sync';

const stores: CatalogStore[] = [];
const directories: string[] = [];

/** 创建可以验证真实版本切换结果的最小资料。 */
const item = (id = 'character:1', name = '原机体'): CatalogEntry => ({
  id, category: 'character', name, subtitle: '', description: '', aliases: [], tags: [], element: '', profession: '',
  rarity: '', image: '', attributes: {}, sections: [], relatedIds: [], sourceKey: id.split(':')[1],
});
/** 为同步流程构造独立的有效来源版本。 */
const snapshot = (revision: string, entries: CatalogEntry[] = [item()]): CatalogSnapshot => ({
  schemaVersion: 1, provider: 'myssal', region: 'cn', revision: revision.repeat(40), version: `CN ${revision}`,
  builtAt: '2026-11-06T00:00:00.000Z', fingerprints: {}, entries, warnings: [],
});
/** 打开可观察持久化结果的真实 SQLite 仓库。 */
const createStore = (initialSnapshot: CatalogSnapshot | null = snapshot('a')): CatalogStore => {
  const path = mkdtempSync(join(tmpdir(), 'pgr-sync-test-'));
  directories.push(path);
  const store = new CatalogStore(path);
  stores.push(store);
  if (initialSnapshot) store.applySnapshot(initialSnapshot, '测试准备版本');
  return store;
};
/** 由测试控制完成时机，复现网络并发和取消。 */
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((success, failure) => { resolve = success; reject = failure; });
  return { promise, resolve, reject };
};

afterEach(() => {
  vi.restoreAllMocks();
  for (const store of stores.splice(0)) store.close();
  for (const path of directories.splice(0)) {
    const target = resolve(path);
    if (!target.startsWith(`${resolve(tmpdir())}${sep}`) || !basename(target).startsWith('pgr-sync-test-')) throw new Error('拒绝清理非测试目录');
    rmSync(target, { recursive: true, force: true });
  }
});

describe('同步候选生命周期', () => {
  it('空库首次远程同步先预览，用户应用后才产生基础资料', async () => {
    const store = createStore(null);
    const loader = vi.fn(async () => snapshot('a'));
    const sync = new SyncService(store, loader);
    expect(loader).not.toHaveBeenCalled();
    expect(store.getState().entries).toEqual([]);
    const preview = await sync.prepare('myssal-github');
    expect(loader.mock.calls).toHaveLength(1);
    expect(preview).toMatchObject({ added: 1, changed: 0, removed: 0, total: 1 });
    expect(store.getCurrentSnapshot()).toBeNull();
    expect(store.listEntries()).toEqual([]);
    sync.apply(preview.token);
    expect(store.listEntries()).toHaveLength(1);
    expect(store.getCurrentSnapshot()?.revision).toBe('a'.repeat(40));
  });

  it('空库首次远程失败保持空库，不留下版本或可应用候选', async () => {
    const store = createStore(null);
    const sync = new SyncService(store, async () => { throw new Error('远程连接失败'); });
    const before = store.getState();
    await expect(sync.prepare('myssal-github')).rejects.toThrow('远程连接失败');
    expect(store.getState()).toEqual(before);
    expect(() => sync.apply('missing')).toThrow(/失效/);
    await expect(sync.prepare('myssal-directory')).rejects.toThrow(/配置不存在/);
  });

  it('拉取和预览不改变有效资料，确认后才启用且令 token 失效', async () => {
    const store = createStore();
    const next = snapshot('b', [item('character:1', '更新机体'), item('character:2', '新增机体')]);
    const sync = new SyncService(store, async () => next);
    const before = store.getState();
    const preview = await sync.prepare('myssal-github');
    expect(preview).toMatchObject({ added: 1, changed: 1, removed: 0, total: 2 });
    expect(store.getState()).toEqual(before);
    sync.apply(preview.token);
    expect(store.getCurrentSnapshot()?.revision).toBe('b'.repeat(40));
    expect(store.listEntries().map(row => row.name)).toEqual(['更新机体', '新增机体']);
    expect(() => sync.apply(preview.token)).toThrow(/失效/);
  });

  it('并发准备被拒绝，取消后即使加载器晚到也不能生成候选或写入版本', async () => {
    const store = createStore();
    const task = deferred<CatalogSnapshot>();
    let signal: AbortSignal | undefined;
    const sync = new SyncService(store, async (_profile, abort, progress) => {
      signal = abort;
      progress({ busy: false, message: '正在读取', completed: 1, total: 2 });
      return task.promise;
    });
    const before = store.getState();
    const outcome = sync.prepare('myssal-github').then(value => ({ value }), error => ({ error }));
    expect(sync.getProgress()).toMatchObject({ busy: true, completed: 1, total: 2 });
    await expect(sync.prepare('myssal-github')).rejects.toThrow(/已有同步任务/);
    sync.cancel();
    expect(signal?.aborted).toBe(true);
    task.resolve(snapshot('b'));
    expect(await outcome).toMatchObject({ error: expect.objectContaining({ message: expect.stringContaining('取消') }) });
    expect(sync.getProgress().busy).toBe(false);
    expect(store.getState()).toEqual(before);
    expect(() => sync.apply('missing')).toThrow(/失效/);
  });

  it('准备新候选会作废旧预览，取消已经完成的预览也使其失效', async () => {
    const store = createStore();
    const sync = new SyncService(store, async () => snapshot('b'));
    const first = await sync.prepare('myssal-github');
    const second = await sync.prepare('myssal-github');
    expect(first.token).not.toBe(second.token);
    expect(() => sync.apply(first.token)).toThrow(/失效/);
    sync.cancel();
    expect(() => sync.apply(second.token)).toThrow(/失效/);
    expect(store.getCurrentSnapshot()?.revision).toBe('a'.repeat(40));
  });

  it('网络失败或校验失败保留当前版本，失败的新准备不能复用旧候选', async () => {
    const store = createStore();
    let fail = false;
    const sync = new SyncService(store, async () => {
      if (fail) throw new Error('下载中断');
      return snapshot('b');
    });
    const first = await sync.prepare('myssal-github');
    const before = store.getState();
    fail = true;
    await expect(sync.prepare('myssal-github')).rejects.toThrow('下载中断');
    expect(() => sync.apply(first.token)).toThrow(/失效/);
    expect(store.getState()).toEqual(before);
    const corrupt = new SyncService(store, async () => snapshot('c', [item(), item()]));
    await expect(corrupt.prepare('myssal-github')).rejects.toThrow(/重复/);
    expect(store.getState()).toEqual(before);
  });

  it('候选生成后来源配置或当前选择改变，必须重新检查', async () => {
    const store = createStore();
    const sync = new SyncService(store, async () => snapshot('b'));
    const first = await sync.prepare('myssal-github');
    const settings = store.getSettings();
    store.saveSettings({ ...settings, sources: settings.sources.map(source => source.id === 'myssal-github' ? { ...source, name: '改名后的来源' } : source) });
    expect(() => sync.apply(first.token)).toThrow(/数据源已变更/);
    const second = await sync.prepare('myssal-github');
    store.saveSettings({ ...store.getSettings(), activeSourceId: 'remote-second', sources: [...store.getSettings().sources, { id: 'remote-second', name: '另一远程配置', provider: 'myssal', transport: 'github' }] });
    expect(() => sync.apply(second.token)).toThrow(/数据源已变更/);
    expect(store.getCurrentSnapshot()?.revision).toBe('a'.repeat(40));
  });

  it('下载期间发生版本回退，晚到候选不能覆盖用户刚选择的基础版本', async () => {
    const store = createStore();
    const originalId = store.getState().currentVersion!.id;
    store.applySnapshot(snapshot('b'), '已有新版');
    const task = deferred<CatalogSnapshot>();
    const sync = new SyncService(store, async () => task.promise);
    const pending = sync.prepare('myssal-github');
    store.rollback(originalId);
    task.resolve(snapshot('c'));
    const preview = await pending;
    expect(() => sync.apply(preview.token)).toThrow(/当前资料版本已变更/);
    expect(store.getCurrentSnapshot()?.revision).toBe('a'.repeat(40));
  });

  it('过期候选和大幅缺项被拒绝，旧包继续可用', async () => {
    const entries = Array.from({ length: 10 }, (_, i) => item(`character:${i + 1}`));
    const store = createStore(snapshot('a', entries));
    const sync = new SyncService(store, async () => snapshot('b', entries));
    const candidate = await sync.prepare('myssal-github');
    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now + 31 * 60_000);
    expect(() => sync.apply(candidate.token)).toThrow(/失效/);
    const incomplete = new SyncService(store, async () => snapshot('c', entries.slice(0, 4)));
    await expect(incomplete.prepare('myssal-github')).rejects.toThrow(/减少超过/);
    expect(store.listEntries()).toHaveLength(10);
    expect(store.getCurrentSnapshot()?.revision).toBe('a'.repeat(40));
  });

  it('总数持平也拒绝单个分类骤减，保留完整旧版本和本地修改', async () => {
    const characters = Array.from({ length: 30 }, (_, i) => item(`character:${i + 1}`));
    const weapons: CatalogEntry[] = Array.from({ length: 70 }, (_, i) => ({ ...item(`weapon:${i + 1}`, '武器'), category: 'weapon' }));
    const store = createStore(snapshot('a', [...characters, ...weapons]));
    store.saveEntry({ ...characters[0], name: '个人简称' });
    const extraWeapons: CatalogEntry[] = Array.from({ length: 7 }, (_, i) => ({ ...item(`weapon:${i + 71}`, '新增武器'), category: 'weapon' }));
    const next = snapshot('b', [...characters.slice(0, 23), ...weapons, ...extraWeapons]);
    const before = store.getState();
    const sync = new SyncService(store, async () => next);
    await expect(sync.prepare('myssal-github')).rejects.toThrow(/character 分类资料减少/);
    expect(sync.getProgress().busy).toBe(false);
    expect(store.getState()).toEqual(before);
  });
});
