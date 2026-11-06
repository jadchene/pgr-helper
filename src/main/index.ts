import { app, BrowserWindow, dialog, ipcMain, nativeImage, session, shell } from 'electron';
import { mkdirSync, renameSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { CatalogStore } from './store';
import { SyncService } from './sync';
import { settingsSchema } from './schemas';
import { isTrustedRendererUrl } from './trusted-renderer';
import { listSystemFonts } from './fonts';
import { AssetImageCache } from './image-cache';
import type { AppSettings, CatalogEntry } from '../shared/types';
import type { GuideDocument } from '../shared/guides';

const moduleDirectory = dirname(fileURLToPath(import.meta.url));
const programDirectory = app.isPackaged ? dirname(app.getPath('exe')) : resolve(moduleDirectory, '../..');
const dataDirectory = app.isPackaged ? join(programDirectory, 'data') : resolve(process.env.PGR_DATA_DIR || join(programDirectory, 'data'));
const rendererPath = resolve(moduleDirectory, '../renderer/index.html');
const devUrl = !app.isPackaged && process.env.PGR_DEV_URL === 'http://127.0.0.1:5178' ? process.env.PGR_DEV_URL : null;
let window: BrowserWindow | null = null;
let store: CatalogStore | null = null;
let sync: SyncService | null = null;
let imageCache: AssetImageCache | null = null;

/** 所有应用状态和浏览器缓存均保存在程序数据目录。 */
try {
  mkdirSync(join(dataDirectory, 'session'), { recursive: true });
  app.setPath('userData', dataDirectory);
  app.setPath('sessionData', join(dataDirectory, 'session'));
} catch (error) {
  dialog.showErrorBox('无法打开战双助手', `程序目录不可写，请将软件移动到可写目录。\n${String(error)}`);
  app.exit(1);
}

/** 校验外部链接，避免把来源文本作为命令执行。 */
const openExternal = async (value: string): Promise<void> => {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('只允许打开 HTTPS 网页');
  await shell.openExternal(url.toString());
};

/** 注册仅允许主界面调用的 IPC。 */
const handle = (name: string, action: (...args: any[]) => unknown): void => {
  ipcMain.handle(`pgr:${name}`, async (event, ...args: unknown[]) => {
    const expected = devUrl ?? pathToFileURL(rendererPath).toString();
    if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isTrustedRendererUrl(event.senderFrame.url, expected)) throw new Error('不允许的窗口请求');
    try {
      return await action(...args);
    } catch (error) {
      if (error instanceof Error && error.name === 'ZodError') throw new Error('资料格式不正确，请检查必填内容、图片和关联字段');
      throw error;
    }
  });
};

/** 设置主进程能力，界面不直接获得文件或数据库访问权。 */
const registerApi = (): void => {
  const db = store!;
  const updater = sync!;
  const state = () => db.getState(app.getVersion());
  handle('getState', state);
  handle('saveGuide', (guide: GuideDocument, revision: number | null) => db.saveGuide(guide, revision));
  handle('setGuideHidden', (id: string, hidden: boolean, revision: number) => db.setGuideHidden(String(id), hidden, revision));
  handle('resolveAssetImage', (url: unknown) => typeof url === 'string' ? imageCache!.resolve(url) : null);
  handle('listSystemFonts', listSystemFonts);
  handle('saveSettings', (input: AppSettings) => {
    const settings = settingsSchema.parse(input);
    const current = db.getSettings();
    if (JSON.stringify([settings.activeSourceId, settings.sources]) !== JSON.stringify([current.activeSourceId, current.sources])) {
      if (updater.getProgress().busy) throw new Error('请先取消同步，再切换数据源');
      updater.cancel();
    }
    db.saveSettings(settings);
    return state();
  });
  handle('saveEntry', (entry: CatalogEntry) => db.saveEntry(entry));
  handle('deleteEntry', (id: string) => db.setHidden(String(id), true));
  handle('restoreEntry', (id: string) => db.setHidden(String(id), false));
  handle('resetEntry', (id: string) => db.resetEntry(String(id)));
  handle('prepareSync', (sourceId: string) => updater.prepare(String(sourceId)));
  handle('applySync', (token: string) => { updater.apply(String(token)); return state(); });
  handle('cancelSync', () => updater.cancel());
  handle('getSyncProgress', updater.getProgress);
  handle('rollback', (id: number) => {
    if (updater.getProgress().busy) throw new Error('请先取消同步，再回退版本');
    if (!Number.isSafeInteger(id)) throw new Error('版本标识无效');
    updater.cancel();
    db.rollback(id);
    return state();
  });
  handle('chooseImage', async () => {
    const result = await dialog.showOpenDialog(window!, { title: '选择资料图片', properties: ['openFile'], filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] });
    if (result.canceled) return null;
    const path = result.filePaths[0]!;
    if (statSync(path).size > 10_000_000) throw new Error('请选择小于 10 MB 的图片');
    const image = nativeImage.createFromPath(path);
    if (image.isEmpty()) throw new Error('无法读取所选图片');
    const size = image.getSize();
    const resized = Math.max(size.width, size.height) > 1024 ? image.resize(size.width >= size.height ? { width: 1024 } : { height: 1024 }) : image;
    const data = resized.toDataURL();
    if (data.length > 3_000_000) throw new Error('图片内容过大，请选择较小的图片');
    return data;
  });
  handle('openDataDirectory', async () => {
    const error = await shell.openPath(dataDirectory);
    if (error) throw new Error(error);
  });
  handle('openExternal', openExternal);
  handle('exportBackup', async () => {
    const result = await dialog.showSaveDialog(window!, { title: '导出战双助手备份', defaultPath: join(dataDirectory, `战双助手-${new Date().toISOString().slice(0, 10)}.json`), filters: [{ name: '战双助手备份', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return null;
    const temporary = `${result.filePath}.${randomUUID()}.tmp`;
    db.exportBackup(temporary);
    renameSync(temporary, result.filePath);
    return result.filePath;
  });
  handle('importBackup', async () => {
    if (updater.getProgress().busy) throw new Error('请先取消同步，再恢复备份');
    const result = await dialog.showOpenDialog(window!, { title: '恢复战双助手备份', properties: ['openFile'], filters: [{ name: '战双助手备份', extensions: ['json'] }] });
    if (result.canceled) return null;
    const path = result.filePaths[0]!;
    if (statSync(path).size > 100_000_000) throw new Error('备份文件超过 100 MB');
    const confirmation = await dialog.showMessageBox(window!, { type: 'question', title: '恢复备份', message: '恢复将替换当前资料、设置和本地修改。', detail: '恢复前会在数据目录的 backups 中自动保存当前内容。', buttons: ['取消', '恢复备份'], defaultId: 0, cancelId: 0 });
    if (confirmation.response !== 1) return null;
    const backupDirectory = join(dataDirectory, 'backups');
    mkdirSync(backupDirectory, { recursive: true });
    db.exportBackup(join(backupDirectory, `before-restore-${Date.now()}-${randomUUID()}.json`));
    db.importBackup(path);
    updater.cancel();
    return state();
  });
  handle('windowAction', (action: string) => {
    if (action === 'minimize') window?.minimize();
    else if (action === 'maximize') window?.isMaximized() ? window.unmaximize() : window?.maximize();
    else if (action === 'close') window?.close();
    else throw new Error('窗口操作无效');
  });
};

/** 创建受隔离的桌面窗口。 */
const createWindow = async (): Promise<void> => {
  window = new BrowserWindow({
    width: 1340, height: 900, minWidth: 1000, minHeight: 680, frame: false,
    show: false, title: '战双助手', backgroundColor: '#f5f5f7',
    icon: app.isPackaged ? join(process.resourcesPath, 'icon.png') : join(programDirectory, 'resources/icon.png'),
    webPreferences: { preload: resolve(moduleDirectory, '../preload/index.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const rendererUrl = devUrl ?? pathToFileURL(rendererPath).toString();
  // Vite 首次优化依赖或更新代码时会重载主页，只放行原有可信页面。
  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault();
  });
  window.webContents.on('will-redirect', (event, url) => {
    if (!isTrustedRendererUrl(url, rendererUrl)) event.preventDefault();
  });
  if (devUrl) {
    // 将开发窗口的加载故障输出到启动终端，便于定位启动失败。
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') console.error(`[renderer] ${details.message}`);
    });
    window.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[renderer] 页面加载失败 ${code}: ${description} (${url})`);
    });
    window.webContents.on('preload-error', (_event, path, error) => {
      console.error(`[renderer] 预加载失败 ${path}:`, error);
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[renderer] 渲染进程退出: ${details.reason} (${details.exitCode})`);
    });
  }
  window.on('closed', () => { window = null; });
  window.once('ready-to-show', () => { if (process.env.PGR_TEST_HIDDEN !== '1') window?.show(); });
  if (devUrl) await window.loadURL(devUrl);
  else await window.loadFile(rendererPath);
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (window?.isMinimized()) window.restore(); window?.focus(); });
  app.whenReady().then(async () => {
    session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.defaultSession.setPermissionCheckHandler(() => false);
    store = new CatalogStore(dataDirectory);
    sync = new SyncService(store);
    imageCache = new AssetImageCache(join(dataDirectory, 'image-cache'));
    registerApi();
    await createWindow();
  }).catch((error) => {
    dialog.showErrorBox('战双助手启动失败', error instanceof Error ? error.message : String(error));
    app.exit(1);
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => { sync?.cancel(); imageCache?.close(); });
  app.on('will-quit', () => store?.close());
}
