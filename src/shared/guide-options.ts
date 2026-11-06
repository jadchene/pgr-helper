/** 机体实际进化阶段，与图鉴初始品级分开。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideEvolutionStage {
  /** 稳定的品级与阶段组合。 */ id: string;
  /** 来源品级简称及阶段，如 SSS3。 */ label: string;
  /** 来源品级值。 */ quality: number;
  /** 品级内阶段，零表示刚达到该品级。 */ phase: number;
  /** 此阶段新增效果对应的资料段落标识。 */ effectSectionIds: string[];
}

/** 辅助机品级对应可携带技能数。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuidePartnerQuality {
  /** 来源品级值。 */ quality: number;
  /** 来源品级简称。 */ label: string;
  /** 可携带的被动技能数。 */ passiveSlots: number;
}

/** 辅助机主动技能组及其属性版本。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideActiveSkillGroup {
  /** 与技能段落 familyId 一致。 */ id: string;
  /** 组内各属性技能段落标识，保持源顺序。 */ skillIds: string[];
}

/** 一个共鸣选项及源声明的适用机体。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideResonanceChoice {
  /** 基础资料共鸣标识。 */ resonanceId: string;
  /** 明确适用机体；空数组表示不限定机体的属性共鸣。 */ characterIds: string[];
}

/** 装备单件的共鸣槽位定义。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideResonanceSlot {
  /** 源数组中从一开始的槽号；意识一、二槽分别为上位、下位。 */ slot: number;
  /** 槽位允许的全部来源选项。 */ choices: GuideResonanceChoice[];
}

/** 武器谐振阶段，额外意识件数不能用等级推算。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideHarmonizationLevel {
  /** 来源阶段值。 */ level: number;
  /** 来源阶段显示名称。 */ label: string;
  /** 此阶段的完整新增效果。 */ description: string;
  /** 达到该阶段后绑定意识提供的套装计数。 */ bonusPieces: number;
  /** 可绑定的意识基础资料标识。 */ memoryIds: string[];
  /** 来源明确限定的觉醒机体；零限制时为空。 */ characterIds: string[];
}

/** 由源表生成的攻略配置选项，不按名称猜测关系。 @author chenjd @created 2026-11-06 16:30:00 */
export interface GuideEntryOptions {
  /** 机体可选择的全部进化阶段。 */ evolutionStages?: GuideEvolutionStage[];
  /** 机体或武器的装备类型，用于匹配可装备武器。 */ weaponType?: number;
  /** 泛用／独域等源类型，用于匹配意识。 */ characterType?: number;
  /** 当前机体明确声明的队伍效应基础资料标识。 */ effectIds?: string[];
  /** 意识套装实际存在的编号位。 */ memorySites?: number[];
  /** 意识来源星级。 */ memoryStar?: number;
  /** 意识套装效果支持的件数。 */ memorySetSizes?: number[];
  /** 当前装备各共鸣槽位的来源选项。 */ resonanceSlots?: GuideResonanceSlot[];
  /** 武器的实际谐振阶段。 */ harmonizationLevels?: GuideHarmonizationLevel[];
  /** 辅助机的实际可用品级及被动槽数。 */ partnerQualities?: GuidePartnerQuality[];
  /** 辅助机主动组，组内包含来源属性版本。 */ activeSkillGroups?: GuideActiveSkillGroup[];
  /** 辅助机可选被动技能段落标识。 */ passiveSkillIds?: string[];
  /** 辅助机可携主动技能数；来自客户端明确的规则。 */ activeSkillSlots?: number;
}
