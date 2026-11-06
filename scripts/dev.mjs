import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const processes = [];
let server;
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
/** 运行项目内 CLI，避免 shell 字符串拼接。 */
const run = (path, args, extra = {}) => {
  const child = spawn(process.execPath, [path, ...args], { stdio: 'inherit', env: { ...env, ...extra }, windowsHide: true });
  processes.push(child);
  return child;
};
/** 顺序完成主进程和预加载脚本构建。 */
const build = (config) => new Promise((resolve, reject) => {
  const child = run(require.resolve('tsup/dist/cli-default.js'), ['--config', config]);
  child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`构建失败：${config}`)));
});
/** 退出时清理本次启动的开发进程。 */
const stop = async () => {
  for (const child of processes) if (!child.killed) child.kill();
  await server?.close();
};
process.on('SIGINT', async () => { await stop(); process.exit(); });
process.on('SIGTERM', async () => { await stop(); process.exit(); });
try {
  await build('tsup.main.config.ts');
  await build('tsup.preload.config.ts');
  server = await createServer({ configFile: 'vite.config.ts' });
  await server.listen();
  // Electron 需要显示原生窗口；windowsHide 会使 Windows 桌面窗口显示异常。
  const electron = spawn(require('electron'), ['.'], { stdio: 'inherit', env: { ...env, PGR_DEV_URL: 'http://127.0.0.1:5178' }, windowsHide: false });
  processes.push(electron);
  electron.on('exit', async () => { await stop(); process.exit(); });
} catch (error) {
  await stop();
  console.error(error);
  process.exit(1);
}
