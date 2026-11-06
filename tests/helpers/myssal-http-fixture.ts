import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { myssalTablePaths } from '../../src/main/sources';

/** 已审计真实中文正式版本，仅作为自动化测试输入。 */
const revision = '170abcceee1fdbdee00a8770830ef80680a6ceca';
const execute = promisify(execFile);

/** 真实原始表组成的远程协议样本。 @author chenjd @created 2026-11-06 15:10:00 */
export interface MyssalHttpFixture {
  /** 注入测试进程的 HTTP 获取函数。 */ fetch: typeof fetch;
  /** 本次样本收到的完整 URL。 */ requests: string[];
}

/** 从审计仓库固定对象读取真实表，转换为 HTTP 响应；不属于生产来源能力。 */
export const readMyssalHttpFixture = async (repository: string): Promise<MyssalHttpFixture> => {
  const tables = new Map<string, Buffer>();
  let next = 0;
  const read = async (): Promise<void> => {
    while (next < myssalTablePaths.length) {
      const file = myssalTablePaths[next++];
      const { stdout } = await execute('git', ['-C', repository, 'show', `${revision}:cn/bytes/${file}`], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30_000, windowsHide: true });
      tables.set(`https://raw.githubusercontent.com/myssal/PGR_Data/${revision}/cn/bytes/${file}`, stdout);
    }
  };
  await Promise.all(Array.from({ length: 6 }, read));
  const requests: string[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    init?.signal?.throwIfAborted();
    if (url === 'https://api.github.com/repos/undertheobservers/PGR_Assets/commits?sha=main&per_page=1') {
      return new Response(JSON.stringify([{ sha: '2bd315e33ea8a790d93f790b7f06e69544ebf266', commit: { message: 'Adelyde & Kurumi', committer: { date: '2026-09-24T03:52:34Z' } } }]), { headers: { 'content-type': 'application/json' } });
    }
    if (url === 'https://api.github.com/repos/myssal/PGR_Data/commits?path=cn&per_page=100') {
      return new Response(JSON.stringify([{ sha: revision, commit: { message: 'feat: [4.9.4] CN LIVE' } }]), { headers: { 'content-type': 'application/json' } });
    }
    const bytes = tables.get(url);
    if (!bytes) throw new Error(`测试请求超出固定版本原始表：${url}`);
    return new Response(new Uint8Array(bytes), { headers: { 'content-type': 'application/json', 'content-length': String(bytes.length) } });
  };
  return { fetch, requests };
};
