/**
 * 卡组数据与合法性校验（纯数据，不含牌堆运行逻辑）
 *
 * 本文件只负责三件事：
 *   1. 定义卡组规则常量（张数、同名上限、电脑最低构成）
 *   2. 提供两套可验证的预设卡组（玩家 / 电脑）
 *   3. 提供卡组分析与校验函数，供测试与未来电脑随机生成卡组复用
 *
 * 【不包含】抽牌堆、手牌、废牌区、装备区、移除区的任何运行逻辑 —— 那些属于后续的牌堆系统。
 * 卡组里保存的是「卡牌定义 id」（字符串），不是卡牌实例；
 * 实例由 core/state.js 的 createCardInstance() 在开局时生成，天然保证实例 id 唯一。
 */
import { ALL_CARD_ROLES, CARD_ROLE, CARD_ROLE_LABEL, getCardById } from './cards.js'

/** 每套卡组的张数 */
export const DECK_SIZE = 20

/** 同一种卡在一套卡组里最多出现几张（按卡牌定义 id 判断，不按显示名称） */
export const MAX_COPIES_PER_CARD = 2

/**
 * 电脑卡组的最低构成要求（按战斗定位标签统计）
 * 一张卡可以同时计入多个定位，但在总张数里只算一次。
 */
export const ENEMY_MIN_ROLES = {
  [CARD_ROLE.ATTACK]: 6,
  [CARD_ROLE.DEFENSE]: 3,
  [CARD_ROLE.HEALING]: 2,
}

/* ================================================================== */
/* 预设卡组                                                            */
/* ================================================================== */

/**
 * 玩家预设卡组（20 张，覆盖全部 4 种定位，同名最多 2 张）
 * 构成思路：8 张装备 + 12 张技能，攻防治疗功能都不缺，方便验证各条规则。
 */
export const PRESET_PLAYER_DECK = [
  // 武器
  'iron-sword',
  'iron-sword',
  'great-axe',
  // 护甲
  'leather-armor',
  'guardian-plate',
  'spiked-shield',
  'spiked-shield',
  // 饰品
  'power-amulet',
  // 伤害技能
  'fireball',
  'fireball',
  'heavy-strike',
  'heavy-strike',
  // 吸血 / 治疗
  'life-drain',
  'life-drain',
  'heal',
  'heal',
  'holy-sanctuary',
  // 增益
  'blessing',
  'war-banner',
  'war-banner',
]

/**
 * 电脑预设卡组（20 张，满足最低构成：攻击 ≥6、防御 ≥3、治疗 ≥2）
 * 构成思路：偏进攻，但保留了足够的防御与治疗，避免出现"打不动也扛不住"的极端卡组。
 * 实际的"每场战斗随机生成合法卡组"留到牌堆系统阶段，
 * 届时可直接复用本文件的 analyzeDeck() / validateDeck()。
 */
export const PRESET_ENEMY_DECK = [
  // 武器
  'iron-sword',
  'iron-sword',
  'great-axe',
  // 护甲
  'spiked-shield',
  'spiked-shield',
  'guardian-plate',
  'guardian-plate',
  // 伤害技能
  'fireball',
  'fireball',
  'heavy-strike',
  'heavy-strike',
  // 吸血 / 治疗
  'life-drain',
  'life-drain',
  'heal',
  'heal',
  'holy-sanctuary',
  'holy-sanctuary',
  // 增益
  'war-banner',
  'blessing',
  'blessing',
]

/* ================================================================== */
/* 卡组分析                                                            */
/* ================================================================== */

/**
 * 统计一套卡组的基本信息。
 * 特点：一张卡在"总张数"里只算一次，但可以同时计入多个定位的计数。
 *
 * @param {string[]} cardIds 卡牌定义 id 列表
 * @returns {{ total:number, uniqueCards:number, unknownCards:number, maxCopies:number,
 *             copies:Record<string,number>, roleCounts:Record<string,number>, unknownIds:string[] }}
 */
export function analyzeDeck(cardIds) {
  const list = Array.isArray(cardIds) ? cardIds : []

  const copies = {}
  const unknownIds = []
  const roleCounts = {}
  for (const role of ALL_CARD_ROLES) roleCounts[role] = 0

  for (const id of list) {
    if (typeof id !== 'string') continue

    copies[id] = (copies[id] || 0) + 1

    const card = getCardById(id)
    if (!card) {
      if (!unknownIds.includes(id)) unknownIds.push(id)
      continue
    }

    for (const role of card.roles || []) {
      if (roleCounts[role] === undefined) roleCounts[role] = 0
      roleCounts[role] += 1
    }
  }

  const copyValues = Object.values(copies)

  return {
    total: list.length,
    uniqueCards: Object.keys(copies).length,
    unknownCards: unknownIds.length,
    unknownIds,
    maxCopies: copyValues.length > 0 ? Math.max(...copyValues) : 0,
    copies,
    roleCounts,
  }
}

/* ================================================================== */
/* 卡组校验                                                            */
/* ================================================================== */

/**
 * 校验一套卡组是否合法，并把所有问题一次性说清楚。
 *
 * @param {string[]} cardIds 卡牌定义 id 列表
 * @param {object} [options]
 * @param {number} [options.size]        要求的总张数（默认 DECK_SIZE）
 * @param {number} [options.maxCopies]   同名上限（默认 MAX_COPIES_PER_CARD）
 * @param {object} [options.minRoles]    定位最低构成，例如 ENEMY_MIN_ROLES；不传则不检查
 * @param {string} [options.label]       出错信息里的名称（例如「玩家卡组」）
 * @returns {{ ok:boolean, errors:string[], stats:object|null }}
 */
export function validateDeck(cardIds, options = {}) {
  const {
    size = DECK_SIZE,
    maxCopies = MAX_COPIES_PER_CARD,
    minRoles = null,
    label = '卡组',
  } = options

  if (!Array.isArray(cardIds)) {
    return { ok: false, errors: [`${label}必须是一个数组（当前类型：${typeof cardIds}）`], stats: null }
  }

  const errors = []

  // 1) 每一项都必须是"卡牌定义 id 字符串"，且 id 真实存在
  cardIds.forEach((id, index) => {
    if (typeof id !== 'string') {
      errors.push(`${label}第 ${index + 1} 项不是卡牌 id 字符串（当前类型：${typeof id}）`)
      return
    }
    if (!getCardById(id)) {
      errors.push(`${label}第 ${index + 1} 项引用了不存在的卡牌 id：「${id}」`)
    }
  })

  const stats = analyzeDeck(cardIds)

  // 2) 总张数
  if (cardIds.length !== size) {
    errors.push(`${label}必须恰好 ${size} 张，当前是 ${cardIds.length} 张`)
  }

  // 3) 同名卡上限（按定义 id 判断）
  for (const [id, count] of Object.entries(stats.copies)) {
    if (count > maxCopies) {
      const name = getCardById(id)?.name || id
      errors.push(`${label}中「${name}」出现 ${count} 张，超过同名最多 ${maxCopies} 张的上限`)
    }
  }

  // 4) 定位最低构成（一张卡可同时满足多个定位）
  if (minRoles) {
    for (const [role, min] of Object.entries(minRoles)) {
      const have = stats.roleCounts[role] || 0
      if (have < min) {
        errors.push(`${label}的「${CARD_ROLE_LABEL[role] || role}」定位卡牌只有 ${have} 张，少于要求的 ${min} 张`)
      }
    }
  }

  return { ok: errors.length === 0, errors, stats }
}
