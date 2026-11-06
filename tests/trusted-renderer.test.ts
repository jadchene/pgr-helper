import { describe, expect, it } from 'vitest';
import { isTrustedRendererUrl } from '../src/main/trusted-renderer';

describe('桌面 IPC 界面地址边界', () => {
  const development = 'http://127.0.0.1:5178';
  const packaged = 'file:///E:/Personal/pgr-helper/dist/renderer/index.html';

  it.each([development, `${development}/`, `${development}/?tab=settings#sources`])('允许实际开发主页及其路由参数：%s', (actual) => {
    expect(isTrustedRendererUrl(actual, development)).toBe(true);
  });

  it.each([
    'http://127.0.0.1:51780/', 'http://127.0.0.1:5178@evil.test/',
    'http://user:password@127.0.0.1:5178/', 'http://localhost:5178/',
    'https://127.0.0.1:5178/', 'http://127.0.0.1:5178/other',
    'about:blank', 'data:text/html,test', 'not a URL',
  ])('拒绝相似端口、身份伪装、其他来源和路径：%s', (actual) => {
    expect(isTrustedRendererUrl(actual, development)).toBe(false);
  });

  it('安装页面只允许相同文件及路由参数，拒绝文件名前缀伪装和网络共享', () => {
    expect(isTrustedRendererUrl(packaged, packaged)).toBe(true);
    expect(isTrustedRendererUrl(`${packaged}?tab=catalog#detail`, packaged)).toBe(true);
    expect(isTrustedRendererUrl(`${packaged}.evil`, packaged)).toBe(false);
    expect(isTrustedRendererUrl(packaged.replace('file:///', 'file://evil.test/'), packaged)).toBe(false);
    expect(isTrustedRendererUrl(packaged.replace('/index.html', '/other.html'), packaged)).toBe(false);
  });
});
