import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi } from '../shared/types';

/** 只暴露固定业务方法，不把 ipcRenderer 交给网页。 */
const invoke = <T>(name: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(`pgr:${name}`, ...args);
const desktop: DesktopApi = {
  savePreset: (preset, revision) => invoke('savePreset', preset, revision),
  setPresetHidden: (id, hidden, revision) => invoke('setPresetHidden', id, hidden, revision),
  saveGuide: (guide, revision) => invoke('saveGuide', guide, revision),
  setGuideHidden: (id, hidden, revision) => invoke('setGuideHidden', id, hidden, revision),
  resolveAssetImage: (url) => invoke('resolveAssetImage', url),
  listSystemFonts: () => invoke('listSystemFonts'),
  getState: () => invoke('getState'), saveSettings: (settings) => invoke('saveSettings', settings),
  saveEntry: (entry) => invoke('saveEntry', entry), deleteEntry: (id) => invoke('deleteEntry', id),
  restoreEntry: (id) => invoke('restoreEntry', id), resetEntry: (id) => invoke('resetEntry', id),
  prepareSync: (id) => invoke('prepareSync', id), applySync: (token) => invoke('applySync', token),
  cancelSync: () => invoke('cancelSync'), getSyncProgress: () => invoke('getSyncProgress'),
  rollback: (id) => invoke('rollback', id),
  chooseImage: () => invoke('chooseImage'), exportBackup: () => invoke('exportBackup'),
  importBackup: () => invoke('importBackup'), openDataDirectory: () => invoke('openDataDirectory'),
  openExternal: (url) => invoke('openExternal', url), windowAction: (action) => invoke('windowAction', action),
};
contextBridge.exposeInMainWorld('desktop', desktop);
