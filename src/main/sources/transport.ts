import type { SourceProfile } from '../../shared/types';

const maximumFileBytes = 32 * 1024 * 1024;
const requestTimeout = 30_000;
const repository = 'myssal/PGR_Data';

/** 影响正式目录的提交。 @author chenjd @created 2026-11-06 13:40:00 */
export interface SourceCommit {
  /** 固定提交标识。 */ sha: string;
  /** 提交完整说明。 */ message: string;
}
/** 固定来源读句柄。 @author chenjd @created 2026-11-06 13:40:00 */
export interface PinnedSource {
  /** 实际读取的提交。 */ revision: string;
  /** 最近明确正式版本说明。 */ version: string;
  /** 读取该提交中的 JSON 字节。 */ read: (file: string) => Promise<Buffer>;
}

/** 将中止传播到异步操作，防止取消后继续发布候选。 */
export const checkAborted = (signal: AbortSignal): void => {
  if (signal.aborted) throw new Error('资料同步已取消');
};

/** 等待短暂重试间隔，支持立即取消。 */
const delay = async (milliseconds: number, signal: AbortSignal): Promise<void> => {
  checkAborted(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => { clearTimeout(timer); reject(new Error('资料同步已取消')); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve(); }, milliseconds);
    signal.addEventListener('abort', onAbort, { once: true });
  });
};

/** 只允许读取表清单内使用的相对 JSON 路径。 */
export const assertTablePath = (file: string): void => {
  if (!/^(client|share)\/[A-Za-z0-9/_-]+\.json$/.test(file) || file.includes('..')) throw new Error('来源表路径不合法');
};

/** 对每次响应设置超时和大小上限，有限重试瞬时网络故障。 */
export const fetchBytes = async (url: string, signal: AbortSignal, maximum = maximumFileBytes): Promise<Buffer> => {
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || !['api.github.com', 'raw.githubusercontent.com'].includes(parsed.hostname)) throw new Error('不支持的资料下载地址');
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt++) {
    checkAborted(signal);
    let retryable = true;
    try {
      const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(requestTimeout)]), redirect: 'error', headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'pgr-helper' } });
      if (!response.ok) {
        retryable = response.status === 429 || response.status >= 500;
        await response.body?.cancel();
        throw new Error(`GitHub 返回 ${response.status}，${response.status === 403 ? '可能已达到接口访问限额，请稍后重试。' : '资料获取失败。'}`);
      }
      const size = Number(response.headers.get('content-length') ?? 0);
      if (size > maximum) { retryable = false; await response.body?.cancel(); throw new Error('来源文件超过大小限制'); }
      if (!response.body) throw new Error('来源返回空响应');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          total += next.value.byteLength;
          if (total > maximum) { retryable = false; await reader.cancel(); throw new Error('来源文件超过大小限制'); }
          chunks.push(next.value);
        }
      } finally { reader.releaseLock(); }
      checkAborted(signal);
      return Buffer.concat(chunks);
    } catch (error) {
      checkAborted(signal);
      lastError = error;
      if (!retryable || attempt === 2) throw error;
      await delay(400 * (attempt + 1), signal);
    }
  }
  throw lastError;
};

/** 继承最近明确 LIVE 的状态；遇测试边界时丢弃其后的未标明修复。 */
export const selectLiveRevision = (commits: SourceCommit[]): { selected: SourceCommit; official: SourceCommit } => {
  let candidate: SourceCommit | undefined;
  for (const commit of commits) {
    if (!/^[a-f0-9]{40}$/.test(commit.sha)) throw new Error('来源提交编号无效');
    const subject = commit.message.split('\n')[0];
    if (/\bbeta\b/i.test(subject)) { candidate = undefined; continue; }
    if (/\bCN\s+LIVE\b/i.test(subject)) return { selected: candidate ?? commit, official: commit };
    if (/\b(?:EN|GLB|GLOBAL)\s+LIVE\b/i.test(subject)) { candidate = undefined; continue; }
    candidate ??= commit;
  }
  throw new Error('无法确认中文正式数据版本；保留当前资料，需核对上游版本状态。');
};

/** 固定远端提交后，再读取清单中的全部文件。 */
export const pinSource = async (profile: SourceProfile, signal: AbortSignal): Promise<PinnedSource> => {
  checkAborted(signal);
  if (profile.provider !== 'myssal') throw new Error('不支持的数据源适配器');
  if (profile.transport !== 'github' || 'directory' in profile) throw new Error('仅支持远程 GitHub 数据源');
  const bytes = await fetchBytes(`https://api.github.com/repos/${repository}/commits?path=cn&per_page=100`, signal, 8 * 1024 * 1024);
  const response: unknown = JSON.parse(bytes.toString('utf8'));
  if (!Array.isArray(response)) throw new Error('GitHub 提交响应格式错误');
  const commits = response.map((value: unknown): SourceCommit => {
    if (!value || typeof value !== 'object') throw new Error('GitHub 提交结构错误');
    const row = value as { sha?: unknown; commit?: { message?: unknown } };
    if (typeof row.sha !== 'string' || typeof row.commit?.message !== 'string') throw new Error('GitHub 提交字段缺失');
    return { sha: row.sha, message: row.commit.message };
  });
  const pinned = selectLiveRevision(commits);
  return { revision: pinned.selected.sha, version: pinned.official.message.split('\n')[0], read: async file => { assertTablePath(file); return fetchBytes(`https://raw.githubusercontent.com/${repository}/${pinned.selected.sha}/cn/bytes/${file}`, signal); } };
};
