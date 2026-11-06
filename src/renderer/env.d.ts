import type { DesktopApi } from "../shared/types";

declare global {
  /** 桌面窗口只通过受限桥接访问本地资料。 @author chenjd @created 2026-11-06 13:30:00 */
  interface Window {
    desktop: DesktopApi;
  }
}
export {};
