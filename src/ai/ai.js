/**
 * 电脑对手的行动逻辑（简单版本，够用就好）
 *
 * 行动顺序：
 *   1. 生命值偏低时先用治疗卡（在"付得起"的卡里选治疗量最高的）
 *   2. 使用永久增益类技能卡
 *   3. 使用伤害类技能卡（伤害高的先用）
 *   4. 装备卡：空槽位直接装；已有装备时只换"更强"的
 *   5. 发动一次基础攻击（免费，不受费用影响）
 *
 * 全部是固定步骤的循环，没有 while，所以不会出现卡住或死循环。
 * 电脑和玩家使用完全相同的 useCard / baseAttack 与费用规则；
 * 这里唯一的费用相关处理是"过滤掉当前付不起的卡"，出牌优先级完全不变。
 */
import { CARD_TYPE, getCardById } from '../data/cards.js'
import { ENEMY_HEAL_THRESHOLD } from '../config.js'
import { SIDE, addLog, heroOf, setHint } from '../core/state.js'
import { canUseCard, useCard } from '../core/effects.js'
import { baseAttack } from '../core/turn.js'

/** 装备卡的"强度"，用来判断要不要换装备：攻击 + 防御越大越好 */
function equipmentScore(card) {
  return (card.attack || 0) + (card.defense || 0)
}

/** 电脑要不要把这件装备换上？ */
function isEquipmentUpgrade(hero, card) {
  const current = hero.equipment[card.slot]
  if (!current) return true // 槽位是空的，直接装
  const currentCard = getCardById(current.cardId)
  return equipmentScore(card) > equipmentScore(currentCard || {})
}

/** 电脑的一个完整回合（同步执行，执行完就轮到玩家） */
export function runEnemyTurn(state) {
  const side = SIDE.ENEMY
  const enemy = heroOf(state, side)

  if (state.finished || state.turn !== side) return state

  addLog(state, '电脑开始行动。', 'system')

  // 手上牌的"快照"。useCard 会真的把卡从手牌里拿走，所以后面用快照来遍历。
  const hand = [...state.hands[side]]
  const cardOf = (item) => getCardById(item.cardId)

  // 费用（规则 7）：只过滤掉"当前付不起"的卡，出牌优先级完全保持不变。
  // 直接复用玩家那套 canUseCard 门槛 → 双方共用同一份费用判断，不会出现两套规则。
  const affordable = (item) => canUseCard(state, side, item).ok

  // 1) 治疗：血量低于阈值时先回血。
  //    挑选顺序按"实际治疗量"从高到低（治疗术 6 > 神圣庇护 4 > 生命汲取 3）。
  //    原因：治疗分支一回合只用一张卡；如果先打出治疗量更低的多效果卡，
  //    剩下那张治疗量更高的卡本回合就没有后续环节会用到它（增益/伤害/装备都不会收它），
  //    回合结束时会被直接弃掉——这是可以避免的浪费。
  //    费用同理：只在"付得起"的治疗卡里挑，避免出现"有钱能治却不治"。
  //    这里只调整"先打哪一张"，不改动任何卡牌的数值、效果或战斗规则。
  if (enemy.hp <= enemy.maxHp * ENEMY_HEAL_THRESHOLD) {
    const healCard = hand
      .filter((item) => (cardOf(item)?.heal || 0) > 0)
      .filter(affordable)
      .sort((a, b) => (cardOf(b)?.heal || 0) - (cardOf(a)?.heal || 0))[0]
    if (healCard) {
      useCard(state, side, healCard)
    }
  }

  // 2) 永久增益类技能（攻击 / 防御永久提升）
  const buffCards = hand
    .filter((item) => {
      const card = cardOf(item)
      return card && card.type === CARD_TYPE.SKILL && (card.attack || card.defense) && !card.damage && !card.heal
    })
    .filter(affordable)
  for (const item of buffCards) {
    if (state.finished) break
    useCard(state, side, item)
  }

  // 3) 伤害类技能：伤害高的先用
  const damageCards = hand
    .filter((item) => (cardOf(item)?.damage || 0) > 0)
    .filter(affordable)
    .sort((a, b) => cardOf(b).damage - cardOf(a).damage)
  for (const item of damageCards) {
    if (state.finished) break
    useCard(state, side, item)
  }

  // 4) 装备：先看最强的，优先换更好的（避免同一回合先装弱再被替换，浪费卡牌）
  const equipmentCards = hand
    .filter((item) => cardOf(item)?.type === CARD_TYPE.EQUIPMENT)
    .filter(affordable)
    .sort((a, b) => equipmentScore(cardOf(b)) - equipmentScore(cardOf(a)))
  for (const item of equipmentCards) {
    if (state.finished) break
    const card = cardOf(item)
    if (isEquipmentUpgrade(enemy, card)) {
      useCard(state, side, item)
    }
  }

  // 5) 基础攻击
  if (!state.finished) {
    baseAttack(state, side)
  }

  if (!state.finished) {
    addLog(state, '电脑结束了行动。', 'system')
    setHint(state, '电脑行动结束，快要轮到你了。', 'warn')
  }

  return state
}
