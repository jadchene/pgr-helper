import type { CatalogEntry, Category } from '../../shared/types';

/** 来源表的一行；只作为数据读取，不执行表达式。 @author chenjd @created 2026-11-06 13:40:00 */
export type SourceRow = Record<string, unknown>;
/** 按 cn/bytes 下相对路径索引的表。 @author chenjd @created 2026-11-06 13:40:00 */
export type SourceTables = Record<string, SourceRow[]>;

/** 将游戏富文本转成可显示的纯文本。 */
export const plainText = (value: unknown): string => {
  if (value == null) return '';
  if (typeof value !== 'string' && typeof value !== 'number') throw new Error('来源文本字段类型发生变化');
  return String(value).replace(/<[^>]*>/g, '').replace(/\\+n/g, '\n').replace(/\\+r/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();
};

/** 读取必要表，缺失或空表时拒绝候选。 */
export const table = (tables: SourceTables, name: string): SourceRow[] => {
  const rows = tables[name];
  if (!Array.isArray(rows) || rows.length === 0) throw new Error(`缺少必要数据表：${name}`);
  return rows;
};

/** 读取数值字段，空值仅在明确提供默认值时允许。 */
export const numberField = (row: SourceRow, key: string, fallback?: number): number => {
  const value = row[key];
  if (value == null && fallback !== undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`数值字段无效：${key}`);
  return value;
};

/** myssal 容器必须是原生数组，格式变化时不猜测转换。 */
export const arrayField = (row: SourceRow, key: string): unknown[] => {
  const value = row[key];
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`数组字段格式变化：${key}`);
  return value;
};

/** 提取可选数值引用，跳过来源中的空槽，拒绝无效主键。 */
export const idList = (row: SourceRow, key: string): number[] => arrayField(row, key).flatMap(value => {
  if (value == null || value === '' || value === 0) return [];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`引用字段无效：${key}`);
  return [value];
});

/** 建立主键索引；空主键只用于显式允许的占位行。 */
export const rowIndex = (rows: SourceRow[], key = 'Id', allowEmpty = false): Map<number, SourceRow> => {
  const result = new Map<number, SourceRow>();
  for (const row of rows) {
    if (allowEmpty && row[key] == null) continue;
    const id = numberField(row, key);
    if (!Number.isSafeInteger(id) || id < 0 || result.has(id)) throw new Error(`来源主键重复或无效：${key}=${id}`);
    result.set(id, row);
  }
  return result;
};

/** 解析必要关联，禁止静默丢弃断链。 */
export const requireRow = (rows: Map<number, SourceRow>, id: number, context: string): SourceRow => {
  const result = rows.get(id);
  if (!result) throw new Error(`${context} 缺少关联记录：${id}`);
  return result;
};

/** 创建稳定、跨来源的目录条目。 */
export const entry = (category: Category, key: string | number, name: unknown): CatalogEntry => {
  const title = plainText(name);
  if (!title) throw new Error(`${category}:${key} 缺少名称`);
  return { id: `${category}:${key}`, category, sourceKey: String(key), name: title, subtitle: '', description: '', aliases: [], tags: [], element: '', profession: '', rarity: '', image: '', attributes: {}, sections: [], relatedIds: [] };
};

/** 按数值主键读取多个关联。 */
export const linked = (row: SourceRow, key: string, rows: Map<number, SourceRow>, context: string): SourceRow[] => idList(row, key).map(id => requireRow(rows, id, context));

/** 添加不重复的有效关系。 */
export const unique = <T>(values: T[]): T[] => [...new Set(values)];
