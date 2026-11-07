import { presetSchema, presetRecordSchema } from './preset-schema';
import { validatePreset } from '../shared/preset-validation';
import type { PresetDocument, PresetRecord } from '../shared/presets';
import type { DatabaseSync as SqliteDatabase } from 'node:sqlite';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import type { AppSettings, AppState, CatalogEntry, CatalogSnapshot, EntryView, SyncPreview, VersionInfo } from '../shared/types';
import { defaultSourceProfile, entrySchema, settingsSchema, snapshotSchema } from './schemas';
import { guideRecordSchema, guideSchema } from './guide-schema';
import { validateGuide } from '../shared/guide-validation';
import { validateGuideFlow } from '../shared/guide-flow';
import type { GuideDocument, GuideRecord } from '../shared/guides';

/** Electron 内置模块经 require 加载，兼容其 ESM 模块解析器。 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

/** 程序首次启动时的设置。 */
export const defaultSettings: AppSettings = {
  fontFamily: '',
  theme: 'system', viewMode: 'grid', checkOnStartup: false, activeSourceId: 'myssal-github',
  sources: [{ ...defaultSourceProfile }],
};
/** 持久化的基础版本行。 @author chenjd @created 2026-11-06 13:30:00 */
interface SourceRow {
  /** 规范化源资料 JSON。 */ payload: string;
  /** 退役标记。 */ retired: number;
  /** 更新时间。 */ updated_at: string;
}
/** 字段修正与回收站状态。 @author chenjd @created 2026-11-06 13:30:00 */
interface OverrideRow {
  /** 条目标识。 */ id: string;
  /** 仅包含本地修改字段。 */ patch: string;
  /** 回收站标记。 */ hidden: number;
  /** 更新时间。 */ updated_at: string;
}
/** 属性按键覆盖，null 表示用户明确移除，兼容早期整字段覆盖。 */
const patchSchema = entrySchema.partial().extend({ _attributes: z.record(z.string(), z.string().nullable()).optional() }).strict();
/** 本地覆盖记录的内部格式。 */
type EntryPatch = z.infer<typeof patchSchema>;
/** 将属性键修正合并到当前来源；不把内部字段交给界面。 */
const mergePatch = (base: CatalogEntry, patch: EntryPatch): CatalogEntry => {
  const { _attributes, ...fields } = patch;
  const merged = { ...base, ...fields, attributes: { ...(fields.attributes ?? base.attributes) } };
  for (const [key, value] of Object.entries(_attributes ?? {})) {
    if (value === null) delete merged.attributes[key];
    else merged.attributes[key] = value;
  }
  return merged;
};
/** 备份文件内容验证。 */
const backupSchema = z.object({
  format: z.literal('pgr-helper-backup'), schemaVersion: z.literal(1), exportedAt: z.iso.datetime(),
  settings: settingsSchema, currentVersionIndex: z.number().int().nonnegative().nullable(),
  versions: z.array(z.object({ sourceName: z.string().max(200), importedAt: z.iso.datetime(), snapshot: snapshotSchema })).max(5),
  sourceEntries: z.array(z.object({ entry: entrySchema, retired: z.boolean(), updatedAt: z.iso.datetime() })).max(50_000),
  overrides: z.array(z.object({ id: z.string(), patch: patchSchema, hidden: z.boolean(), updatedAt: z.iso.datetime() })).max(50_000),
  localEntries: z.array(z.object({ entry: entrySchema, hidden: z.boolean(), updatedAt: z.iso.datetime() })).max(50_000),
  guides: z.array(guideRecordSchema).max(10_000),
  presets: z.array(presetRecordSchema).max(10_000),
}).strict();

/** SQLite 资料仓库。源资料与用户改动分层，切换版本不会覆盖用户改动。 @author chenjd @created 2026-11-06 13:30:00 */
export class CatalogStore {
  /** 当前数据库连接。 */
  readonly db: SqliteDatabase;
  /** 程序数据目录。 */
  readonly directory: string;

  /** 初始化空数据库；已有资料和用户改动保持不变。 */
  constructor(directory: string) {
    this.directory = directory;
    mkdirSync(directory, { recursive: true });
    this.db = new DatabaseSync(join(directory, 'pgr.sqlite'));
    const schemaVersion = Number(this.db.prepare('PRAGMA user_version').get()?.user_version ?? 0);
    if (schemaVersion > 1) {
      this.db.close();
      throw new Error('资料库由更新版本的软件创建，请使用相同或更新版本打开');
    }
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS versions (id INTEGER PRIMARY KEY AUTOINCREMENT, source_name TEXT NOT NULL, revision TEXT NOT NULL, version TEXT NOT NULL, imported_at TEXT NOT NULL, count INTEGER NOT NULL, payload TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS source_entries (id TEXT PRIMARY KEY, payload TEXT NOT NULL, retired INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS overrides (id TEXT PRIMARY KEY REFERENCES source_entries(id), patch TEXT NOT NULL DEFAULT '{}', hidden INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS local_entries (id TEXT PRIMARY KEY, payload TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS guides (id TEXT PRIMARY KEY, payload TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);
      PRAGMA user_version=1;
    `);
    this.db.exec('CREATE TABLE IF NOT EXISTS presets (id TEXT PRIMARY KEY, payload TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, revision INTEGER NOT NULL);');
    const storedSettings = this.getMeta('settings');
    if (storedSettings === null) this.setMeta('settings', defaultSettings);
    else if (!settingsSchema.safeParse(storedSettings).success) {
      this.db.close();
      throw new Error('本地设置不符合当前远程数据源格式');
    }
  }

  /** 在原子事务中执行一次写入，异常时回滚。 */
  private transaction = <T>(action: () => T): T => {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = action();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  };

  /** 读取 JSON 配置。 */
  private getMeta = (key: string): unknown => {
    const row = this.db.prepare('SELECT value FROM meta WHERE key=?').get(key);
    return row ? JSON.parse(String(row.value)) : null;
  };

  /** 保存 JSON 配置。 */
  private setMeta = (key: string, value: unknown): void => {
    this.db.prepare('INSERT INTO meta(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, JSON.stringify(value));
  };

  /** 获取已验证设置。 */
  getSettings = (): AppSettings => settingsSchema.parse(this.getMeta('settings'));

  /** 保存用户偏好与来源配置。 */
  saveSettings = (settings: AppSettings): void => {
    this.setMeta('settings', settingsSchema.parse(settings));
  };

  /** 读取所有条目，包含回收站与退役资料，界面自行筛选。 */
  listEntries = (): EntryView[] => {
    const overrides = new Map((this.db.prepare('SELECT * FROM overrides').all() as unknown as OverrideRow[]).map((row) => [row.id, row]));
    const entries = (this.db.prepare('SELECT * FROM source_entries').all() as unknown as SourceRow[]).map((row): EntryView => {
      const base = JSON.parse(row.payload) as CatalogEntry;
      const overlay = overrides.get(base.id);
      const patch = overlay ? JSON.parse(overlay.patch) as EntryPatch : {};
      return { ...mergePatch(base, patch), origin: 'source', modified: Object.keys(patch).length > 0, hidden: !!overlay?.hidden, retired: !!row.retired, updatedAt: overlay?.updated_at ?? row.updated_at };
    });
    for (const row of this.db.prepare('SELECT * FROM local_entries').all()) {
      entries.push({ ...JSON.parse(String(row.payload)), origin: 'local', modified: false, hidden: !!row.hidden, retired: false, updatedAt: String(row.updated_at) });
    }
    return entries;
  };

  /** 返回现有版本摘要。 */
  listVersions = (): VersionInfo[] => this.db.prepare("SELECT id,source_name,revision,version,imported_at,count,json_extract(payload,'$.imageSource') AS image_source FROM versions ORDER BY id DESC").all().map((row) => ({
    id: Number(row.id), sourceName: String(row.source_name), revision: String(row.revision), version: String(row.version), importedAt: String(row.imported_at), count: Number(row.count),
    ...(row.image_source ? { imageSource: JSON.parse(String(row.image_source)) } : {}),
  }));

  /** 返回应用需要的完整本地状态。 */
  getState = (appVersion = '0.1.0'): AppState => {
    const versions = this.listVersions();
    return { appVersion, dataDirectory: this.directory, settings: this.getSettings(), entries: this.listEntries(), guides: this.listGuides(), presets: this.listPresets(), versions, currentVersion: versions.find((version) => version.id === this.getMeta('currentVersion')) ?? null };
  };


  /** 读取独立预设，资料版本切换不覆盖用户配置。 */
  listPresets = (): PresetRecord[] => this.db.prepare('SELECT * FROM presets ORDER BY updated_at DESC,id').all().map(row => ({
    ...JSON.parse(String(row.payload)) as PresetDocument, hidden: !!row.hidden, createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision),
  }));
  /** 校验并保存预设，使用修订号防止旧编辑覆盖新内容。 */
  savePreset = (input: PresetDocument, revision: number | null): PresetRecord => {
    const preset = presetSchema.parse(input);
    const issues = validatePreset(preset, this.listEntries());
    if (issues.length) throw new Error(issues.join('\n'));
    if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error('预设修订号无效');
    this.transaction(() => {
      if (preset.kind === 'character' && this.db.prepare("SELECT id FROM presets WHERE json_extract(payload,'$.kind')='character' AND json_extract(payload,'$.characterId')=? AND id<>?").get(preset.characterId, preset.id)) throw new Error('该机体已有配置，请从机体列表打开编辑。');
      const existing = this.db.prepare('SELECT revision,hidden FROM presets WHERE id=?').get(preset.id);
      const now = new Date().toISOString();
      if (existing) {
        if (existing.hidden || Number(existing.revision) !== revision) throw new Error('预设已更新或位于回收站，请重新打开。');
        this.db.prepare('UPDATE presets SET payload=?,updated_at=?,revision=revision+1 WHERE id=?').run(JSON.stringify(preset), now, preset.id);
      } else {
        if (revision !== null) throw new Error('预设不存在，请刷新列表。');
        this.db.prepare('INSERT INTO presets VALUES (?,?,0,?,?,1)').run(preset.id, JSON.stringify(preset), now, now);
      }
    });
    return this.listPresets().find(item => item.id === preset.id)!;
  };
  /** 预设可恢复删除，校验修订避免并发覆盖。 */
  setPresetHidden = (id: string, hidden: boolean, revision: number): PresetRecord => {
    if (typeof hidden !== 'boolean' || !Number.isSafeInteger(revision) || revision < 1) throw new Error('预设操作参数无效');
    const result = this.db.prepare('UPDATE presets SET hidden=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(Number(hidden), new Date().toISOString(), id, revision);
    if (!result.changes) throw new Error('预设已更新或不存在，请刷新。');
    return this.listPresets().find(item => item.id === id)!;
  };

  /** 攻略独立于来源版本保存，按最近修改时间排列。 */
  listGuides = (): GuideRecord[] => this.db.prepare('SELECT * FROM guides ORDER BY updated_at DESC,id').all().map(row => ({
    ...JSON.parse(String(row.payload)) as GuideDocument, hidden: !!row.hidden,
    createdAt: String(row.created_at), updatedAt: String(row.updated_at), revision: Number(row.revision),
  }));

  /** 保存经过语义校验的攻略，拒绝重复创建和旧修订覆盖。 */
  saveGuide = (input: GuideDocument, revision: number | null): GuideRecord => {
    const parsed = guideSchema.safeParse(input);
    if (!parsed.success) throw new Error(parsed.error.issues.slice(0, 3).map(issue => issue.message).join('；'));
    const guide = parsed.data;
    const issues = validateGuide(guide, this.listEntries());
    if (issues.length) throw new Error(issues.slice(0, 4).map(issue => issue.message).join('\n'));
    if (revision !== null && (!Number.isSafeInteger(revision) || revision < 1)) throw new Error('攻略修订号无效');
    this.transaction(() => {
      const existing = this.db.prepare('SELECT revision,hidden FROM guides WHERE id=?').get(guide.id);
      if (existing) {
        if (Number(existing.revision) !== revision) throw new Error('攻略已在其他操作中更新，请重新打开后编辑。');
        if (existing.hidden) throw new Error('请先恢复回收站中的攻略。');
        this.db.prepare('UPDATE guides SET payload=?,updated_at=?,revision=revision+1 WHERE id=?').run(JSON.stringify(guide), new Date().toISOString(), guide.id);
      } else {
        if (revision !== null) throw new Error('攻略已不存在，请重新打开列表。');
        const now = new Date().toISOString();
        this.db.prepare('INSERT INTO guides VALUES (?,?,0,?,?,1)').run(guide.id, JSON.stringify(guide), now, now);
      }
    });
    return this.listGuides().find(value => value.id === guide.id)!;
  };

  /** 可恢复地隐藏攻略，保留其全部配置与流程。 */
  setGuideHidden = (id: string, hidden: boolean, revision: number): GuideRecord => {
    if (typeof hidden !== 'boolean' || !Number.isSafeInteger(revision) || revision < 1) throw new Error('攻略操作参数无效');
    const result = this.db.prepare('UPDATE guides SET hidden=?,updated_at=?,revision=revision+1 WHERE id=? AND revision=?').run(Number(hidden), new Date().toISOString(), id, revision);
    if (!result.changes) throw new Error('攻略已更新或不存在，请刷新后重试。');
    return this.listGuides().find(value => value.id === id)!;
  };

  /** 校验本地引用，允许引用现有的退役资料。 */
  private validateRelations = (entry: CatalogEntry): void => {
    const existing = new Set(this.listEntries().map((item) => item.id));
    for (const id of entry.relatedIds) {
      if (id === entry.id || !existing.has(id)) throw new Error('关联资料不存在或不能关联自身');
    }
  };

  /** 新增本地条目或保存对源条目的字段修正。 */
  saveEntry = (input: CatalogEntry): EntryView => {
    const entry = entrySchema.parse(input);
    this.validateRelations(entry);
    const now = new Date().toISOString();
    const source = this.db.prepare('SELECT payload FROM source_entries WHERE id=?').get(entry.id);
    if (source) {
      const base = JSON.parse(String(source.payload)) as CatalogEntry;
      if (entry.category !== base.category || entry.sourceKey !== base.sourceKey) throw new Error('来源资料的分类与原始标识不可修改');
      const patch: EntryPatch = {};
      for (const key of Object.keys(base) as (keyof CatalogEntry)[]) {
        if (key !== 'attributes' && JSON.stringify(base[key]) !== JSON.stringify(entry[key])) Object.assign(patch, { [key]: entry[key] });
      }
      const attributeChanges: Record<string, string | null> = {};
      for (const key of new Set([...Object.keys(base.attributes), ...Object.keys(entry.attributes)])) {
        if (base.attributes[key] !== entry.attributes[key]) attributeChanges[key] = entry.attributes[key] ?? null;
      }
      if (Object.keys(attributeChanges).length) patch._attributes = attributeChanges;
      this.db.prepare("INSERT INTO overrides(id,patch,hidden,updated_at) VALUES (?,?,0,?) ON CONFLICT(id) DO UPDATE SET patch=excluded.patch,updated_at=excluded.updated_at").run(entry.id, JSON.stringify(patch), now);
    } else {
      if (!/^local:[a-zA-Z0-9-]{8,100}$/.test(entry.id) || entry.sourceKey) throw new Error('新资料必须使用独立的本地标识');
      this.db.prepare('INSERT INTO local_entries(id,payload,hidden,updated_at) VALUES (?,?,0,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,updated_at=excluded.updated_at').run(entry.id, JSON.stringify(entry), now);
    }
    return this.listEntries().find((item) => item.id === entry.id)!;
  };

  /** 设置回收站状态，不删除来源或覆盖记录。 */
  setHidden = (id: string, hidden: boolean): void => {
    const now = new Date().toISOString();
    if (this.db.prepare('SELECT id FROM source_entries WHERE id=?').get(id)) {
      this.db.prepare("INSERT INTO overrides(id,patch,hidden,updated_at) VALUES (?,'{}',?,?) ON CONFLICT(id) DO UPDATE SET hidden=excluded.hidden,updated_at=excluded.updated_at").run(id, Number(hidden), now);
    } else {
      const result = this.db.prepare('UPDATE local_entries SET hidden=?,updated_at=? WHERE id=?').run(Number(hidden), now, id);
      if (!result.changes) throw new Error('资料不存在');
    }
  };

  /** 恢复当前来源字段，同时保持现有回收站状态。 */
  resetEntry = (id: string): void => {
    if (!this.db.prepare('SELECT id FROM source_entries WHERE id=?').get(id)) throw new Error('仅来源资料可以恢复原文');
    this.db.prepare("UPDATE overrides SET patch='{}',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
  };

  /** 获取基础版本，不把用户修正纳入同步差异。 */
  getCurrentSnapshot = (): CatalogSnapshot | null => {
    const row = this.db.prepare('SELECT payload FROM versions WHERE id=?').get(Number(this.getMeta('currentVersion') ?? 0));
    return row ? JSON.parse(String(row.payload)) as CatalogSnapshot : null;
  };

  /** 校验重复主键与源关联，拒绝不可用候选。 */
  validateSnapshot = (input: CatalogSnapshot): CatalogSnapshot => {
    const snapshot = snapshotSchema.parse(input);
    const ids = new Set<string>();
    for (const entry of snapshot.entries) {
      if (ids.has(entry.id) || entry.id.startsWith('local:')) throw new Error(`资料主键重复或非法：${entry.id}`);
      ids.add(entry.id);
    }
    for (const entry of snapshot.entries) {
      if (entry.relatedIds.some((id) => !ids.has(id))) throw new Error(`资料引用缺失：${entry.name}`);
    }
    return snapshot;
  };

  /** 生成差异预览；大幅缺项视为候选异常。 */
  preview = (input: CatalogSnapshot, sourceName: string, token: string): SyncPreview => {
    const snapshot = this.validateSnapshot(input);
    const current = this.getCurrentSnapshot();
    const previous = new Map(current?.entries.map((entry) => [entry.id, entry]) ?? []);
    const next = new Map(snapshot.entries.map((entry) => [entry.id, entry]));
    const examples: SyncPreview['examples'] = [];
    let added = 0;
    let changed = 0;
    let removed = 0;
    for (const entry of snapshot.entries) {
      const old = previous.get(entry.id);
      const kind = !old ? 'added' : JSON.stringify(old) !== JSON.stringify(entry) ? 'changed' : null;
      if (kind === 'added') added++;
      if (kind === 'changed') changed++;
      if (kind && examples.length < 100) examples.push({ kind, name: entry.name });
    }
    for (const [id, entry] of previous) {
      if (!next.has(id)) {
        removed++;
        if (examples.length < 100) examples.push({ kind: 'removed', name: entry.name });
      }
    }
    if (current && removed > Math.max(5, current.entries.length * 0.2)) throw new Error('候选资料减少超过 20%，已保留现有版本。请核对来源完整性。');
    for (const category of new Set(current?.entries.map((entry) => entry.category) ?? [])) {
      const oldCount = current!.entries.filter((entry) => entry.category === category).length;
      const newCount = snapshot.entries.filter((entry) => entry.category === category).length;
      if (oldCount - newCount > Math.max(5, oldCount * 0.2)) throw new Error(`${category} 分类资料减少超过 20%，请核对来源完整性`);
    }
    return { token, sourceName, revision: snapshot.revision, version: snapshot.version, added, changed, removed, total: snapshot.entries.length, examples, warnings: snapshot.warnings, ...(snapshot.imageSource ? { imageSource: snapshot.imageSource } : {}) };
  };

  /** 事务内启用版本，旧资料保留为退役项。 */
  private activate = (snapshot: CatalogSnapshot, versionId: number): void => {
    const now = new Date().toISOString();
    this.db.exec('UPDATE source_entries SET retired=1');
    const upsert = this.db.prepare('INSERT INTO source_entries(id,payload,retired,updated_at) VALUES (?,?,0,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,retired=0,updated_at=excluded.updated_at');
    for (const entry of snapshot.entries) upsert.run(entry.id, JSON.stringify(entry), now);
    this.setMeta('currentVersion', versionId);
  };

  /** 原子启用新资料包，保留最近五个版本。 */
  applySnapshot = (input: CatalogSnapshot, sourceName: string): void => {
    const snapshot = this.validateSnapshot(input);
    this.transaction(() => {
      const result = this.db.prepare('INSERT INTO versions(source_name,revision,version,imported_at,count,payload) VALUES (?,?,?,?,?,?)').run(sourceName, snapshot.revision, snapshot.version, new Date().toISOString(), snapshot.entries.length, JSON.stringify(snapshot));
      this.activate(snapshot, Number(result.lastInsertRowid));
      this.db.exec('DELETE FROM versions WHERE id NOT IN (SELECT id FROM versions ORDER BY id DESC LIMIT 5)');
    });
  };

  /** 回退基础资料，用户修改仍独立保留。 */
  rollback = (versionId: number): void => {
    const row = this.db.prepare('SELECT payload FROM versions WHERE id=?').get(versionId);
    if (!row) throw new Error('所选资料版本不存在');
    const snapshot = this.validateSnapshot(JSON.parse(String(row.payload)));
    this.transaction(() => this.activate(snapshot, versionId));
  };

  /** 导出可移植完整备份，图片内嵌在本地条目中。 */
  exportBackup = (path: string): void => {
    const versions = this.db.prepare('SELECT id,source_name,imported_at,payload FROM versions ORDER BY id').all();
    const currentId = this.getMeta('currentVersion');
    const currentVersionIndex = versions.findIndex((row) => Number(row.id) === currentId);
    const backup = {
      format: 'pgr-helper-backup', schemaVersion: 1, exportedAt: new Date().toISOString(), settings: this.getSettings(), currentVersionIndex: currentVersionIndex >= 0 ? currentVersionIndex : null,
      versions: versions.map((row) => ({ sourceName: row.source_name, importedAt: row.imported_at, snapshot: JSON.parse(String(row.payload)) })),
      sourceEntries: this.db.prepare('SELECT * FROM source_entries').all().map((row) => ({ entry: JSON.parse(String(row.payload)), retired: !!row.retired, updatedAt: row.updated_at })),
      overrides: this.db.prepare('SELECT * FROM overrides').all().map((row) => ({ id: row.id, patch: JSON.parse(String(row.patch)), hidden: !!row.hidden, updatedAt: row.updated_at })),
      localEntries: this.db.prepare('SELECT * FROM local_entries').all().map((row) => ({ entry: JSON.parse(String(row.payload)), hidden: !!row.hidden, updatedAt: row.updated_at })),
      guides: this.listGuides(), presets: this.listPresets(),
    };
    writeFileSync(path, JSON.stringify(backup), { encoding: 'utf8', flag: 'wx' });
  };

  /** 验证完整备份后事务恢复；失败不改变当前库。 */
  importBackup = (path: string): void => {
    const backup = backupSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (new Set(backup.guides.map(guide => guide.id)).size !== backup.guides.length) throw new Error('备份存在重复攻略');
    if (new Set(backup.presets.map(item => item.id)).size !== backup.presets.length) throw new Error('备份存在重复预设');
    for (const guide of backup.guides) {
      const members = guide.team.members;
      const memberIds = new Set(members.map(member => member.id));
      const invalidRole = [guide.team.starterMemberId, guide.team.captainMemberId].some(id => id && !memberIds.has(id));
      if (memberIds.size !== members.length || new Set(members.map(member => member.position)).size !== members.length || invalidRole) throw new Error('备份攻略的队伍成员或站位无效');
      const issues = validateGuideFlow(guide.flow, guide.team, { allowIncomplete: guide.status === 'draft' });
      if (issues.length) throw new Error(`备份攻略流程无效：${issues[0].message}`);
    }
    for (const version of backup.versions) this.validateSnapshot(version.snapshot);
    const sourceIds = new Set(backup.sourceEntries.map((row) => row.entry.id));
    const localIds = new Set(backup.localEntries.map((row) => row.entry.id));
    if (sourceIds.size !== backup.sourceEntries.length || localIds.size !== backup.localEntries.length) throw new Error('备份存在重复条目');
    if (backup.localEntries.some((row) => !row.entry.id.startsWith('local:') || sourceIds.has(row.entry.id))) throw new Error('备份本地标识非法');
    if (backup.overrides.some((row) => !sourceIds.has(row.id) || row.patch.id !== undefined || row.patch.category !== undefined || row.patch.sourceKey !== undefined)) throw new Error('备份字段修正无效');
    if (backup.currentVersionIndex !== null && !backup.versions[backup.currentVersionIndex]) throw new Error('备份缺少当前版本');
    const allIds = new Set([...sourceIds, ...localIds]);
    const overrides = new Map(backup.overrides.map((row) => [row.id, row.patch]));
    const effectiveEntries = [...backup.sourceEntries.map((row) => mergePatch(row.entry, overrides.get(row.entry.id) ?? {})), ...backup.localEntries.map((row) => row.entry)];
    if (effectiveEntries.some((entry) => entry.relatedIds.some((id) => !allIds.has(id) || id === entry.id))) throw new Error('备份资料存在无效关联');
    const activeSnapshot = backup.currentVersionIndex === null ? null : backup.versions[backup.currentVersionIndex]!.snapshot;
    const activeEntries = new Map(backup.sourceEntries.filter((row) => !row.retired).map((row) => [row.entry.id, row.entry]));
    if ((activeSnapshot?.entries.length ?? 0) !== activeEntries.size || activeSnapshot?.entries.some((entry) => JSON.stringify(entry) !== JSON.stringify(activeEntries.get(entry.id)))) throw new Error('备份有效资料与版本内容不一致');
    this.transaction(() => {
      this.db.exec('DELETE FROM overrides; DELETE FROM local_entries; DELETE FROM source_entries; DELETE FROM versions;');
      this.db.exec('DELETE FROM guides;');
      this.db.exec('DELETE FROM presets;');
      for (const record of backup.presets) {
        const { hidden, createdAt, updatedAt, revision, ...preset } = record;
        this.db.prepare('INSERT INTO presets VALUES (?,?,?,?,?,?)').run(preset.id, JSON.stringify(preset), Number(hidden), createdAt, updatedAt, revision);
      }
      let currentId: number | null = null;
      for (const [index, item] of backup.versions.entries()) {
        const snapshot = item.snapshot;
        const result = this.db.prepare('INSERT INTO versions(source_name,revision,version,imported_at,count,payload) VALUES (?,?,?,?,?,?)').run(item.sourceName, snapshot.revision, snapshot.version, item.importedAt, snapshot.entries.length, JSON.stringify(snapshot));
        if (index === backup.currentVersionIndex) currentId = Number(result.lastInsertRowid);
      }
      for (const row of backup.sourceEntries) this.db.prepare('INSERT INTO source_entries VALUES (?,?,?,?)').run(row.entry.id, JSON.stringify(row.entry), Number(row.retired), row.updatedAt);
      for (const row of backup.localEntries) this.db.prepare('INSERT INTO local_entries VALUES (?,?,?,?)').run(row.entry.id, JSON.stringify(row.entry), Number(row.hidden), row.updatedAt);
      for (const row of backup.overrides) this.db.prepare('INSERT INTO overrides VALUES (?,?,?,?)').run(row.id, JSON.stringify(row.patch), Number(row.hidden), row.updatedAt);
      for (const record of backup.guides) {
        const { hidden, createdAt, updatedAt, revision, ...guide } = record;
        this.db.prepare('INSERT INTO guides VALUES (?,?,?,?,?,?)').run(guide.id, JSON.stringify(guide), Number(hidden), createdAt, updatedAt, revision);
      }
      this.setMeta('settings', backup.settings);
      this.setMeta('currentVersion', currentId);
    });
  };

  /** 释放数据库连接。 */
  close = (): void => this.db.close();
}
