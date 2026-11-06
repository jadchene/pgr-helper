import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import type { SystemFontFamily } from "../shared/types";

const runFile = promisify(execFile);
const maximumNameLength = 200;
let pendingEnumeration: Promise<SystemFontFamily[]> | null = null;

// 固定脚本不接收界面输入，编码传递避免路径和字体名称进入命令文本。
const windowsFontScript = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Drawing
$fontCollection = [System.Drawing.Text.InstalledFontCollection]::new()
try {
  $fontRows = @(foreach ($font in $fontCollection.Families) {
    $family = $font.Name
    $label = $font.Name
    try { $family = $font.GetName(1033) } catch {}
    try { $label = $font.GetName(2052) } catch {}
    [PSCustomObject]@{ family = $family; label = $label }
  })
  ConvertTo-Json -InputObject $fontRows -Compress
} finally {
  $fontCollection.Dispose()
}
`;

/** 清理系统枚举结果，忽略空值、纵向别名、控制字符和重复家族。 */
export const normalizeFontFamilies = (input: unknown): SystemFontFamily[] => {
  if (!Array.isArray(input)) throw new Error("系统字体列表格式无效");
  const families = new Map<string, SystemFontFamily>();
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as { family?: unknown; label?: unknown };
    if (typeof row.family !== "string") continue;
    const family = row.family.trim();
    if (
      !family ||
      family.startsWith("@") ||
      family.length > maximumNameLength ||
      /[\u0000-\u001f\u007f]/.test(family)
    )
      continue;
    const key = family.toLocaleLowerCase("en-US");
    if (families.has(key)) continue;
    const localized = typeof row.label === "string" ? row.label.trim() : "";
    const validLabel =
      localized &&
      !localized.startsWith("@") &&
      localized.length <= maximumNameLength &&
      !/[\u0000-\u001f\u007f]/.test(localized);
    const label =
      validLabel && localized.toLocaleLowerCase("en-US") !== key
        ? `${localized} (${family})`
        : family;
    families.set(key, { family, label });
  }
  return [...families.values()].sort((left, right) =>
    left.label.localeCompare(right.label, "zh-CN", { numeric: true }),
  );
};

/** 在后台读取 Windows 实际字体列表，同一次并发请求复用任务，失败后可重试。 */
export const listSystemFonts = async (): Promise<SystemFontFamily[]> => {
  if (process.platform !== "win32")
    throw new Error("当前平台暂不支持枚举系统字体，请使用系统默认字体。");
  if (!pendingEnumeration) {
    pendingEnumeration = (async () => {
      const executable = join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      );
      try {
        const { stdout } = await runFile(
          executable,
          [
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-EncodedCommand",
            Buffer.from(windowsFontScript, "utf16le").toString("base64"),
          ],
          {
            windowsHide: true,
            timeout: 15_000,
            maxBuffer: 2 * 1024 * 1024,
            encoding: "utf8",
          },
        );
        const fonts = normalizeFontFamilies(
          JSON.parse(stdout.replace(/^\uFEFF/, "").trim()),
        );
        if (!fonts.length) throw new Error("系统没有返回可用的字体家族");
        return fonts;
      } catch (error) {
        const timeout =
          error instanceof Error && "killed" in error && error.killed;
        throw new Error(
          timeout
            ? "读取系统字体超时，请重试。"
            : "无法读取系统字体，请重试；也可以继续使用系统默认字体。",
        );
      }
    })().finally(() => {
      pendingEnumeration = null;
    });
  }
  return pendingEnumeration;
};
