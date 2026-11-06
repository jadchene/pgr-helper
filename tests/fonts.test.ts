import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSystemFonts, normalizeFontFamilies } from "../src/main/fonts";
import { CatalogStore } from "../src/main/store";
import { defaultFontFamily, fontFamilyCss } from "../src/renderer/font-family";

const directories: string[] = [];
const stores: CatalogStore[] = [];
/** 创建隔离的真实 SQLite 仓库，测试结束后只清理这些临时目录。 */
const createStore = (): CatalogStore => {
  const directory = mkdtempSync(join(tmpdir(), "pgr-font-test-"));
  directories.push(directory);
  const store = new CatalogStore(directory);
  stores.push(store);
  return store;
};
afterEach(() => {
  for (const store of stores.splice(0)) {
    try {
      store.close();
    } catch {
      /* 重启测试可能已经关闭连接。 */
    }
  }
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

describe("系统字体与设置", () => {
  it("清理重复、空名称、纵向名称和控制字符，保留可搜索的中文名称", () => {
    const rows = normalizeFontFamilies([
      { family: " Microsoft YaHei ", label: "微软雅黑" },
      { family: "microsoft yahei", label: "重复项" },
      { family: "Arial", label: "Arial" },
      { family: "@Microsoft YaHei", label: "@微软雅黑" },
      { family: "", label: "空项" },
      { family: "bad\nname", label: "控制字符" },
      { family: "No localized name", label: "@纵向" },
      null,
    ]);
    expect(rows).toHaveLength(3);
    expect(rows).toContainEqual({
      family: "Microsoft YaHei",
      label: "微软雅黑 (Microsoft YaHei)",
    });
    expect(rows).toContainEqual({
      family: "No localized name",
      label: "No localized name",
    });
    expect(() => normalizeFontFamilies({ family: "Arial" })).toThrow(
      /格式无效/,
    );
  });

  it("字体名称作为单个 CSS 字符串转义，默认和缺失字形使用安全后备", () => {
    expect(fontFamilyCss("")).toBe(defaultFontFamily);
    expect(fontFamilyCss("  微软雅黑  ")).toBe(
      `"微软雅黑", ${defaultFontFamily}`,
    );
    expect(fontFamilyCss('A"B\\C, serif')).toBe(
      `"A\\"B\\\\C, serif", ${defaultFontFamily}`,
    );
    expect(fontFamilyCss("bad\nname")).toBe(defaultFontFamily);
  });

  it("字体设置经过重启和真实备份恢复后保留，恢复默认也会持久化", () => {
    const original = createStore();
    expect(original.getSettings().fontFamily).toBe("");
    original.saveSettings({
      ...original.getSettings(),
      fontFamily: "Microsoft YaHei UI",
    });
    const directory = original.directory;
    original.close();
    const reopened = new CatalogStore(directory);
    stores.push(reopened);
    expect(reopened.getSettings().fontFamily).toBe("Microsoft YaHei UI");
    const backup = join(directory, "font-backup.json");
    reopened.exportBackup(backup);
    expect(JSON.parse(readFileSync(backup, "utf8")).settings.fontFamily).toBe(
      "Microsoft YaHei UI",
    );
    const restored = createStore();
    restored.importBackup(backup);
    expect(restored.getSettings().fontFamily).toBe("Microsoft YaHei UI");
    restored.saveSettings({ ...restored.getSettings(), fontFamily: "" });
    expect(restored.getSettings().fontFamily).toBe("");
    expect(() =>
      restored.saveSettings({
        ...restored.getSettings(),
        fontFamily: "bad\u0000font",
      }),
    ).toThrow();
    expect(restored.getSettings().fontFamily).toBe("");
  });

  it.skipIf(process.platform !== "win32")(
    "读取真实 Windows 字体，中文显示名有效且不包含纵向重复项",
    async () => {
      const fonts = await listSystemFonts();
      expect(fonts.length).toBeGreaterThan(0);
      expect(
        new Set(fonts.map((font) => font.family.toLocaleLowerCase("en-US")))
          .size,
      ).toBe(fonts.length);
      expect(
        fonts.every(
          (font) =>
            !!font.label &&
            !font.family.startsWith("@") &&
            !/[\u0000-\u001f\u007f]/.test(font.family),
        ),
      ).toBe(true);
      console.log(
        `实际 Windows 字体家族：${fonts.length}，样例：${fonts
          .slice(0, 4)
          .map((font) => font.label)
          .join("、")}`,
      );
    },
    20_000,
  );
});
