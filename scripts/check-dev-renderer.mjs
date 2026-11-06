import { _electron as electron } from '@playwright/test';
import { createServer } from 'vite';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

const project = resolve(import.meta.dirname, '..');
const output = resolve(process.env.PGR_DEV_CHECK_DIR || join(project, 'test-results/development'));
const runDirectory = join(output, 'run-' + Date.now());
const runtimeDirectory = process.env.PGR_DEV_CHECK_WORK_DIR ? join(resolve(process.env.PGR_DEV_CHECK_WORK_DIR), 'run-' + Date.now()) : runDirectory;
const devUrl = 'http://127.0.0.1:5178';
const report = { runAt: new Date().toISOString(), runDirectory, expectedEntries: 0, passed: false, cases: [] };
await mkdir(runDirectory, { recursive: true });

/** 有限等待可观察事件，不以固定延时判断页面成功。 */
const until = async (condition, message, timeout = 6000) => {
  const deadline = Date.now() + timeout;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
};

/** 顺序运行真实 Vite 与 Electron；每个场景都有独立缓存和本地数据库。 */
const runCase = async mode => {
  const directory = join(runDirectory, mode);
  const runtime = join(runtimeDirectory, mode);
  await mkdir(directory, { recursive: true });
  const injectedPath = mode === 'main-failure' ? '/main.ts' : mode === 'bootstrap-failure' ? '/bootstrap.ts' : null;
  const result = {
    name: mode, directory, runtime, faultInjection: !!injectedPath,
    purpose: injectedPath ? '人为令首次模块请求失败，验证恢复能力；不作为用户白屏根因证据' : '真实开发首启、同页刷新、Vite 重载与导航边界',
    passed: false, steps: [], console: [], pageErrors: [], requests: [], serverMessages: [], navigation: [], states: [],
  };
  report.cases.push(result);
  let server;
  let app;
  let page;
  let phase = 'startup';
  let releaseDocument;
  const documentReady = new Promise(resolve => { releaseDocument = resolve; });
  let injected = false;
  let socketConnected = false;

  /** 同时采集页面内容和真实桌面数据，不把进程存活视为界面可用。 */
  const state = async label => {
    const value = await page.evaluate(async () => ({
      url: location.href, body: document.body.innerText.slice(0, 2200),
      cards: document.querySelectorAll('.entry-card').length,
      mounted: !!document.querySelector('#app')?.childElementCount,
      desktop: typeof window.desktop,
      entries: window.desktop ? (await window.desktop.getState()).entries.length : null,
      currentVersion: window.desktop ? (await window.desktop.getState()).currentVersion : null,
    }));
    result.states.push({ label, ...value });
    return value;
  };
  /** 等待首次同步页面，校验空库和零自动资料请求。 */
  const ready = async label => {
    await page.getByRole('heading', { name: '首次同步基础资料', exact: true }).waitFor({ timeout: 20_000 });
    const current = await state(label);
    assert.equal(current.cards, 0);
    assert.equal(current.entries, 0);
    assert.equal(current.currentVersion, null);
    assert.deepEqual(await app.evaluate(() => globalThis.__pgrNetworkAudit.calls), []);
    assert.equal(current.desktop, 'object');
    assert.equal(new URL(current.url).origin, devUrl);
    assert.equal(await page.locator('#startup-status').count(), 0);
  };
  /** 各步骤独立留证，避免一个失败掩盖其他回归结果。 */
  const step = async (label, action) => {
    phase = label;
    try {
      await action();
      result.steps.push({ name: label, passed: true });
    } catch (error) {
      result.steps.push({ name: label, passed: false, error: String(error) });
      if (page) {
        await state(label + '-failure').catch(() => {});
        await page.screenshot({ path: join(directory, result.steps.length + '-failure.png') }).catch(() => {});
      }
    }
  };
  /** 必须观察到新文档事件，不能用仍在显示的旧卡片代替刷新成功。 */
  const reload = async (label, action) => {
    await Promise.all([page.waitForEvent('domcontentloaded', { timeout: 6000 }), action()]);
    await ready(label);
  };

  try {
    server = await createServer({
      configFile: join(project, 'vite.config.ts'), cacheDir: join(runtime, 'vite-cache'),
      plugins: [{
        name: 'development-regression-observer',
        configureServer(vite) {
          // HTML 可先建立窗口，应用入口在观察器就位后才放行。
          vite.middlewares.use((request, response, next) => {
            const pathname = new URL(request.url || '/', devUrl).pathname;
            const proceed = () => {
              if (pathname === injectedPath && !injected) {
                injected = true;
                response.statusCode = 504;
                response.statusMessage = 'Injected startup module failure';
                response.setHeader('Content-Type', 'text/javascript');
                response.end('// 回归测试：仅本次启动模块请求故意失败。');
                return;
              }
              next();
            };
            if (pathname === '/main.ts') void documentReady.then(proceed);
            else proceed();
          });
          vite.ws.on('vite:client:connect', () => { socketConnected = true; });
          const send = vite.ws.send.bind(vite.ws);
          vite.ws.send = (...args) => {
            if (typeof args[0] === 'object') result.serverMessages.push({ phase, ...args[0] });
            return send(...args);
          };
        },
      }],
    });
    await server.listen();
    const env = { ...process.env, PGR_DATA_DIR: join(runtime, 'data'), PGR_TEST_HIDDEN: '1', PGR_DEV_URL: devUrl, PGR_TEST_NETWORK_MODE: 'offline' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ args: ['-r', join(project, 'scripts/fixtures/network-audit.cjs'), project], cwd: project, env, timeout: 30_000 });
    app.process().stderr?.on('data', chunk => result.console.push({ phase, type: 'main-stderr', text: String(chunk) }));
    page = await app.firstWindow();
    page.setDefaultTimeout(6000);
    page.on('console', message => result.console.push({ phase, type: message.type(), text: message.text() }));
    page.on('pageerror', error => result.pageErrors.push({ phase, message: error.message }));
    page.on('requestfailed', request => result.requests.push({ phase, url: request.url(), failure: request.failure()?.errorText }));
    page.on('response', response => {
      if (response.status() >= 400) result.requests.push({ phase, url: response.url(), status: response.status() });
    });
    await app.evaluate(({ BrowserWindow }) => {
      globalThis.devNavigation = [];
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.on('will-navigate', (event, url) => globalThis.devNavigation.push({ event: 'will-navigate', url, prevented: event.defaultPrevented }));
      contents.on('will-redirect', (event, url) => globalThis.devNavigation.push({ event: 'will-redirect', url, prevented: event.defaultPrevented }));
      contents.on('did-fail-load', (_event, code, description, url) => globalThis.devNavigation.push({ event: 'did-fail-load', code, description, url }));
    });
    releaseDocument();

    if (mode === 'main-failure') {
      await step('initial-main-module-failure-visible', async () => {
        await until(() => injected && socketConnected, '未观察到注入失败和 Vite 连接');
        await page.waitForLoadState('domcontentloaded');
        assert.equal((await state('before-recovery')).cards, 0);
        await page.getByRole('status').getByText('正在打开战双助手', { exact: true }).waitFor();
      });
      await step('vite-reload-recovers-first-load', async () => {
        await reload('after-vite-recovery', async () => { server.ws.send({ type: 'full-reload', path: '*' }); });
      });
    } else if (mode === 'bootstrap-failure') {
      await step('bootstrap-failure-visible', async () => {
        await until(() => injected, '未观察到 bootstrap 注入失败');
        await page.getByRole('alert').getByRole('heading', { name: '界面加载失败', exact: true }).waitFor();
        await page.getByRole('button', { name: '重新加载', exact: true }).waitFor();
        assert.equal((await state('before-retry')).cards, 0);
        await page.screenshot({ path: join(directory, 'visible-error.png') });
      });
      await step('reload-button-recovers-bootstrap', async () => {
        await reload('after-retry-button', () => page.getByRole('button', { name: '重新加载', exact: true }).click());
      });
    } else {
      await step('cold-start-render', async () => { await ready('cold-start'); });
      await step('same-page-javascript-reload', async () => {
        await reload('after-javascript-reload', () => page.evaluate(() => { window.location.reload(); }));
      });
      await step('vite-full-reload', async () => {
        await until(() => socketConnected, 'Vite WebSocket 未连接');
        await reload('after-vite-full-reload', async () => { server.ws.send({ type: 'full-reload', path: '*' }); });
      });
      await step('untrusted-navigation-blocked', async () => {
        for (const destination of [devUrl + '/untrusted', 'http://127.0.0.1:51780/', 'http://127.0.0.1:5178@127.0.0.1:51780/']) {
          const before = await app.evaluate(() => globalThis.devNavigation.length);
          await page.evaluate(url => { location.href = url; }, destination);
          await until(async () => (await app.evaluate(() => globalThis.devNavigation.length)) > before, '未收到非主页导航事件');
          const navigation = await app.evaluate(() => globalThis.devNavigation.at(-1));
          assert.equal(navigation.prevented, true, JSON.stringify(navigation));
          assert.equal(page.url(), devUrl + '/');
          assert.equal(await page.evaluate(() => Array.from(document.querySelectorAll('h1')).some(node => node.textContent.trim() === '首次同步基础资料')), true);
        }
      });
    }
    await step('no-unexpected-render-errors', async () => {
      assert.deepEqual(result.pageErrors, []);
      const expectedFailure = request => injectedPath && new URL(request.url).pathname === injectedPath && request.status === 504;
      assert.equal(result.requests.filter(expectedFailure).length, injectedPath ? 1 : 0);
      assert.deepEqual(result.requests.filter(request => !expectedFailure(request) && (request.status >= 400 || (request.failure && request.failure !== 'net::ERR_ABORTED'))), []);
    });
  } catch (error) {
    result.error = String(error);
  } finally {
    releaseDocument();
    if (app) {
      result.navigation = await app.evaluate(() => globalThis.devNavigation || []).catch(() => []);
      result.sourceRequests = await app.evaluate(() => globalThis.__pgrNetworkAudit?.calls || []).catch(() => []);
    }
    if (page) {
      await state('final').catch(() => {});
      await page.screenshot({ path: join(directory, 'window.png') }).catch(() => {});
    }
    await app?.close().catch(error => { result.cleanupError = String(error); });
    await server?.close().catch(error => { result.cleanupError = String(error); });
    result.passed = !result.error && !result.cleanupError && result.steps.length > 0 && result.steps.every(step => step.passed);
    await writeFile(join(directory, 'report.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ name: mode, passed: result.passed, steps: result.steps, error: result.error }));
  }
};

try {
  await runCase('normal');
  await runCase('main-failure');
  await runCase('bootstrap-failure');
} catch (error) {
  report.error = String(error);
} finally {
  report.passed = !report.error && report.cases.length === 3 && report.cases.every(result => result.passed);
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ output, runDirectory, passed: report.passed }));
  if (!report.passed) process.exitCode = 1;
}
