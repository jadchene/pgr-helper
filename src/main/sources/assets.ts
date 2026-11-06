import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { CatalogEntry, CatalogSnapshot, ImageSourceInfo } from '../../shared/types';
import { imageSourceSchema } from '../schemas';
import { checkAborted, fetchBytes } from './transport';

/** 图片仓库只读取提交信息和所需 PNG，不拉取整个仓库。 */
export const assetRepository = 'undertheobservers/PGR_Assets';
/** 数据表给出的完整资源路径转换为仓库路径；保留 PNG 文件名大小写。 */
export const assetPath = (resource: string): string | null => {
  if (!/^Assets\/Product\/Texture\/(Image|Atlas|SpriteAtlas)\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.png$/i.test(resource)) return null;
  const parts = resource.split('/');
  const filename = parts.pop()!;
  return `${parts.join('/').toLowerCase()}/${filename}`;
};

/** 仅采用源表明确给出的图片字段，不按名称或相似文件名推测。 */
export const entryAssetPath = (entry: CatalogEntry): string | null => {
  for (const key of ['头像资源', '封面资源', '图标资源', '资源路径']) {
    const candidate = assetPath(entry.attributes[key] ?? '');
    if (candidate) return candidate;
  }
  return null;
};

/** 图片提交查询失败时可复用上次已校验的固定版本。 */
const readPinnedCache = async (directory?: string): Promise<ImageSourceInfo | null> => {
  if (!directory) return null;
  try {
    const file = join(directory, 'image-source.json');
    if ((await stat(file)).size > 16_384) return null;
    const cached = JSON.parse(await readFile(file, 'utf8'));
    if (typeof cached.payload !== 'string' || createHash('sha256').update(cached.payload).digest('hex') !== cached.checksum) return null;
    return imageSourceSchema.parse(JSON.parse(cached.payload));
  } catch { return null; }
};

/** 提交信息原子缓存；缓存失败不影响已获取的资料。 */
const writePinnedCache = async (directory: string | undefined, source: ImageSourceInfo): Promise<void> => {
  if (!directory) return;
  const temporary = join(directory, `image-source-${process.pid}-${Date.now()}.tmp`);
  try {
    await mkdir(directory, { recursive: true });
    const payload = JSON.stringify(source);
    await writeFile(temporary, JSON.stringify({ payload, checksum: createHash('sha256').update(payload).digest('hex') }), { flag: 'wx' });
    await rename(temporary, join(directory, 'image-source.json'));
  } catch { await unlink(temporary).catch(() => {}); }
};

/** 每次手动检查独立确认图片提交，即使文字资料命中缓存也会更新图片版本。 */
export const attachAssetImages = async (snapshot: CatalogSnapshot, signal: AbortSignal, cacheDirectory?: string, currentSource?: ImageSourceInfo): Promise<CatalogSnapshot> => {
  checkAborted(signal);
  let source: ImageSourceInfo | null;
  const warnings = [...snapshot.warnings];
  try {
    const bytes = await fetchBytes(`https://api.github.com/repos/${assetRepository}/commits?sha=main&per_page=1`, signal, 1024 * 1024);
    const rows = JSON.parse(bytes.toString('utf8'));
    const commit = Array.isArray(rows) ? rows[0] : undefined;
    source = imageSourceSchema.parse({ repository: assetRepository, revision: commit?.sha, version: typeof commit?.commit?.message === 'string' ? commit.commit.message.split('\n')[0].slice(0, 200) : undefined, updatedAt: commit?.commit?.committer?.date });
    await writePinnedCache(cacheDirectory, source);
  } catch {
    checkAborted(signal);
    const confirmed = imageSourceSchema.safeParse(currentSource);
    source = confirmed.success ? confirmed.data : await readPinnedCache(cacheDirectory);
    warnings.push(source ? '图片源暂时无法检查更新，本次沿用上次确认的图片版本。' : '图片源暂时不可用，本次仅同步文字资料；稍后检查更新可补充图片。');
  }
  checkAborted(signal);
  if (!source) return { ...snapshot, warnings };
  const imageSource = source;
  const entries = snapshot.entries.map(entry => {
    const file = entryAssetPath(entry);
    return { ...entry, image: file ? `https://raw.githubusercontent.com/${assetRepository}/${imageSource.revision}/${file}` : '' };
  });
  warnings.push('图片来源为 PGR_Assets，更新进度可能落后于文字资料。图片按浏览需要下载并缓存；缺图或下载失败时显示分类图标。');
  return { ...snapshot, entries, imageSource, warnings };
};
