import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { categories, type CatalogSnapshot, type ImageSourceInfo, type SourceProfile, type SyncProgress } from '../../shared/types';
import { catalogMetadataSchema, entrySectionSchema, imageSourceSchema } from '../schemas';
import { attachAssetImages } from './assets';
import { coreTablePaths, normalizeCore } from './normalize-core';
import { normalizeStages, stageTablePaths } from './normalize-stages';
import { guideOptionTablePaths, normalizeGuideOptions } from './normalize-guide-options';
import { guideEntryOptionsSchema } from '../guide-options-schema';
import { checkAborted, pinSource } from './transport';
import type { SourceRow, SourceTables } from './common';

/** 所有必要原始表；去重后只读取一次。 */
export const myssalTablePaths: readonly string[] = [...new Set([...coreTablePaths, ...stageTablePaths, ...guideOptionTablePaths])];

/** 规范化规则变化时递增，使同一上游提交重新生成资料。 */
const normalizerVersion = 5;

/** 来源读取选项，缓存目录由主进程限定在应用数据目录中。 @author chenjd @created 2026-11-06 13:40:00 */
export interface SourceLoadOptions {
  /** 可选的固定版本缓存目录。 */ cacheDirectory?: string;
  /** 当前已启用图片版本，恢复备份后无缓存时仍可沿用。 */ imageSourceFallback?: ImageSourceInfo;
}

/** 从带校验和的缓存读取完整快照；任何损坏都重新获取。 */
const readCache = async (directory: string | undefined, revision: string): Promise<CatalogSnapshot | null> => {
  if (!directory) return null;
  try {
    const file = path.join(directory, revision, 'catalog-v1.json');
    if ((await stat(file)).size > 32 * 1024 * 1024) return null;
    const container = JSON.parse(await readFile(file, 'utf8')) as { format?: unknown; normalizerVersion?: unknown; payload?: unknown; checksum?: unknown };
    if (container.format !== 1 || container.normalizerVersion !== normalizerVersion || typeof container.payload !== 'string' || typeof container.checksum !== 'string') return null;
    if (createHash('sha256').update(container.payload).digest('hex') !== container.checksum) return null;
    const snapshot = JSON.parse(container.payload) as CatalogSnapshot;
    validateSnapshot(snapshot);
    return snapshot.revision === revision ? snapshot : null;
  } catch { return null; }
};

/** 临时文件完整写入后再替换缓存，失败时不影响候选数据。 */
const writeCache = async (directory: string | undefined, snapshot: CatalogSnapshot): Promise<void> => {
  if (!directory) return;
  const folder = path.join(directory, snapshot.revision);
  const temporary = path.join(folder, `catalog-${process.pid}-${Date.now()}.tmp`);
  try {
    await mkdir(folder, { recursive: true });
    const payload = JSON.stringify(snapshot);
    await writeFile(temporary, JSON.stringify({ format: 1, normalizerVersion, checksum: createHash('sha256').update(payload).digest('hex'), payload }), { encoding: 'utf8', flag: 'wx' });
    await rename(temporary, path.join(folder, 'catalog-v1.json'));
  } catch { await unlink(temporary).catch(() => {}); }
};

/** 验证来源或备份中的完整快照，不将空数据和断链当作成功。 */
export const validateSnapshot = (snapshot: CatalogSnapshot): void => {
  if (!snapshot || snapshot.schemaVersion !== 1 || snapshot.provider !== 'myssal' || snapshot.region !== 'cn') throw new Error('不支持的资料包格式');
  if (snapshot.imageSource !== undefined && !imageSourceSchema.safeParse(snapshot.imageSource).success) throw new Error('图片来源版本信息无效');
  if (!/^[a-f0-9]{40}$/.test(snapshot.revision) || typeof snapshot.version !== 'string' || !snapshot.version.trim() || !Number.isFinite(Date.parse(snapshot.builtAt))) throw new Error('资料版本信息无效');
  if (!snapshot.fingerprints || typeof snapshot.fingerprints !== 'object' || myssalTablePaths.some(file => !/^[a-f0-9]{64}$/.test(snapshot.fingerprints[`cn/bytes/${file}`] ?? ''))) throw new Error('资料包缺少必要的原始文件指纹');
  if (!Array.isArray(snapshot.entries) || snapshot.entries.length > 50_000 || !Array.isArray(snapshot.warnings) || snapshot.warnings.some(value => typeof value !== 'string')) throw new Error('资料包条目格式无效');
  const seen = new Set<string>();
  const counts = Object.fromEntries(categories.map(category => [category, 0]));
  for (const item of snapshot.entries) {
    if (!item || !categories.includes(item.category) || typeof item.sourceKey !== 'string' || item.id !== `${item.category}:${item.sourceKey}` || seen.has(item.id) || item.id.length > 150) throw new Error('资料存在重复或无效标识');
    seen.add(item.id);
    counts[item.category]++;
    for (const key of ['name', 'subtitle', 'description', 'element', 'profession', 'rarity', 'image'] as const) if (typeof item[key] !== 'string' || item[key].length > 200_000) throw new Error(`条目 ${item.id} 的 ${key} 字段格式无效`);
    if (!item.name.trim()) throw new Error(`条目 ${item.id} 缺少名称`);
    if (!catalogMetadataSchema.safeParse(item.catalog).success) throw new Error(`条目 ${item.id} 的排序或筛选信息无效`);
    if (item.guideOptions && !guideEntryOptionsSchema.safeParse(item.guideOptions).success) throw new Error(`条目 ${item.id} 的攻略配置选项无效`);
    if (![item.aliases, item.tags, item.relatedIds].every(values => Array.isArray(values) && values.every(value => typeof value === 'string'))) throw new Error(`条目 ${item.id} 的列表字段无效`);
    if (!item.attributes || Array.isArray(item.attributes) || typeof item.attributes !== 'object' || Object.values(item.attributes).some(value => typeof value !== 'string')) throw new Error(`条目 ${item.id} 的属性无效`);
    if (!Array.isArray(item.sections) || item.sections.some(section => !entrySectionSchema.safeParse(section).success)) throw new Error(`条目 ${item.id} 的正文或技能分类无效`);
    if (item.image && !/^https:\/\//i.test(item.image)) throw new Error(`来源条目 ${item.id} 包含不支持的图片地址`);
  }
  const minimums = { character: 50, memory: 60, weapon: 100, resonance: 100, pet: 20, stage: 100, weather: 50, dictionary: 25 };
  for (const category of categories) if (counts[category] < minimums[category]) throw new Error(`${category} 资料数量异常，拒绝启用残缺数据包`);
  for (const item of snapshot.entries) for (const id of item.relatedIds) if (!seen.has(id)) throw new Error(`条目 ${item.id} 的关联缺失：${id}`);
};

/** 完整读取固定版本的中文基础模块，校验后返回候选快照。 */
export const loadMyssalSnapshot = async (profile: SourceProfile, signal: AbortSignal, onProgress: (progress: SyncProgress) => void = () => {}, options: SourceLoadOptions = {}): Promise<CatalogSnapshot> => {
  const controller = new AbortController();
  const combinedSignal = AbortSignal.any([signal, controller.signal]);
  const total = myssalTablePaths.length;
  let completed = 0;
  onProgress({ busy: true, message: '确认中文正式资料版本', completed, total });
  try {
    const source = await pinSource(profile, combinedSignal);
    const cached = await readCache(options.cacheDirectory, source.revision);
    checkAborted(combinedSignal);
    if (cached) { onProgress({ busy: false, message: '固定版本缓存已通过校验', completed: total, total }); return cached; }
    const tables: SourceTables = {};
    const fingerprints: Record<string, string> = {};
    let next = 0;
    let totalBytes = 0;
    const worker = async (): Promise<void> => {
      while (next < total) {
        checkAborted(combinedSignal);
        const file = myssalTablePaths[next++];
        const bytes = await source.read(file);
        checkAborted(combinedSignal);
        totalBytes += bytes.byteLength;
        if (totalBytes > 160 * 1024 * 1024) throw new Error('来源资料总大小超过限制');
        let value: unknown;
        try { value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { throw new Error(`来源文件不是有效 JSON：${file}`); }
        if (!Array.isArray(value) || value.length === 0 || value.length > 200_000 || value.some(row => !row || typeof row !== 'object' || Array.isArray(row))) throw new Error(`来源表结构无效：${file}`);
        tables[file] = value as SourceRow[];
        fingerprints[`cn/bytes/${file}`] = createHash('sha256').update(bytes).digest('hex');
        completed++;
        onProgress({ busy: true, message: `读取资料 ${completed}/${total}`, completed, total });
      }
    };
    const workers = Array.from({ length: Math.min(6, total) }, () => worker());
    try { await Promise.all(workers); } catch (error) { controller.abort(); await Promise.allSettled(workers); throw error; }
    checkAborted(signal);
    onProgress({ busy: true, message: '整理资料并检查关联', completed, total });
    const core = normalizeCore(tables);
    const stages = normalizeStages(tables);
    const guideOptions = normalizeGuideOptions(tables);
    for (const item of core.entries) {
      const configuration = guideOptions.get(item.id);
      if (configuration) item.guideOptions = configuration;
    }
    const snapshot: CatalogSnapshot = { schemaVersion: 1, provider: 'myssal', region: 'cn', revision: source.revision, version: source.version, builtAt: new Date().toISOString(), fingerprints, entries: [...core.entries, ...stages.entries].sort((a, b) => a.id.localeCompare(b.id, 'en')), warnings: [...new Set([...core.warnings, ...stages.warnings])] };
    validateSnapshot(snapshot);
    checkAborted(signal);
    await writeCache(options.cacheDirectory, snapshot);
    checkAborted(signal);
    onProgress({ busy: false, message: '资料候选已准备好', completed, total });
    return snapshot;
  } catch (error) {
    controller.abort();
    onProgress({ busy: false, message: signal.aborted ? '资料同步已取消' : '资料获取或校验失败', completed, total });
    throw error;
  }
};

/** 已实现的来源适配器，统一入口依据配置中的来源标识分派读取。 */
export const sourceRegistry = [{ id: 'myssal', name: 'Myssal PGR Data', region: 'cn', transports: ['github'], load: loadMyssalSnapshot }] as const;

/** 按已注册适配器读取候选快照，未知来源不回退至其他适配器。 */
export const loadCatalogSnapshot = async (profile: SourceProfile, signal: AbortSignal, onProgress: (progress: SyncProgress) => void = () => {}, options: SourceLoadOptions = {}): Promise<CatalogSnapshot> => {
  const adapter = sourceRegistry.find(item => item.id === profile.provider);
  if (!adapter) throw new Error(`不支持的数据源适配器：${String(profile.provider)}`);
  const snapshot = await adapter.load(profile, signal, onProgress, options);
  onProgress({ busy: true, message: '确认基础资料图片版本', completed: 0, total: 0 });
  const illustrated = await attachAssetImages(snapshot, signal, options.cacheDirectory, options.imageSourceFallback);
  checkAborted(signal);
  validateSnapshot(illustrated);
  onProgress({ busy: false, message: '资料与图片候选已准备好', completed: 1, total: 1 });
  return illustrated;
};
