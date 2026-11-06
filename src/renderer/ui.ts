import {
  UsersRound,
  Layers3,
  Swords,
  RadioTower,
  Bot,
  Map,
  CloudSun,
  BookOpen,
} from "lucide-vue-next";
import type { Component } from "vue";
import type { Category, CatalogEntry } from "../shared/types";

/** 分类外观与用途。 */
export const categoryMeta: Record<
  Category,
  { icon: Component; short: string; description: string }
> = {
  character: {
    icon: UsersRound,
    short: "机体",
    description: "查阅机体、技能与培养信息，维护你的常用名称。",
  },
  memory: {
    icon: Layers3,
    short: "意识",
    description: "查看意识套装、号位与套装效果。",
  },
  weapon: {
    icon: Swords,
    short: "武器",
    description: "查看武器效果、共鸣与适用机体。",
  },
  resonance: {
    icon: RadioTower,
    short: "共鸣",
    description: "查阅武器、意识技能与属性共鸣。",
  },
  pet: {
    icon: Bot,
    short: "辅助机",
    description: "查看辅助机的主动、被动技能与培养信息。",
  },
  stage: {
    icon: Map,
    short: "副本",
    description: "浏览战区、幻痛囚笼与关卡条件。",
  },
  weather: {
    icon: CloudSun,
    short: "天气",
    description: "查看天气、词缀与效果组合。",
  },
  dictionary: {
    icon: BookOpen,
    short: "字典",
    description: "查阅属性、职业、品级等基础分类。",
  },
};

/** 将未知异常转成可读提示，保留真实错误内容。 */
export const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        "",
      )
    : String(error);
/** 展示本地日期；未提供日期时不伪造时间。 */
export const displayDate = (value: string): string => {
  if (!value) return "未记录";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      }).format(date);
};
/** 创建独立空白条目，便于本地补录。 */
export const newEntry = (category: Category): CatalogEntry => ({
  id: `local:${crypto.randomUUID()}`,
  category,
  name: "",
  subtitle: "",
  description: "",
  aliases: [],
  tags: [],
  element: "",
  profession: "",
  rarity: "",
  image: "",
  attributes: {},
  sections: [],
  relatedIds: [],
  sourceKey: "",
});
/** 仅通过允许的网页协议打开外部资料。 */
export const isWebUrl = (value: string): boolean => /^https?:\/\//i.test(value);

/** 将已识别的正式版本提交标题转成易读名称，其他标题原样保留。 */
export const displayVersion = (value: string): string => {
  const live = value.match(/\[([\d.]+)\]\s*CN\s+LIVE/i);
  return live ? `国服 ${live[1]}` : value;
};
