import type { PresetDocument, PresetRecord } from './presets';
import type { GuideEntryOptions } from './guide-options';
import type { GuideDocument, GuideRecord } from './guides';

/** 基础资料分类。 */
export const categories = ['character', 'memory', 'weapon', 'resonance', 'pet', 'stage', 'weather', 'dictionary'] as const;
/** 资料分类代码。 */
export type Category = typeof categories[number];
/** 分类的中文名称。 */
export const categoryLabels: Record<Category, string> = { character: '机体', memory: '意识', weapon: '武器', resonance: '共鸣', pet: '辅助机', stage: '副本', weather: '天气与词缀', dictionary: '基础字典' };

/** 资料正文段落。 @author chenjd @created 2026-11-06 13:30:00 */
export interface EntrySection {
  /** 段落标题。 */ title: string;
  /** 纯文本正文。 */ body: string;
  /** 上游明确声明的技能分类及变体关系，普通段落不提供。 */ skill?: SkillSectionMetadata;
}
/** 技能段落的源结构，不依赖名称或正文推测分类。 @author chenjd @created 2026-11-06 16:00:00 */
export interface SkillSectionMetadata {
  /** 来源明确给出的图标资源路径。 */ iconResource?: string;
  /** 固定图片版本对应的可展示图标。 */ image?: string;
  /** 区分机体和辅助机技能。 */ kind: 'character' | 'pet-active' | 'pet-passive';
  /** 技能或升阶记录的稳定源标识。 */ id: string;
  /** 大类标识。 */ groupId: string;
  /** 来源定义的大类名称。 */ groupName: string;
  /** 大类展示顺序。 */ groupOrder: number;
  /** 来源中同一逻辑技能组的标识，属性变体共用。 */ familyId: string;
  /** 源组名称；没有名称时使用组内顺序说明。 */ familyName: string;
  /** 来源小类或升阶阶段名称。 */ typeName: string;
  /** 此段正文对应的实际技能等级。 */ level?: number;
  /** 辅助机主动技能组明确提供的属性引用。 */ element?: { id: number; name: string };
}
/** 来源提供的排序与专属筛选信息；不等同于游戏发布日期。 @author chenjd @created 2026-11-06 16:20:00 */
export interface CatalogMetadata {
  /** 同类内按数值元组倒序，首项可用于划分独立编号体系。 */ order: number[];
  /** 排序字段的实际语义。 */ basis: 'source-priority' | 'related-character' | 'configuration' | 'definition';
  /** 分类专属的多值条件，值为可读名称。 */ facets: Record<string, string[]>;
}
/** 规范化资料条目，不执行上游文本。 @author chenjd @created 2026-11-06 13:30:00 */
export interface CatalogEntry {
  /** 稳定标识，格式为分类与源主键。 */ id: string;
  /** 资料分类。 */ category: Category;
  /** 展示名称。 */ name: string;
  /** 简短副标题。 */ subtitle: string;
  /** 纯文本摘要。 */ description: string;
  /** 搜索别名。 */ aliases: string[];
  /** 分类标签。 */ tags: string[];
  /** 元素名称，可为空。 */ element: string;
  /** 职业名称，可为空。 */ profession: string;
  /** 品级或星级，可为空。 */ rarity: string;
  /** 可直接展示的图片地址；游戏资源路径放入属性。 */ image: string;
  /** 有序属性，值均为可读文本。 */ attributes: Record<string, string>;
  /** 技能、套装等正文。 */ sections: EntrySection[];
  /** 其他资料条目的稳定标识。 */ relatedIds: string[];
  /** 上游主键。 */ sourceKey: string;
  /** 来源排序与筛选；手动新增资料可以不提供。 */ catalog?: CatalogMetadata;
  /** 攻略可选择的源培养阶段、装备槽位及技能关系。 */ guideOptions?: GuideEntryOptions;
}
/** 资料在本地的状态。 @author chenjd @created 2026-11-06 13:30:00 */
export interface EntryView extends CatalogEntry {
  /** 本地维护或源资料。 */ origin: 'source' | 'local';
  /** 是否覆盖了源字段。 */ modified: boolean;
  /** 是否已移至回收站。 */ hidden: boolean;
  /** 是否已从当前上游移除。 */ retired: boolean;
  /** 最后编辑时间。 */ updatedAt: string;
}
/** 一个经过校验的资料快照。 @author chenjd @created 2026-11-06 13:30:00 */
export interface CatalogSnapshot {
  /** 文件格式版本。 */ schemaVersion: 1;
  /** 适配器标识。 */ provider: 'myssal';
  /** 游戏区域。 */ region: 'cn';
  /** 固定 Git 提交。 */ revision: string;
  /** 上游版本说明。 */ version: string;
  /** 资料构建时间。 */ builtAt: string;
  /** 原始文件 SHA-256 清单。 */ fingerprints: Record<string, string>;
  /** 条目列表。 */ entries: CatalogEntry[];
  /** 非阻断性数据提示。 */ warnings: string[];
  /** 本次图片使用的独立固定版本。 */ imageSource?: ImageSourceInfo;
}
/** 远程图片仓库的版本信息。 @author chenjd @created 2026-11-06 20:30:00 */
export interface ImageSourceInfo {
  /** 图片仓库标识。 */ repository: 'undertheobservers/PGR_Assets';
  /** 固定提交，不随分支移动。 */ revision: string;
  /** 图片更新说明。 */ version: string;
  /** 提交时间。 */ updatedAt: string;
}
/** 数据源配置。 @author chenjd @created 2026-11-06 13:30:00 */
export interface SourceProfile {
  /** 配置标识。 */ id: string;
  /** 来源名称。 */ name: string;
  /** 适配器标识。 */ provider: 'myssal';
  /** 仅从远程仓库获取。 */ transport: 'github';
}
/** 应用偏好。 @author chenjd @created 2026-11-06 13:30:00 */
export interface AppSettings {
  /** 主题设置。 */ theme: 'light' | 'dark' | 'system';
  /** 系统字体家族名称，空字符串使用系统默认字体。 */ fontFamily: string;
  /** 列表展示方式。 */ viewMode: 'grid' | 'list';
  /** 启动时检查更新；有变化时供用户预览确认。 */ checkOnStartup: boolean;
  /** 当前准备使用的数据源配置。 */ activeSourceId: string;
  /** 可切换的数据源列表。 */ sources: SourceProfile[];
}
/** 本机可用字体家族。 @author chenjd @created 2026-11-06 13:50:00 */
export interface SystemFontFamily {
  /** 用于 CSS 的系统家族名称。 */ family: string;
  /** 优先中文的可读名称，必要时附带英文名称。 */ label: string;
}
/** 已启用版本摘要。 @author chenjd @created 2026-11-06 13:30:00 */
export interface VersionInfo {
  /** 版本数据库标识。 */ id: number;
  /** 来源名称。 */ sourceName: string;
  /** 提交摘要。 */ revision: string;
  /** 版本说明。 */ version: string;
  /** 导入时间。 */ importedAt: string;
  /** 条目数量。 */ count: number;
  /** 此资料版本关联的图片版本。 */ imageSource?: ImageSourceInfo;
}
/** 同步候选差异。 @author chenjd @created 2026-11-06 13:30:00 */
export interface SyncPreview {
  /** 当前候选标识。 */ token: string;
  /** 来源名称。 */ sourceName: string;
  /** 上游提交。 */ revision: string;
  /** 上游版本。 */ version: string;
  /** 新增条目数量。 */ added: number;
  /** 修改条目数量。 */ changed: number;
  /** 移除条目数量。 */ removed: number;
  /** 总条目数量。 */ total: number;
  /** 变化示例。 */ examples: { kind: 'added' | 'changed' | 'removed'; name: string }[];
  /** 非阻断性提示。 */ warnings: string[];
  /** 候选图片版本。 */ imageSource?: ImageSourceInfo;
}
/** 同步过程状态。 @author chenjd @created 2026-11-06 13:30:00 */
export interface SyncProgress {
  /** 是否正在运行。 */ busy: boolean;
  /** 当前提示。 */ message: string;
  /** 已完成文件数。 */ completed: number;
  /** 总文件数。 */ total: number;
}
/** 应用启动数据。 @author chenjd @created 2026-11-06 13:30:00 */
export interface AppState {
  /** 本地机体及通用预设。 */ presets: PresetRecord[];
  /** 应用版本。 */ appVersion: string;
  /** 本地数据目录。 */ dataDirectory: string;
  /** 用户偏好。 */ settings: AppSettings;
  /** 当前资料。 */ entries: EntryView[];
  /** 本地副本攻略，包含可恢复的回收站记录。 */ guides: GuideRecord[];
  /** 当前有效版本。 */ currentVersion: VersionInfo | null;
  /** 可回退版本。 */ versions: VersionInfo[];
}
/** 受限的桌面桥接接口。 @author chenjd @created 2026-11-06 13:30:00 */
export interface DesktopApi {
  /** 保存预设。 */ savePreset: (preset: PresetDocument, revision: number | null) => Promise<PresetRecord>;
  /** 删除或恢复预设。 */ setPresetHidden: (id: string, hidden: boolean, revision: number) => Promise<PresetRecord>;
  /** 保存攻略；已有记录必须传入读取时的修订号。 */ saveGuide: (guide: GuideDocument, revision: number | null) => Promise<GuideRecord>;
  /** 将攻略移至回收站或恢复。 */ setGuideHidden: (id: string, hidden: boolean, revision: number) => Promise<GuideRecord>;
  /** 按需读取受限图片源，返回已缓存的 PNG 数据或空值。 */ resolveAssetImage: (url: string) => Promise<string | null>;
  /** 获取本地状态。 */ getState: () => Promise<AppState>;
  /** 保存设置。 */ saveSettings: (settings: AppSettings) => Promise<AppState>;
  /** 异步列出本机已安装的字体家族。 */ listSystemFonts: () => Promise<SystemFontFamily[]>;
  /** 保存新增或编辑的条目。 */ saveEntry: (entry: CatalogEntry) => Promise<EntryView>;
  /** 将条目移至回收站。 */ deleteEntry: (id: string) => Promise<void>;
  /** 恢复条目。 */ restoreEntry: (id: string) => Promise<void>;
  /** 清除本地覆盖并恢复源资料。 */ resetEntry: (id: string) => Promise<void>;
  /** 拉取并校验候选版本。 */ prepareSync: (sourceId: string) => Promise<SyncPreview>;
  /** 应用已预览候选。 */ applySync: (token: string) => Promise<AppState>;
  /** 取消当前同步。 */ cancelSync: () => Promise<void>;
  /** 查询进度。 */ getSyncProgress: () => Promise<SyncProgress>;
  /** 回退基础资料版本，不覆盖本地编辑。 */ rollback: (versionId: number) => Promise<AppState>;
  /** 选择本地图片并返回可移植图片数据。 */ chooseImage: () => Promise<string | null>;
  /** 导出完整应用备份。 */ exportBackup: () => Promise<string | null>;
  /** 从备份恢复；恢复前自动保存当前备份。 */ importBackup: () => Promise<AppState | null>;
  /** 打开数据目录。 */ openDataDirectory: () => Promise<void>;
  /** 打开经过协议限制的网页。 */ openExternal: (url: string) => Promise<void>;
  /** 窗口控制。 */ windowAction: (action: 'minimize' | 'maximize' | 'close') => Promise<void>;
}
