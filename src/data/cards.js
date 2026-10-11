/**
 * 卡牌数据（装备卡 + 技能卡）
 *
 * 以后要加新卡，只需要在 CARDS 里多加一条数据。
 * 数值字段都是"可选"的，效果处理在 core/effects.js 里按字段读取。
 * 当前引擎只支持下面这 4 种数值效果，新增卡牌请沿用它们，不要引入新效果系统：
 *   attack      提高攻击力（装备卡持续生效；技能卡为永久加成）
 *   defense     提高防御力（装备卡持续生效；技能卡为永久加成）
 *   damage      对敌方造成伤害
 *   heal        为自身恢复生命值
 *
 * 字段说明：
 *   id          唯一标识（稳定不变，卡组与存档都靠它识别）
 *   name        卡牌名称
 *   type        卡牌类型，见下面的 CARD_TYPE（怎么使用：装备 or 技能）
 *   cost        使用这张卡需要支付的费用（1~8；每回合发费与上限见 config.js）
 *   roles       战斗定位标签，见下面的 CARD_ROLE（承担什么职责）
 *   slot        装备卡专用：装备位置（weapon / armor / accessory），同位置的新装备会替换旧的
 *   description 效果描述（显示在卡面上）
 */
export const CARD_TYPE = {
  EQUIPMENT: 'equipment',
  SKILL: 'skill',
}

/** 卡牌类型的中文名，界面显示用 */
export const CARD_TYPE_LABEL = {
  [CARD_TYPE.EQUIPMENT]: '装备',
  [CARD_TYPE.SKILL]: '技能',
}

/** 装备位置的中文名 */
export const SLOT_LABEL = {
  weapon: '武器',
  armor: '护甲',
  accessory: '饰品',
}

/* ================================================================== */
/* 战斗定位标签                                                        */
/* ================================================================== */

/**
 * 【重要】roles 与 type 是两个不同概念，不要混用：
 *   type  = 这张卡"怎么用"   （装备 / 技能）
 *   roles = 这张卡"负责什么" （攻击 / 防御 / 治疗 / 功能）
 *
 * 标签必须与卡牌实际效果一致，判定规则由 expectedRoles() 给出：
 *   attack  ← attack > 0 或 damage > 0        （能提高攻击力，或能直接造成伤害）
 *   defense ← defense > 0                     （能提高防御力）
 *   healing ← heal > 0                        （能恢复生命值）
 *   utility ← attack > 0 且 defense > 0       （攻防兼备的灵活卡；当前引擎下"功能"只能由这种双属性增益体现）
 *
 * 一张卡可以有多个标签；卡组统计时一张卡只算一次张数，但可同时满足多个定位的最低要求。
 */
export const CARD_ROLE = {
  ATTACK: 'attack',
  DEFENSE: 'defense',
  HEALING: 'healing',
  UTILITY: 'utility',
}

/** 标签的中文名，界面或日志显示用 */
export const CARD_ROLE_LABEL = {
  [CARD_ROLE.ATTACK]: '攻击',
  [CARD_ROLE.DEFENSE]: '防御',
  [CARD_ROLE.HEALING]: '治疗',
  [CARD_ROLE.UTILITY]: '功能',
}

/** 全部合法标签（卡组校验与测试用） */
export const ALL_CARD_ROLES = [CARD_ROLE.ATTACK, CARD_ROLE.DEFENSE, CARD_ROLE.HEALING, CARD_ROLE.UTILITY]

/**
 * 按卡牌的实际效果，推导出它"应该"带有哪些定位标签。
 * 这个函数是标签的判定标准：测试会用它核对每张卡的 roles 有没有乱标。
 */
export function expectedRoles(card) {
  const roles = []
  const attack = card.attack || 0
  const defense = card.defense || 0
  const damage = card.damage || 0
  const heal = card.heal || 0

  if (attack > 0 || damage > 0) roles.push(CARD_ROLE.ATTACK)
  if (defense > 0) roles.push(CARD_ROLE.DEFENSE)
  if (heal > 0) roles.push(CARD_ROLE.HEALING)
  if (attack > 0 && defense > 0) roles.push(CARD_ROLE.UTILITY)

  return roles
}

/* ================================================================== */
/* 卡牌列表（13 种）                                                   */
/* ================================================================== */

export const CARDS = [
  // ---------- 装备卡 ----------
  {
    id: 'iron-sword',
    cost: 1,
    name: '铁剑',
    type: CARD_TYPE.EQUIPMENT,
    roles: [CARD_ROLE.ATTACK],
    slot: 'weapon',
    attack: 2,
    description: '装备后攻击力 +2。',
  },
  {
    id: 'great-axe',
    cost: 3,
    name: '巨斧',
    type: CARD_TYPE.EQUIPMENT,
    roles: [CARD_ROLE.ATTACK],
    slot: 'weapon',
    attack: 4,
    description: '装备后攻击力 +4，防御力 -1（防御力最低为 0）。',
    defense: -1,
  },
  {
    id: 'leather-armor',
    cost: 1,
    name: '皮甲',
    type: CARD_TYPE.EQUIPMENT,
    roles: [CARD_ROLE.DEFENSE],
    slot: 'armor',
    defense: 2,
    description: '装备后防御力 +2。',
  },
  {
    id: 'guardian-plate',
    cost: 3,
    name: '守护铠甲',
    type: CARD_TYPE.EQUIPMENT,
    roles: [CARD_ROLE.DEFENSE],
    slot: 'armor',
    defense: 4,
    description: '装备后防御力 +4。',
  },
  {
    id: 'power-amulet',
    cost: 2,
    name: '力量护符',
    type: CARD_TYPE.EQUIPMENT,
    roles: [CARD_ROLE.ATTACK, CARD_ROLE.DEFENSE, CARD_ROLE.UTILITY],
    slot: 'accessory',
    attack: 1,
    defense: 1,
    description: '装备后攻击力 +1、防御力 +1。',
  },
  {
    id: 'spiked-shield',
    cost: 2,
    name: '尖刺盾甲',
    type: CARD_TYPE.EQUIPMENT,
    roles: [CARD_ROLE.ATTACK, CARD_ROLE.DEFENSE, CARD_ROLE.UTILITY],
    slot: 'armor',
    attack: 2,
    defense: 1,
    description: '装备后攻击力 +2、防御力 +1。',
  },

  // ---------- 技能卡 ----------
  {
    id: 'fireball',
    cost: 3,
    name: '火球术',
    type: CARD_TYPE.SKILL,
    roles: [CARD_ROLE.ATTACK],
    damage: 5,
    description: '对敌方造成 5 点伤害。',
  },
  {
    id: 'heavy-strike',
    cost: 1,
    name: '重击',
    type: CARD_TYPE.SKILL,
    roles: [CARD_ROLE.ATTACK],
    damage: 3,
    description: '对敌方造成 3 点伤害。',
  },
  {
    id: 'life-drain',
    cost: 2,
    name: '生命汲取',
    type: CARD_TYPE.SKILL,
    roles: [CARD_ROLE.ATTACK, CARD_ROLE.HEALING],
    damage: 3,
    heal: 3,
    description: '对敌方造成 3 点伤害，同时恢复自身 3 点生命值。',
  },
  {
    id: 'heal',
    cost: 2,
    name: '治疗术',
    type: CARD_TYPE.SKILL,
    roles: [CARD_ROLE.HEALING],
    heal: 6,
    description: '恢复自身 6 点生命值（不能超过最大生命值）。',
  },
  {
    id: 'holy-sanctuary',
    cost: 3,
    name: '神圣庇护',
    type: CARD_TYPE.SKILL,
    roles: [CARD_ROLE.DEFENSE, CARD_ROLE.HEALING],
    heal: 4,
    defense: 2,
    description: '恢复自身 4 点生命值，并永久获得防御力 +2。',
  },
  {
    id: 'blessing',
    cost: 2,
    name: '战意祝福',
    type: CARD_TYPE.SKILL,
    roles: [CARD_ROLE.ATTACK],
    attack: 2,
    description: '本场战斗攻击力永久 +2。',
  },
  {
    id: 'war-banner',
    cost: 3,
    name: '战旗',
    type: CARD_TYPE.SKILL,
    roles: [CARD_ROLE.ATTACK, CARD_ROLE.DEFENSE, CARD_ROLE.UTILITY],
    attack: 2,
    defense: 1,
    description: '本场战斗攻击力永久 +2、防御力永久 +1。',
  },
]

/** 按 id 取卡牌；找不到返回 null */
export function getCardById(id) {
  return CARDS.find((card) => card.id === id) || null
}
