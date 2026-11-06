/** 精确验证可信界面地址，允许路由参数，拒绝相似端口和用户信息伪装。 */
export const isTrustedRendererUrl = (actual: string, expected: string): boolean => {
  try {
    const candidate = new URL(actual);
    const target = new URL(expected);
    return !candidate.username && !candidate.password
      && candidate.protocol === target.protocol
      && candidate.hostname === target.hostname
      && candidate.port === target.port
      && candidate.pathname === target.pathname;
  } catch {
    return false;
  }
};
