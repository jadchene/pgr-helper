import assert from 'node:assert/strict';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const childProcess = require('node:child_process');
const originalSpawn = childProcess.spawn;
const project = resolve(import.meta.dirname, '..');
const workRoot = resolve(process.env.PGR_DEV_WINDOW_WORK_DIR || join(tmpdir(), 'pgr-dev-window'));
const runDirectory = join(workRoot, 'run-' + randomUUID());
const reportPath = resolve(process.env.PGR_DEV_WINDOW_REPORT || join(project, 'test-results/dev-window.json'));
const fixtureReport = join(runDirectory, 'window.json');
const wrapper = fileURLToPath(new URL('./fixtures/dev-window-entry.mjs', import.meta.url));
const executable = resolve(require('electron'));
const result = { runAt: new Date().toISOString(), runDirectory, passed: false, spawn: null, window: null };
mkdirSync(runDirectory, { recursive: true });
mkdirSync(dirname(reportPath), { recursive: true });
process.chdir(project);
process.env.PGR_DATA_DIR = join(runDirectory, 'data');
process.env.PGR_DEV_WINDOW_FIXTURE_REPORT = fixtureReport;
process.env.PGR_TEST_NETWORK_MODE = 'offline';
delete process.env.PGR_TEST_HIDDEN;
let launched;
let watchdog;
let saved = false;

/** 仅清理本轮生成的隔离目录，失败现场保留供复查。 */
const cleanupData = () => {
  const target = resolve(runDirectory);
  if (dirname(target) !== workRoot || !basename(target).startsWith('run-')) throw new Error('拒绝清理测试目录之外的路径');
  rmSync(target, { recursive: true, force: true });
};

/** 在开发脚本退出前同步落盘，避免其退出监听器先结束进程。 */
const save = (exitCode, error) => {
  if (saved) return;
  saved = true;
  clearTimeout(watchdog);
  if (error) result.error = String(error);
  try { result.window = JSON.parse(readFileSync(fixtureReport, 'utf8')); }
  catch (failure) { result.error ||= '未取得窗口观测结果：' + String(failure); }
  result.exitCode = exitCode;
  result.passed = !result.error && exitCode === 0 && !!result.spawn && result.window?.passed === true;
  if (result.passed) {
    try { cleanupData(); result.temporaryDataRemoved = true; }
    catch (failure) { result.cleanupError = String(failure); result.passed = false; }
  }
  writeFileSync(reportPath, JSON.stringify(result, null, 2));
  if (!result.passed) process.exitCode = 1;
  console.log(JSON.stringify({ passed: result.passed, reportPath, windowsHide: result.spawn?.windowsHide, error: result.error || result.window?.error }));
};

/** 精确拦截真实开发脚本的 Electron 启动，仅替换测试入口路径。 */
childProcess.spawn = function (command, args, options) {
  if (resolve(String(command)).toLowerCase() !== executable.toLowerCase()) return originalSpawn.call(this, command, args, options);
  assert.equal(launched, undefined, '开发脚本不应重复启动 Electron');
  assert.equal(args[0], '.', '开发脚本入口已改变，请核对可见窗口回归');
  assert.equal(args.some(value => /^--(?:inspect|remote-debugging|no-sandbox|disable-gpu)/.test(value)), false, '此回归必须使用无调试和无额外 Chromium 参数的启动方式');
  assert.equal(options.env.PGR_DATA_DIR, process.env.PGR_DATA_DIR);
  assert.notEqual(options.env.PGR_TEST_HIDDEN, '1');
  result.spawn = { executable: command, originalArgs: args, testArgs: [wrapper, ...args.slice(1)], windowsHide: options.windowsHide ?? false, stdio: options.stdio, dataDirectory: options.env.PGR_DATA_DIR, devUrl: options.env.PGR_DEV_URL };
  // 保留原 options 对象：不能由测试覆盖 windowsHide、环境或标准流。
  launched = originalSpawn.call(this, command, [wrapper, ...args.slice(1)], options);
  launched.once('error', error => { save(1, error); process.emit('SIGTERM'); });
  launched.once('exit', (code, signal) => save(code, signal ? 'Electron 被信号终止：' + signal : undefined));
  watchdog = setTimeout(() => {
    save(1, '普通可见窗口启动超过 30 秒');
    if (launched.pid && launched.exitCode === null) childProcess.spawnSync('taskkill.exe', ['/PID', String(launched.pid), '/T', '/F'], { windowsHide: true });
    process.emit('SIGTERM');
  }, 30_000);
  return launched;
};
syncBuiltinESMExports();

// dev.mjs 持有 Vite 与进程退出清理；此监听器补齐启动阶段失败报告。
process.once('exit', code => { if (!saved) save(code || 1, '开发脚本未完成可见窗口观测'); });
try {
  await import('./dev.mjs');
} catch (error) {
  save(1, error);
  process.emit('SIGTERM');
}
