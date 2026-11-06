import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { CatalogSnapshot, SourceProfile, SyncPreview, SyncProgress } from '../shared/types';
import type { CatalogStore } from './store';
import { loadCatalogSnapshot, type SourceLoadOptions } from './sources';

/** 可注入的资料加载器。 */
type Loader = (profile: SourceProfile, signal: AbortSignal, onProgress: (progress: SyncProgress) => void, options?: SourceLoadOptions) => Promise<CatalogSnapshot>;
/** 当前预览候选。 @author chenjd @created 2026-11-06 13:30:00 */
interface Candidate {
  /** 候选标识。 */ token: string;
  /** 已校验快照。 */ snapshot: CatalogSnapshot;
  /** 获取时的来源配置。 */ profile: SourceProfile;
  /** 生成预览时的有效版本。 */ baseVersionId: number | null;
  /** 到期时间。 */ expiresAt: number;
}
/** 同步协调器；候选在确认前不会写入有效资料。 @author chenjd @created 2026-11-06 13:30:00 */
export class SyncService {
  /** 当前获取进程。 */ private controller: AbortController | null = null;
  /** 等待确认的资料。 */ private candidate: Candidate | null = null;
  /** 可轮询的进度。 */ private progress: SyncProgress = { busy: false, message: '', completed: 0, total: 0 };
  /** 仓库依赖与可替换加载器。 */
  constructor(private readonly store: CatalogStore, private readonly loader: Loader = loadCatalogSnapshot) {}

  /** 获取进度副本。 */
  getProgress = (): SyncProgress => ({ ...this.progress });

  /** 取消获取并作废尚未应用的候选。 */
  cancel = (): void => {
    this.controller?.abort();
    this.candidate = null;
  };

  /** 读取来源、获取固定提交并生成差异。 */
  prepare = async (sourceId: string): Promise<SyncPreview> => {
    if (this.controller) throw new Error('已有同步任务正在进行');
    const profile = this.store.getSettings().sources.find((source) => source.id === sourceId);
    if (!profile) throw new Error('数据源配置不存在');
    this.candidate = null;
    const controller = new AbortController();
    this.controller = controller;
    const baseVersionId = this.store.getState().currentVersion?.id ?? null;
    this.progress = { busy: true, message: '正在检查资料版本…', completed: 0, total: 0 };
    try {
      const snapshot = await this.loader(structuredClone(profile), controller.signal, (progress) => { this.progress = { ...progress, busy: true }; }, { cacheDirectory: join(this.store.directory, 'source-cache'), imageSourceFallback: this.store.getCurrentSnapshot()?.imageSource });
      controller.signal.throwIfAborted();
      const token = randomUUID();
      const preview = this.store.preview(snapshot, profile.name, token);
      this.candidate = { token, snapshot, profile: structuredClone(profile), baseVersionId, expiresAt: Date.now() + 30 * 60_000 };
      this.progress = { ...this.progress, busy: false, message: '校验完成，可以查看资料差异' };
      return preview;
    } catch (error) {
      const message = controller.signal.aborted ? '已取消同步，现有资料保持不变' : error instanceof Error ? error.message : '同步失败';
      this.progress = { ...this.progress, busy: false, message };
      throw new Error(message);
    } finally {
      this.controller = null;
    }
  };

  /** 确认候选没有过期或被其他操作取代后应用。 */
  apply = (token: string): void => {
    const candidate = this.candidate;
    if (!candidate || candidate.token !== token || candidate.expiresAt < Date.now()) throw new Error('资料预览已失效，请重新检查');
    const profile = this.store.getSettings().sources.find((source) => source.id === candidate.profile.id);
    if (JSON.stringify(profile) !== JSON.stringify(candidate.profile) || this.store.getSettings().activeSourceId !== candidate.profile.id) throw new Error('数据源已变更，请重新检查');
    if ((this.store.getState().currentVersion?.id ?? null) !== candidate.baseVersionId) throw new Error('当前资料版本已变更，请重新检查');
    this.store.preview(candidate.snapshot, candidate.profile.name, candidate.token);
    this.store.applySnapshot(candidate.snapshot, candidate.profile.name);
    this.candidate = null;
    this.progress = { ...this.progress, message: '资料更新完成' };
  };
}
