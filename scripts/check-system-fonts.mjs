import { _electron as electron } from "@playwright/test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const project = resolve(import.meta.dirname, "..");
const evidence = resolve(
  process.env.PGR_EVIDENCE_DIR || join(project, "test-results/evidence"),
);
const data = resolve(
  process.env.PGR_FONT_DATA ||
    join(project, `test-results/system-fonts-${Date.now()}`),
);
await mkdir(evidence, { recursive: true });
await mkdir(data, { recursive: true });
const env = { ...process.env, PGR_DATA_DIR: data, PGR_TEST_HIDDEN: "1" };
delete env.ELECTRON_RUN_AS_NODE;
delete env.PGR_DEV_URL;
const result = {
  runAt: new Date().toISOString(),
  dataDirectory: data,
  passed: false,
  checks: [],
};
let app;
let page;
const runFile = promisify(execFile);

/** 有界等待本脚本启动的主进程退出，并清理监听器。 */
const waitForExit = (child, milliseconds) => {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve(true);
  return new Promise((complete) => {
    const finish = (value) => {
      clearTimeout(timer);
      child.removeListener("exit", onExit);
      complete(value);
    };
    const onExit = () => finish(true);
    const timer = setTimeout(() => finish(false), milliseconds);
    child.once("exit", onExit);
  });
};

/** 不受未保存表单阻挡地关闭测试实例，必要时只结束该实例的进程树。 */
const stopTestApp = async () => {
  if (!app) return;
  const child = app.process();
  void app
    .evaluate(({ app: application }) => application.exit(0))
    .catch(() => {});
  if (await waitForExit(child, 3000)) return;
  if (process.platform === "win32") {
    const taskkill = join(
      process.env.SystemRoot || "C:\\Windows",
      "System32",
      "taskkill.exe",
    );
    await runFile(taskkill, ["/PID", String(child.pid), "/T", "/F"], {
      windowsHide: true,
      timeout: 5000,
    }).catch((error) => {
      if (child.exitCode === null && child.signalCode === null) throw error;
    });
  } else {
    child.kill("SIGKILL");
  }
  if (!(await waitForExit(child, 3000)))
    throw new Error(`测试进程 ${child.pid} 未能退出`);
};

/** 启动独立隐藏实例，不依赖开发服务器或远程同步。 */
const launch = async () => {
  app = await electron.launch({
    args: [project],
    cwd: project,
    env,
    timeout: 30_000,
  });
  page = await app.firstWindow();
  await page.locator(".utility-nav").waitFor({ timeout: 30_000 });
};
/** 读取真实应用设置；等待写入完成后再检查字体样式。 */
const currentState = () => page.evaluate(() => window.desktop.getState());
/** 通过设置页的可搜索下拉框选择指定系统字体。 */
const selectFont = async (family, label) => {
  await page.locator(".font-select").click();
  await page.locator(".font-select input").fill(family);
  await page
    .locator(".n-base-select-option")
    .filter({ hasText: label })
    .first()
    .click();
  await page.waitForFunction(
    async (value) =>
      (await window.desktop.getState()).settings.fontFamily === value,
    family,
  );
};

try {
  await launch();
  const fonts = await page.evaluate(() => window.desktop.listSystemFonts());
  assert(fonts.length > 0);
  assert.equal(
    new Set(fonts.map((font) => font.family.toLocaleLowerCase("en-US"))).size,
    fonts.length,
  );
  assert(fonts.every((font) => font.family && !font.family.startsWith("@")));
  const chosen =
    fonts.find((font) => font.family === "Microsoft YaHei") ||
    fonts.find((font) => /[\u4e00-\u9fff]/.test(font.label)) ||
    fonts[0];
  result.fontCount = fonts.length;
  result.selectedFont = chosen;
  result.checks.push("真实 Windows 字体枚举、去重及纵向字体过滤");

  await page
    .locator(".utility-nav")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page
    .locator(".font-panel")
    .getByText(new RegExp(`已读取 ${fonts.length} 个系统字体`))
    .waitFor();
  await selectFont(chosen.family, chosen.label);
  await page.waitForFunction(
    (family) => getComputedStyle(document.body).fontFamily.includes(family),
    chosen.family,
  );
  assert(
    (
      await page
        .locator(".font-preview")
        .evaluate((element) => getComputedStyle(element).fontFamily)
    ).includes(chosen.family),
  );
  assert(
    (
      await page
        .getByRole("button", { name: "刷新字体", exact: true })
        .evaluate((element) => getComputedStyle(element).fontFamily)
    ).includes(chosen.family),
  );
  result.checks.push("搜索选择字体并应用到页面、当前预览及 Naive 按钮");
  await page.screenshot({
    path: join(evidence, "字体设置.png"),
    animations: "disabled",
  });
  await page.keyboard.press('Escape');
  await page.locator('.font-preview').scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(evidence, '字体预览.png'), animations: 'disabled' });

  await page
    .locator(".category-nav")
    .getByRole("button", { name: /^机体/ })
    .click();
  await page.getByRole("button", { name: "新增资料", exact: true }).click();
  const input = page.getByPlaceholder("例如：露西亚·深红囚影");
  assert(
    (
      await input.evaluate((element) => getComputedStyle(element).fontFamily)
    ).includes(chosen.family),
  );
  assert(
    (
      await page
        .locator(".editor-modal")
        .evaluate((element) => getComputedStyle(element).fontFamily)
    ).includes(chosen.family),
  );
  await page.getByRole("button", { name: "取消", exact: true }).click();
  result.checks.push("弹层和输入框继承已选字体");

  await page
    .locator(".utility-nav")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  const backup = join(data, `font-backup-${Date.now()}.json`);
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
  }, backup);
  await page.getByRole("button", { name: "导出备份", exact: true }).click();
  await page.getByText("备份已导出。", { exact: true }).waitFor();
  assert.equal(
    JSON.parse(await readFile(backup, "utf8")).settings.fontFamily,
    chosen.family,
  );
  await page.locator(".font-select").click();
  await page.locator(".font-select input").fill("系统默认");
  await page
    .locator(".n-base-select-option")
    .filter({ hasText: /^系统默认$/ })
    .click();
  await page.waitForFunction(
    async () => (await window.desktop.getState()).settings.fontFamily === "",
  );
  await app.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
  }, backup);
  await page.getByRole("button", { name: "从备份恢复", exact: true }).click();
  await page
    .locator(".n-dialog")
    .getByRole("button", { name: "选择备份文件", exact: true })
    .click();
  await page.getByText("备份已恢复。", { exact: true }).waitFor();
  assert.equal((await currentState()).settings.fontFamily, chosen.family);
  result.checks.push("恢复默认、备份导出与恢复保留字体设置");

  await app.close();
  app = null;
  await launch();
  assert.equal((await currentState()).settings.fontFamily, chosen.family);
  await page.waitForFunction(
    (family) => getComputedStyle(document.body).fontFamily.includes(family),
    chosen.family,
  );
  result.checks.push("重启后字体偏好与实际界面样式保留");

  // 只注入一次明确失败，重试仍执行原始受限 IPC 与实际 Windows 字体枚举。
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get("pgr:listSystemFonts");
    if (!original) throw new Error("字体 IPC 未注册");
    ipcMain.removeHandler("pgr:listSystemFonts");
    ipcMain.handle("pgr:listSystemFonts", () => {
      ipcMain.removeHandler("pgr:listSystemFonts");
      ipcMain.handle("pgr:listSystemFonts", original);
      throw new Error("验证用字体枚举失败");
    });
  });
  await page
    .locator(".utility-nav")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByText("字体列表读取失败", { exact: true }).waitFor();
  await page.getByRole("button", { name: "重新加载字体", exact: true }).click();
  await page
    .locator(".font-panel")
    .getByText(new RegExp(`已读取 ${fonts.length} 个系统字体`))
    .waitFor();
  assert.equal(
    await page.getByText("字体列表读取失败", { exact: true }).count(),
    0,
  );
  result.checks.push("枚举失败可重试，重试恢复真实字体列表");

  await page.evaluate(async () => {
    const state = await window.desktop.getState();
    await window.desktop.saveSettings({
      ...state.settings,
      fontFamily: "PGR Test Missing Font 2026",
    });
  });
  await page.reload();
  await page
    .locator(".utility-nav")
    .getByRole("button", { name: "设置", exact: true })
    .click();
  await page.getByText(/此设备未找到已保存的/).waitFor();
  await selectFont(chosen.family, chosen.label);
  result.checks.push("缺失字体显示后备提示，可重新选择本机字体");
  result.passed = true;
} catch (error) {
  result.failure = String(error);
  if (page)
    await page
      .screenshot({ path: join(evidence, "字体验证失败.png") })
      .catch(() => {});
  throw error;
} finally {
  try {
    await writeFile(
      join(evidence, "system-fonts.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    await stopTestApp();
  }
}
