import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isTrustedAssetImageUrl } from '../shared/asset-image';
import { fetchBytes } from './sources/transport';

const maximumImageBytes = 8 * 1024 * 1024;
const maximumCacheBytes = Math.ceil(maximumImageBytes / 3) * 4 + 4096;
const negativeCacheMilliseconds = 30_000;
const imageTimeoutMilliseconds = 30_000;
const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** PNG 校验表只用于核对资源块，避免把错误页或损坏图片保存为有效缓存。 */
const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

/** 校验 PNG 块的 CRC、基本结构与文件边界，不执行资源内容。 */
const validPng = (bytes: Buffer): boolean => {
  if (bytes.length > maximumImageBytes || !bytes.subarray(0, 8).equals(pngSignature)) return false;
  let offset = 8;
  let hasHeader = false;
  let hasImageData = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > bytes.length) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (!hasHeader && type !== 'IHDR') return false;
    let checksum = 0xffffffff;
    for (let index = offset + 4; index < end - 4; index++) checksum = crcTable[(checksum ^ bytes[index]) & 255] ^ (checksum >>> 8);
    if (((checksum ^ 0xffffffff) >>> 0) !== bytes.readUInt32BE(end - 4)) return false;
    if (type === 'IHDR') {
      if (hasHeader || length !== 13 || !bytes.readUInt32BE(offset + 8) || !bytes.readUInt32BE(offset + 12)) return false;
      hasHeader = true;
    }
    if (type === 'IDAT' && length > 0) hasImageData = true;
    if (type === 'IEND') return length === 0 && hasHeader && hasImageData && end === bytes.length;
    offset = end;
  }
  return false;
};

/** 生成缓存文件名或内容摘要，不将远端路径拼接进本地目录。 */
const digest = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');

/** 待处理图片请求。 @author chenjd @created 2026-11-06 15:30:00 */
interface PendingImage {
  /** 已通过白名单检查的固定版本地址。 */ url: string;
  /** 完成当前请求，失败时保留界面占位。 */ settle: (value: string | null) => void;
}

/** 按需读取可信图片并保存可离线验证的缓存。 @author chenjd @created 2026-11-06 15:30:00 */
export class AssetImageCache {
  /** 退出时统一终止进行中的下载。 */
  private readonly controller = new AbortController();
  /** 同一个 URL 在排队和下载期间共享结果。 */
  private readonly inFlight = new Map<string, Promise<string | null>>();
  /** 暂时失败的图片稍后可以重试，不写入永久缺图记录。 */
  private readonly negativeCache = new Map<string, number>();
  /** 等待可用并发名额的请求。 */
  private readonly pending: PendingImage[] = [];
  /** 当前进行的读取或下载数量。 */
  private active = 0;
  /** 关闭后不再接受新请求。 */
  private closed = false;

  /** 缓存目录由主进程传入，位于程序数据目录内。 */
  constructor(private readonly directory: string) {}

  /** 返回经过校验的 PNG 数据地址；不支持的地址和暂时失败均返回空值。 */
  resolve = (url: string): Promise<string | null> => {
    if (this.closed || !isTrustedAssetImageUrl(url)) return Promise.resolve(null);
    const existing = this.inFlight.get(url);
    if (existing) return existing;
    let settle!: PendingImage['settle'];
    const result = new Promise<string | null>(resolve => { settle = resolve; });
    this.inFlight.set(url, result);
    this.pending.push({ url, settle });
    this.drain();
    return result;
  };

  /** 退出时立即完成排队请求，并中止正在下载的图片。 */
  close = (): void => {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    for (const request of this.pending.splice(0)) {
      this.inFlight.delete(request.url);
      request.settle(null);
    }
    this.negativeCache.clear();
  };

  /** 最多同时处理四张图片，完成后释放名额。 */
  private drain = (): void => {
    while (!this.closed && this.active < 4 && this.pending.length) {
      const request = this.pending.shift()!;
      this.active++;
      const finish = (value: string | null): void => {
        this.active--;
        this.inFlight.delete(request.url);
        request.settle(this.closed ? null : value);
        this.drain();
      };
      void this.readOrDownload(request.url).then(finish, () => finish(null));
    }
  };

  /** 优先使用完整的磁盘缓存，离线和网络失败都不会破坏已缓存图片。 */
  private readOrDownload = async (url: string): Promise<string | null> => {
    const filename = join(this.directory, `${digest(url)}.json`);
    const cached = await this.readCache(filename, url);
    if (this.closed) return null;
    if (cached) return `data:image/png;base64,${cached.toString('base64')}`;
    if ((this.negativeCache.get(url) ?? 0) > Date.now()) return null;
    this.negativeCache.delete(url);
    try {
      const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(imageTimeoutMilliseconds)]);
      const bytes = await fetchBytes(url, signal, maximumImageBytes);
      if (this.closed || !validPng(bytes)) throw new Error('图片响应无效');
      await this.writeCache(filename, url, bytes);
      return this.closed ? null : `data:image/png;base64,${bytes.toString('base64')}`;
    } catch {
      if (!this.closed) this.negativeCache.set(url, Date.now() + negativeCacheMilliseconds);
      return null;
    }
  };

  /** 缓存摘要、URL、编码和 PNG 结构均一致时才允许离线读取。 */
  private readCache = async (filename: string, url: string): Promise<Buffer | null> => {
    try {
      const metadata = await stat(filename);
      if (!metadata.isFile() || metadata.size > maximumCacheBytes) return null;
      const cached: unknown = JSON.parse(await readFile(filename, 'utf8'));
      if (!cached || typeof cached !== 'object') return null;
      const value = cached as Record<string, unknown>;
      if (value.version !== 1 || value.url !== url || typeof value.bytes !== 'string' || typeof value.checksum !== 'string') return null;
      const bytes = Buffer.from(value.bytes, 'base64');
      if (bytes.toString('base64') !== value.bytes || digest(bytes) !== value.checksum || !validPng(bytes)) return null;
      return bytes;
    } catch {
      return null;
    }
  };

  /** 临时文件写完后原子替换；缓存目录不可写时仍返回已下载的有效图片。 */
  private writeCache = async (filename: string, url: string, bytes: Buffer): Promise<void> => {
    const temporary = `${filename}.${randomUUID()}.tmp`;
    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(temporary, JSON.stringify({ version: 1, url, checksum: digest(bytes), bytes: bytes.toString('base64') }), { flag: 'wx' });
      await rename(temporary, filename);
    } catch {
      // 缓存只是下载优化，写入失败不影响当前图片展示。
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  };
}
