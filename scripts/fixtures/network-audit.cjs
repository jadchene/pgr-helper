// 测试专用主进程请求观察器；生产代码不加载此文件。
const originalFetch = globalThis.fetch;
const audit = { mode: process.env.PGR_TEST_NETWORK_MODE || 'live', phase: 'startup', calls: [] };
globalThis.__pgrNetworkAudit = audit;
globalThis.fetch = async (...args) => {
  const input = args[0];
  const url = typeof input === 'string' || input instanceof URL ? String(input) : input.url;
  const call = { url, mode: audit.mode, phase: audit.phase, startedAt: new Date().toISOString() };
  audit.calls.push(call);
  if (audit.mode === 'offline') {
    call.injected = true;
    throw new Error('离线故障注入：测试阻断资料请求');
  }
  if (audit.mode === 'pending') {
    call.injected = true;
    const signal = args[1]?.signal || input.signal;
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(new Error('测试请求已取消')); return; }
      signal?.addEventListener('abort', () => reject(new Error('测试请求已取消')), { once: true });
    });
  }
  try {
    const response = await originalFetch(...args);
    call.status = response.status;
    return response;
  } catch (error) {
    call.error = String(error);
    throw error;
  }
};
