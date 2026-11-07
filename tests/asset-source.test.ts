import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CatalogSnapshot } from '../src/shared/types';
import { assetPath, attachAssetImages } from '../src/main/sources/assets';
import { CatalogStore } from '../src/main/store';
import { SyncService } from '../src/main/sync';

const revision = '2bd315e33ea8a790d93f790b7f06e69544ebf266';
/** 精简输入只验证图片来源边界，不作为真实资料覆盖证据。 */
const snapshot = (): CatalogSnapshot => ({
  schemaVersion: 1, provider: 'myssal', region: 'cn', revision: 'a'.repeat(40), version: 'CN LIVE', builtAt: new Date().toISOString(), fingerprints: {}, warnings: [],
  entries: [{ id: 'character:1', category: 'character', sourceKey: '1', name: '机体', subtitle: '', description: '', aliases: [], tags: [], element: '', profession: '', rarity: '', image: '', attributes: { '头像资源': 'Assets/Product/Texture/Image/Role/RoleHeadLi.png' }, sections: [], relatedIds: [] }],
});
/** 使用已核验提交字段，允许另一提交模拟图片单独更新。 */
const response = (sha = revision) => new Response(JSON.stringify([{ sha, commit: { message: 'Adelyde & Kurumi', committer: { date: '2026-09-24T03:52:34Z' } } }]));
afterEach(() => vi.restoreAllMocks());

describe('独立图片来源', () => {
  it('技能图标沿用同一固定图片提交，非法资源路径不生成地址', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(response());
    const base = snapshot();
    const skill = { kind: 'pet-active' as const, id: 'skill-1', groupId: 'active', groupName: '主动', groupOrder: 1, familyId: 'main:1', familyName: '主动技能', typeName: '主动' };
    base.entries[0].sections = [
      { title: '技能', body: '技能效果', skill: { ...skill, iconResource: 'Assets/Product/Texture/Image/IconPetSkill/Active.png' } },
      { title: '缺图', body: '', skill: { ...skill, id: 'skill-2', iconResource: '../../bad.png' } },
    ];
    const result = await attachAssetImages(base, new AbortController().signal);
    expect(result.entries[0].sections[0].skill?.image).toBe(`https://raw.githubusercontent.com/undertheobservers/PGR_Assets/${revision}/assets/product/texture/image/iconpetskill/Active.png`);
    expect(result.entries[0].sections[1].skill?.image).toBe('');
    expect(base.entries[0].sections[0].skill?.image).toBeUndefined();
  });
  it('转换完整路径并保留文件名大小写，拒绝不明路径', () => {
    expect(assetPath('Assets/Product/Texture/Image/Role/RoleHeadLi.png')).toBe('assets/product/texture/image/role/RoleHeadLi.png');
    expect(assetPath('Assets/Product/Texture/Atlas/Icon/Affix01.png')).toBe('assets/product/texture/atlas/icon/Affix01.png');
    for (const value of ['../../secret.png', 'https://example.com/a.png', 'Assets/Product/Texture/Image/../private.png', 'Assets/Product/Texture/Image/X.svg', 'Assets/Product/Texture/Image/a.png?x=1']) expect(assetPath(value)).toBeNull();
  });

  it('资料版本不变时仍独立更新图片提交，准备阶段不修改输入', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response()).mockResolvedValueOnce(response('b'.repeat(40)));
    const base = snapshot();
    const first = await attachAssetImages(base, new AbortController().signal);
    const second = await attachAssetImages(base, new AbortController().signal);
    expect(first.imageSource?.revision).toBe(revision);
    expect(second.imageSource?.revision).toBe('b'.repeat(40));
    expect(second.revision).toBe(first.revision);
    expect(second.entries[0].image).toContain('/' + 'b'.repeat(40) + '/');
    expect(base.entries[0].image).toBe('');
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls.every(([url]) => String(url).includes('/commits?sha=main&per_page=1'))).toBe(true);
  });

  it('图片检查失败复用固定版本；损坏缓存不会被启用，文字仍可同步', async () => {
    const cache = await mkdtemp(join(tmpdir(), 'pgr-assets-source-'));
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response());
    const base = snapshot();
    const first = await attachAssetImages(base, new AbortController().signal, cache);
    request.mockImplementation(async () => new Response('', { status: 403 }));
    const reused = await attachAssetImages(base, new AbortController().signal, cache);
    expect(reused.entries).toEqual(first.entries);
    expect(reused.warnings.join()).toContain('沿用');
    const file = join(cache, 'image-source.json');
    const corrupted = JSON.parse(await readFile(file, 'utf8'));
    corrupted.payload = '{}';
    await writeFile(file, JSON.stringify(corrupted));
    const textOnly = await attachAssetImages(base, new AbortController().signal, cache);
    expect(textOnly.entries).toEqual(base.entries);
    expect(textOnly.imageSource).toBeUndefined();
    expect(textOnly.warnings.join()).toContain('仅同步文字');
  });

  it('取消不会当作可继续启用的图片失败', async () => {
    const controller = new AbortController();
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => { controller.abort(); throw new Error('abort'); });
    await expect(attachAssetImages(snapshot(), controller.signal)).rejects.toThrow(/取消/);
  });

  it('恢复备份后没有图片缓存，检查失败仍保留已启用图片版本', async () => {
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response());
    const first = await attachAssetImages(snapshot(), new AbortController().signal);
    request.mockImplementation(async () => new Response('', { status: 403 }));
    const originalDirectory = await mkdtemp(join(tmpdir(), 'pgr-assets-backup-'));
    const restoredDirectory = await mkdtemp(join(tmpdir(), 'pgr-assets-restored-'));
    const original = new CatalogStore(originalDirectory);
    const restored = new CatalogStore(restoredDirectory);
    try {
      original.applySnapshot(first, '图片验证');
      const backup = join(originalDirectory, 'backup.json');
      original.exportBackup(backup);
      restored.importBackup(backup);
      const sync = new SyncService(restored, async (_profile, signal, _progress, options) => attachAssetImages(snapshot(), signal, options?.cacheDirectory, options?.imageSourceFallback));
      const preview = await sync.prepare('myssal-github');
      expect(preview.warnings.join()).toContain('沿用');
      expect(preview.changed).toBe(0);
      sync.apply(preview.token);
      expect(restored.getCurrentSnapshot()?.entries).toEqual(first.entries);
      expect(restored.getCurrentSnapshot()?.imageSource).toEqual(first.imageSource);
    } finally { original.close(); restored.close(); }
  });

  it('图片版本保存在预览、版本记录和备份中，源更新不覆盖用户图片', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(response()).mockResolvedValueOnce(response('b'.repeat(40)));
    const first = await attachAssetImages(snapshot(), new AbortController().signal);
    const second = await attachAssetImages(snapshot(), new AbortController().signal);
    const data = await mkdtemp(join(tmpdir(), 'pgr-assets-store-'));
    const store = new CatalogStore(data);
    try {
      expect(store.preview(first, '图片验证', 'token').imageSource).toEqual(first.imageSource);
      store.applySnapshot(first, '图片验证');
      const localImage = 'data:image/png;base64,aGVsbG8=';
      store.saveEntry({ ...first.entries[0], image: localImage });
      store.applySnapshot(second, '图片验证');
      expect(store.listEntries()[0].image).toBe(localImage);
      expect(store.getState().currentVersion?.imageSource?.revision).toBe(second.imageSource?.revision);
      const backup = join(data, 'backup.json');
      store.exportBackup(backup);
      store.importBackup(backup);
      expect(store.listEntries()[0].image).toBe(localImage);
      expect(store.getState().currentVersion?.imageSource).toEqual(second.imageSource);
    } finally { store.close(); }
  });
});
