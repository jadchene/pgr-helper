/** 只接受固定提交下的游戏图片，拒绝 URL 归一化前可能隐藏的目录跳转。 */
export const isTrustedAssetImageUrl = (value: string): boolean => {
  const match = /^https:\/\/raw\.githubusercontent\.com\/undertheobservers\/PGR_Assets\/[a-f0-9]{40}\/assets\/product\/texture\/(?:image|atlas|spriteatlas)\/([A-Za-z0-9_./-]+\.png)$/.exec(value);
  return !!match && match[1].split('/').every(part => part !== '' && part !== '.' && part !== '..');
};
