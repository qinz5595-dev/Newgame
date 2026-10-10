/**
 * 卡牌数据（装备卡 + 技能卡）
 *
 * 以后要加新卡，只需要在 CARDS 里多加一条数据。
 * 数值字段都是"可选"的，效果处理在阶段 4 的 core/effects.js 里按字段读取。
 *
 * 字段说明：
 *   id          唯一标识
 *   name        卡牌名称
 *   type        卡牌类型，见下面的 CARD_TYPE
 *   slot        装备卡专用：装备位置（weapon / armor / accessory），同位置的新装备会替换旧的
 *   description 效果描述（显示在卡面上）
 *   attack      装备后的攻击力加成
 *   defense     装备后的防御力加成
 *   damage      技能卡：对敌方造成的伤害
 *   heal        技能卡：为自身恢复的生命值
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

export const CARDS = [
  // ---------- 装备卡 ----------
  {
    id: 'iron-sword',
    name: '铁剑',
    type: CARD_TYPE.EQUIPMENT,
    slot: 'weapon',
    attack: 2,
    description: '装备后攻击力 +2。',
  },
  {
    id: 'great-axe',
    name: '巨斧',
    type: CARD_TYPE.EQUIPMENT,
    slot: 'weapon',
    attack: 4,
    description: '装备后攻击力 +4，防御力 -1（防御力最低为 0）。',
    defense: -1,
  },
  {
    id: 'leather-armor',
    name: '皮甲',
    type: CARD_TYPE.EQUIPMENT,
    slot: 'armor',
    defense: 2,
    description: '装备后防御力 +2。',
  },
  {
    id: 'guardian-plate',
    name: '守护铠甲',
    type: CARD_TYPE.EQUIPMENT,
    slot: 'armor',
    defense: 4,
    description: '装备后防御力 +4。',
  },
  {
    id: 'power-amulet',
    name: '力量护符',
    type: CARD_TYPE.EQUIPMENT,
    slot: 'accessory',
    attack: 1,
    defense: 1,
    description: '装备后攻击力 +1、防御力 +1。',
  },

  // ---------- 技能卡 ----------
  {
    id: 'fireball',
    name: '火球术',
    type: CARD_TYPE.SKILL,
    damage: 5,
    description: '对敌方造成 5 点伤害。',
  },
  {
    id: 'heal',
    name: '治疗术',
    type: CARD_TYPE.SKILL,
    heal: 6,
    description: '恢复自身 6 点生命值（不能超过最大生命值）。',
  },
  {
    id: 'heavy-strike',
    name: '重击',
    type: CARD_TYPE.SKILL,
    damage: 3,
    description: '对敌方造成 3 点伤害。',
  },
  {
    id: 'blessing',
    name: '战意祝福',
    type: CARD_TYPE.SKILL,
    attack: 2,
    description: '本场战斗攻击力永久 +2。',
  },
]

/** 按 id 取卡牌；找不到返回 null */
export function getCardById(id) {
  return CARDS.find((card) => card.id === id) || null
}
