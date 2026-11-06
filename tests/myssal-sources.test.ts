import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot, SourceProfile } from '../src/shared/types';
import { loadCatalogSnapshot, loadMyssalSnapshot, myssalTablePaths, sourceRegistry, validateSnapshot } from '../src/main/sources';
import { assertTablePath, fetchBytes, selectLiveRevision } from '../src/main/sources/transport';
import { readMyssalHttpFixture, type MyssalHttpFixture } from './helpers/myssal-http-fixture';

const repository = process.env.PGR_DATA_REPOSITORY;
const hasAuditRepository = !!repository && existsSync(repository);
let fixture: MyssalHttpFixture | undefined;
/** 生产加载器始终走远程 HTTP 协议，原始审计表只在测试进程提供响应。 */
const withAuditHttp = async <T>(action: () => Promise<T>): Promise<T> => {
  fixture ??= await readMyssalHttpFixture(repository!);
  const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(fixture.fetch);
  try { return await action(); } finally { fetchSpy.mockRestore(); }
};
const remoteProfile: SourceProfile = { id: 'audit-http', name: '真实表远程协议验证', provider: 'myssal', transport: 'github' };
/** 用真实完整原始表构造规范化结果，不读取或分发随附数据包。 */
const auditedSnapshot = async (): Promise<CatalogSnapshot> => withAuditHttp(() => loadCatalogSnapshot(remoteProfile, new AbortController().signal));

describe('真实 Myssal 中文资料', () => {
  it('统一入口分派至已注册适配器，明确拒绝未知来源', async () => {
    const profile: SourceProfile = { id: 'dispatch', name: '分派验证', provider: 'myssal', transport: 'github' };
    const progress = vi.fn();
    expect(sourceRegistry.find(item => item.id === profile.provider)?.load).toBe(loadMyssalSnapshot);
    const controller = new AbortController();
    controller.abort();
    await expect(loadCatalogSnapshot(profile, controller.signal, progress)).rejects.toThrow(/取消/);
    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ message: '确认中文正式资料版本' }));
    progress.mockClear();
    const unknown = { ...profile, provider: 'unknown-source' } as unknown as SourceProfile;
    await expect(loadCatalogSnapshot(unknown, new AbortController().signal, progress)).rejects.toThrow('不支持的数据源适配器：unknown-source');
    expect(progress).not.toHaveBeenCalled();
    const local = { ...profile, transport: 'directory', directory: 'X:/old' } as unknown as SourceProfile;
    await expect(loadCatalogSnapshot(local, new AbortController().signal)).rejects.toThrow(/仅支持远程/);
    expect(sourceRegistry[0].transports).toEqual(['github']);
  });

  it.skipIf(!hasAuditRepository)('真实原始表经远程协议覆盖全部基础分类并保留实际配装与技能内容', async () => {
    const snapshot = await auditedSnapshot();
    expect(() => validateSnapshot(snapshot)).not.toThrow();
    expect(Object.keys(snapshot.fingerprints)).toHaveLength(myssalTablePaths.length);
    const count = (category: string): number => snapshot.entries.filter(item => item.category === category).length;
    expect(count('character')).toBe(86);
    expect(count('memory')).toBe(108);
    expect(count('weapon')).toBe(248);
    expect(count('pet')).toBe(44);
    const crimson = snapshot.entries.find(item => item.id === 'character:1021005')!;
    expect(crimson.name).toBe('露西亚·深红囚影');
    expect(crimson.element).toBe('雷');
    expect(crimson.sections.some(section => section.skill?.typeName === 'QTE技能' && section.title.includes('晖煌掠形'))).toBe(true);
    expect(crimson.relatedIds.some(id => id.startsWith('weapon:'))).toBe(true);
    const memory = snapshot.entries.find(item => item.category === 'memory' && item.name === '达芬奇')!;
    expect(memory.attributes['实际号位']).toBe('1、2、3、4、5、6');
    expect(memory.sections.find(section => section.title === '4件套')?.body).toContain('QTE');
    expect(snapshot.entries.some(item => item.category === 'resonance' && item.description.includes('攻击+15'))).toBe(true);
    const pet = snapshot.entries.find(item => item.category === 'pet' && item.name === '霜誓')!;
    expect(pet.sections.some(section => section.skill?.kind === 'pet-active')).toBe(true);
    expect(pet.sections.some(section => section.skill?.kind === 'pet-passive')).toBe(true);
  });

  it.skipIf(!hasAuditRepository)('拒绝缺指纹、断链、重复条目和整类缺失', async () => {
    const snapshot = await auditedSnapshot();
    const missingFingerprint = structuredClone(snapshot);
    delete missingFingerprint.fingerprints[Object.keys(missingFingerprint.fingerprints)[0]];
    expect(() => validateSnapshot(missingFingerprint)).toThrow(/指纹/);
    const dangling = structuredClone(snapshot);
    dangling.entries[0].relatedIds.push('weapon:999999999');
    expect(() => validateSnapshot(dangling)).toThrow(/关联缺失/);
    const duplicate = structuredClone(snapshot);
    duplicate.entries.push(duplicate.entries[0]);
    expect(() => validateSnapshot(duplicate)).toThrow(/重复/);
    expect(() => validateSnapshot({ ...snapshot, entries: snapshot.entries.filter(item => item.category !== 'pet') })).toThrow(/数量异常/);
    const missingOrder = structuredClone(snapshot);
    delete missingOrder.entries[0].catalog;
    expect(() => validateSnapshot(missingOrder)).toThrow(/排序或筛选/);
    const invalidOrder = structuredClone(snapshot);
    invalidOrder.entries[0].catalog!.order = [Infinity];
    expect(() => validateSnapshot(invalidOrder)).toThrow(/排序或筛选/);
  });

  it('不把 Beta 或跨区域提交误选为中文正式版本，修复可继承 LIVE 上下文', () => {
    const live = { sha: '170abcceee1fdbdee00a8770830ef80680a6ceca', message: 'feat: [4.9.4] CN LIVE' };
    const beta = { sha: '1a9d6333c1f69e469471de13096b32d79550b338', message: 'feat: [4.9.18] CN BETA' };
    const fix = { sha: '2babcafd7ce98b4a320fcd1c42408cd35391bfe3', message: 'fix: corrupt audio' };
    expect(selectLiveRevision([beta, live]).selected.sha).toBe(live.sha);
    expect(selectLiveRevision([fix, live]).selected.sha).toBe(fix.sha);
    expect(selectLiveRevision([fix, beta, live]).selected.sha).toBe(live.sha);
    expect(() => selectLiveRevision([beta])).toThrow(/无法确认/);
  });

  it('拒绝路径穿越、不受支持的下载域名，并及时响应取消', async () => {
    expect(() => assertTablePath('share/../../secret.json')).toThrow();
    expect(() => assertTablePath('https://example.com/x.json')).toThrow();
    await expect(fetchBytes('https://example.com/x.json', new AbortController().signal)).rejects.toThrow(/不支持/);
    const controller = new AbortController();
    controller.abort();
    await expect(loadMyssalSnapshot({ id: 'abort', name: '取消', provider: 'myssal', transport: 'github' }, controller.signal)).rejects.toThrow(/取消/);
  });

  it('拒绝声明过大及流式超限的响应，且不反复下载已确认的坏文件', async () => {
    // 这里只注入失败响应，成功数据始终由真实固定提交验证。
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      fetchSpy.mockResolvedValueOnce(new Response('excess', { headers: { 'content-length': '100' } }));
      await expect(fetchBytes('https://raw.githubusercontent.com/myssal/PGR_Data/failure.json', new AbortController().signal, 8)).rejects.toThrow(/大小限制/);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({ start: controller => {
        controller.enqueue(new Uint8Array(5));
        controller.enqueue(new Uint8Array(5));
        controller.close();
      } })));
      await expect(fetchBytes('https://raw.githubusercontent.com/myssal/PGR_Data/failure.json', new AbortController().signal, 8)).rejects.toThrow(/大小限制/);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    } finally { fetchSpy.mockRestore(); }
  });
});

describe.skipIf(!hasAuditRepository)('真实原始表的远程 HTTP 获取', () => {
  it('固定版本、缓存校验和损坏恢复均使用真实原始表的远程响应', async () => withAuditHttp(async () => {
    const cacheDirectory = await mkdtemp(path.join(tmpdir(), 'pgr-source-cache-'));
    const profile: SourceProfile = remoteProfile;
    try {
      fixture!.requests.length = 0;
      const first = await loadCatalogSnapshot(profile, new AbortController().signal, undefined, { cacheDirectory });
      expect(first.entries).toHaveLength(1799);
      expect(fixture!.requests.filter(url => url.startsWith('https://raw.githubusercontent.com/'))).toHaveLength(myssalTablePaths.length);
      const cacheFile = path.join(cacheDirectory, first.revision, 'catalog-v1.json');
      const validCache = JSON.parse(await readFile(cacheFile, 'utf8')) as { checksum: string };
      expect(validCache.checksum).toMatch(/^[a-f0-9]{64}$/);
      const messages: string[] = [];
      fixture!.requests.length = 0;
      const second = await loadCatalogSnapshot(profile, new AbortController().signal, progress => messages.push(progress.message), { cacheDirectory });
      expect(second.entries).toEqual(first.entries);
      expect(messages).toContain('固定版本缓存已通过校验');
      expect(fixture!.requests).toHaveLength(2);
      const staleRules = JSON.parse(await readFile(cacheFile, 'utf8'));
      staleRules.normalizerVersion = 1;
      await writeFile(cacheFile, JSON.stringify(staleRules));
      fixture!.requests.length = 0;
      const renewed = await loadCatalogSnapshot(profile, new AbortController().signal, undefined, { cacheDirectory });
      expect(renewed.entries).toEqual(first.entries);
      expect(fixture!.requests.filter(url => url.startsWith('https://raw.githubusercontent.com/'))).toHaveLength(myssalTablePaths.length);
      await writeFile(cacheFile, '{"format":1,"payload":"{}","checksum":"broken"}');
      const recovered = await loadCatalogSnapshot(profile, new AbortController().signal, undefined, { cacheDirectory });
      expect(recovered.entries).toEqual(first.entries);
      expect(JSON.parse(await readFile(cacheFile, 'utf8')).checksum).toMatch(/^[a-f0-9]{64}$/);
      const unwritableCache = path.join(cacheDirectory, 'file-not-directory');
      await writeFile(unwritableCache, 'cache failure boundary');
      const uncached = await loadCatalogSnapshot(profile, new AbortController().signal, undefined, { cacheDirectory: unwritableCache });
      expect(uncached.entries).toEqual(first.entries);
      const controller = new AbortController();
      await expect(loadMyssalSnapshot(profile, controller.signal, progress => {
        if (progress.busy && progress.completed > 0) controller.abort();
      })).rejects.toThrow(/取消/);
    } finally {
      const expectedPrefix = path.join(path.resolve(tmpdir()), 'pgr-source-cache-');
      if (!path.resolve(cacheDirectory).startsWith(expectedPrefix)) throw new Error('拒绝清理测试目录之外的路径');
      await rm(cacheDirectory, { recursive: true, force: true });
    }
  }), 30_000);
});
