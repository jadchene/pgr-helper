/** 默认采用设备界面字体，并为中文和缺失字形保留后备字体。 */
export const defaultFontFamily =
  'system-ui, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", sans-serif';

/** 把单个家族名作为 CSS 字符串引用，避免名称中的标点改变样式结构。 */
export const fontFamilyCss = (family: string): string => {
  const name = family.trim();
  if (!name || /[\u0000-\u001f\u007f]/.test(name)) return defaultFontFamily;
  const escaped = name.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}", ${defaultFontFamily}`;
};
