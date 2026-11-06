import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetImageCache } from '../src/main/image-cache';
import { isTrustedAssetImageUrl } from '../src/shared/asset-image';

const base = `https://raw.githubusercontent.com/undertheobservers/PGR_Assets/${'a'.repeat(40)}/assets/product/texture/`;
const url = `${base}image/role/RoleHead.png`;
/** 项目自有 PNG 只验证下载与缓存协议，不冒充上游资源覆盖证据。 */
const png = readFileSync(new URL('../resources/icon.png', import.meta.url));
const dataUrl = `data:image/png;base64,${png.toString('base64')}`;
const caches: AssetImageCache[] = [];
const directories: string[] = [];

/** 为每项测试创建隔离目录，缓存实例统一在测试结束时关闭。 */
const createCache = async (): Promise<{ cache: AssetImageCache; directory: string }> => {
  const directory = await mkdtemp(join(tmpdir(), 'pgr-image-cache-test-'));
  directories.push(directory);
  const cache = new AssetImageCache(directory);
  caches.push(cache);
  return { cache, directory };
};

/** 每个响应使用独立流，避免已消费流影响并发验证。 */
const imageResponse = (): Response => new Response(Uint8Array.from(png), { headers: { 'Content-Type': 'image/png' } });

afterEach(async () => {
  for (const cache of caches.splice(0)) cache.close();
  vi.restoreAllMocks();
  for (const directory of directories.splice(0)) {
    const location = relative(tmpdir(), directory);
    if (!location.startsWith('pgr-image-cache-test-') || location.includes(sep)) throw new Error('测试临时目录超出清理范围');
    await rm(directory, { recursive: true, force: true });
  }
});

describe('固定版本图片地址', () => {
  it('仅接受指定仓库、固定提交和三个资源目录，拒绝地址归一化绕过', async () => {
    for (const directory of ['image', 'atlas', 'spriteatlas']) expect(isTrustedAssetImageUrl(`${base}${directory}/role/RoleHead.png`)).toBe(true);
    const invalid = [
      url.replace('https:', 'http:'), url.replace('raw.githubusercontent.com', 'evil.example'),
      url.replace('undertheobservers', 'other'), url.replace('a'.repeat(40), 'main'),
      url.replace('a'.repeat(40), 'A'.repeat(40)), url.replace('/image/', '/other/'),
      url.replace('RoleHead.png', '../RoleHead.png'), url.replace('RoleHead.png', './RoleHead.png'),
      url.replace('RoleHead.png', '%2e%2e/RoleHead.png'), url.replace('RoleHead.png', '%2FRoleHead.png'),
      url.replace('RoleHead.png', 'RoleHead.svg'), `${url}?x=1`, `${url}#x`,
      url.replace('https://', 'https://user:secret@'), url.replace('RoleHead.png', '//RoleHead.png'),
      url.replace('/role/', '\\role\\'), ` ${url}`, `${url}\n`, 'file:///tmp/a.png', 'data:image/png;base64,AAAA',
    ];
    const request = vi.spyOn(globalThis, 'fetch');
    const { cache } = await createCache();
    for (const value of invalid) {
      expect(isTrustedAssetImageUrl(value), value).toBe(false);
      expect(await cache.resolve(value), value).toBeNull();
    }
    expect(request).not.toHaveBeenCalled();
  });
});

describe('图片按需缓存', () => {
  it('同图并发只下载一次，并原子写入带摘要的缓存', async () => {
    const { cache, directory } = await createCache();
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => imageResponse());
    const first = cache.resolve(url);
    expect(cache.resolve(url)).toBe(first);
    const results = await Promise.all(Array.from({ length: 20 }, () => cache.resolve(url)));
    expect(results.every(value => value === dataUrl)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    const files = await readdir(directory);
    expect(files).toEqual([`${createHash('sha256').update(url).digest('hex')}.json`]);
    const stored = JSON.parse(await readFile(join(directory, files[0]), 'utf8'));
    expect(stored).toMatchObject({ version: 1, url, checksum: createHash('sha256').update(png).digest('hex'), bytes: png.toString('base64') });
    expect(request.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
  });

  it('重新打开后离线命中磁盘，无需访问网络', async () => {
    const { cache, directory } = await createCache();
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => imageResponse());
    expect(await cache.resolve(url)).toBe(dataUrl);
    cache.close();
    request.mockReset().mockRejectedValue(new Error('模拟离线'));
    const reopened = new AssetImageCache(directory);
    caches.push(reopened);
    expect(await reopened.resolve(url)).toBe(dataUrl);
    expect(request).not.toHaveBeenCalled();
  });

  it('摘要或 URL 不匹配的缓存重新下载，损坏内容不展示', async () => {
    const { cache, directory } = await createCache();
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => imageResponse());
    await cache.resolve(url);
    const filename = join(directory, (await readdir(directory))[0]);
    const valid = JSON.parse(await readFile(filename, 'utf8'));
    for (const invalid of [{ ...valid, checksum: '0'.repeat(64) }, { ...valid, url: `${base}image/another.png` }, { ...valid, bytes: 'not-base64' }]) {
      await writeFile(filename, JSON.stringify(invalid));
      expect(await cache.resolve(url)).toBe(dataUrl);
    }
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('404 只短期记住失败，超时后可成功重试且失败不写磁盘', async () => {
    const { cache, directory } = await createCache();
    let now = Date.now();
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const request = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 })).mockImplementation(async () => imageResponse());
    expect(await cache.resolve(url)).toBeNull();
    expect(await cache.resolve(url)).toBeNull();
    expect(request).toHaveBeenCalledTimes(1);
    expect(await readdir(directory)).toEqual([]);
    now += 30_001;
    expect(await cache.resolve(url)).toBe(dataUrl);
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('不缓存 HTML 错误页、截断图片或 CRC 损坏的图片', async () => {
    const { cache, directory } = await createCache();
    const damaged = Buffer.from(png);
    damaged[damaged.length - 1] ^= 1;
    const invalid = [Buffer.from('<html>not an image</html>'), png.subarray(0, png.length - 4), damaged];
    const request = vi.spyOn(globalThis, 'fetch');
    for (const [index, bytes] of invalid.entries()) {
      request.mockResolvedValueOnce(new Response(Uint8Array.from(bytes)));
      expect(await cache.resolve(`${base}image/bad${index}.png`)).toBeNull();
    }
    expect(request).toHaveBeenCalledTimes(3);
    expect(await readdir(directory)).toEqual([]);
  });

  it('拒绝声明超限及实际流超出 8 MiB 的图片', async () => {
    const { cache, directory } = await createCache();
    const request = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { headers: { 'content-length': String(8 * 1024 * 1024 + 1) } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(8 * 1024 * 1024 + 1)));
    expect(await cache.resolve(url)).toBeNull();
    expect(await cache.resolve(`${base}image/large.png`)).toBeNull();
    expect(request).toHaveBeenCalledTimes(2);
    expect(await readdir(directory)).toEqual([]);
  });

  it('不同图片最多四路并发，其余等待前一批完成', async () => {
    const { cache } = await createCache();
    const releases: Array<() => void> = [];
    let active = 0;
    let highest = 0;
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => new Promise<Response>((resolve, reject) => {
      active++;
      highest = Math.max(highest, active);
      const signal = init?.signal;
      const abort = (): void => { active--; reject(new Error('请求取消')); };
      signal?.addEventListener('abort', abort, { once: true });
      releases.push(() => {
        signal?.removeEventListener('abort', abort);
        active--;
        resolve(imageResponse());
      });
    }));
    const requests = Array.from({ length: 9 }, (_, index) => cache.resolve(`${base}image/parallel${index}.png`));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    for (const release of releases.splice(0)) release();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(8));
    for (const release of releases.splice(0)) release();
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(9));
    for (const release of releases.splice(0)) release();
    expect((await Promise.all(requests)).every(value => value === dataUrl)).toBe(true);
    expect(highest).toBe(4);
  });

  it('关闭时中止正在下载及排队图片，之后不发起新请求', async () => {
    const { cache } = await createCache();
    const signals: AbortSignal[] = [];
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      const signal = init!.signal!;
      signals.push(signal);
      signal.addEventListener('abort', () => reject(new Error('请求取消')), { once: true });
    }));
    const requests = Array.from({ length: 7 }, (_, index) => cache.resolve(`${base}image/cancel${index}.png`));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(4));
    cache.close();
    expect((await Promise.all(requests)).every(value => value === null)).toBe(true);
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(await cache.resolve(url)).toBeNull();
    expect(request).toHaveBeenCalledTimes(4);
  });

  it('总请求期限传入下载信号，超时后停止重试', async () => {
    const { cache } = await createCache();
    const deadline = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(deadline.signal);
    const request = vi.spyOn(globalThis, 'fetch').mockImplementation(async (_input, init) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(new Error('期限已到')), { once: true });
    }));
    const result = cache.resolve(url);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    deadline.abort();
    expect(await result).toBeNull();
    expect(timeout.mock.calls.every(([milliseconds]) => milliseconds === 30_000)).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('缓存目录不可写时仍展示有效下载结果', async () => {
    const { directory } = await createCache();
    const file = join(directory, 'not-a-directory');
    await writeFile(file, 'occupied');
    const cache = new AssetImageCache(file);
    caches.push(cache);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => imageResponse());
    expect(await cache.resolve(url)).toBe(dataUrl);
  });
});
