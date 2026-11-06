import { app } from 'electron';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import './network-audit.cjs';

const reportPath = process.env.PGR_DEV_WINDOW_FIXTURE_REPORT;
if (!reportPath || !process.env.PGR_DATA_DIR) throw new Error('窗口测试入口仅允许由隔离回归脚本启动');
const startedAt = Date.now();
const result = { passed: false, argv: process.argv, expectedEntries: 0, events: [], observations: [] };
let finished = false;
let polling;
let timeout;
let sampling = false;
let readySamples = 0;

/** 写出完整观测后结束本次 Electron，避免遗留可见窗口。 */
const finish = (passed, error) => {
  if (finished) return;
  finished = true;
  clearInterval(polling);
  clearTimeout(timeout);
  result.passed = passed;
  result.sourceRequests = globalThis.__pgrNetworkAudit.calls;
  if (error) result.error = String(error);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  app.exit(passed ? 0 : 1);
};

app.on('browser-window-created', (_event, window) => {
  for (const event of ['ready-to-show', 'show', 'hide', 'unresponsive', 'closed']) window.on(event, () => result.events.push({ event, elapsed: Date.now() - startedAt }));
  window.webContents.on('render-process-gone', (_event, details) => finish(false, '渲染进程退出：' + details.reason));
  polling = setInterval(async () => {
    if (sampling || finished || window.isDestroyed()) return;
    sampling = true;
    try {
      const sample = { elapsed: Date.now() - startedAt, visible: window.isVisible(), focused: window.isFocused(), minimized: window.isMinimized(), url: window.webContents.getURL(), loading: window.webContents.isLoadingMainFrame() };
      if (!sample.loading && sample.url === 'http://127.0.0.1:5178/') {
        // 仅读取 DOM 与桥接数据，不截图、不连接调试器、不修改窗口状态。
        sample.dom = await window.webContents.executeJavaScript('(async () => { const state = await window.desktop.getState(); return { heading: Array.from(document.querySelectorAll("h1")).some(node => node.textContent.trim() === "首次同步基础资料"), ready: document.readyState, visibility: document.visibilityState, entries: state.entries.length, currentVersion: state.currentVersion }; })()');
      }
      result.observations.push(sample);
      if (sample.visible && sample.dom?.heading && sample.dom.entries === 0 && sample.dom.currentVersion === null && globalThis.__pgrNetworkAudit.calls.length === 0) readySamples++;
      else readySamples = 0;
      if (readySamples >= 3) finish(true);
    } catch (error) {
      result.observations.push({ elapsed: Date.now() - startedAt, error: String(error) });
    } finally {
      sampling = false;
    }
  }, 500);
});

timeout = setTimeout(() => {
  const rendered = result.observations.some(sample => sample.dom?.heading && sample.dom.entries === 0);
  finish(false, globalThis.__pgrNetworkAudit.calls.length ? '首次打开不应自动请求远程资料' : rendered ? '首次同步页面已经渲染，但真实 BrowserWindow 未持续可见' : '窗口未在 15 秒内显示首次同步页面');
}, 15_000);

// 真实主进程保持原有模块路径、资料目录、窗口选项和显示逻辑。
void import('../../dist/main/index.mjs').catch(error => finish(false, error));
