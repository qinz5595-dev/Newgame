/**
 * 电脑对手的行动逻辑（简单版本，够用就好）
 *
 * 行动顺序：
 *   1. 生命值偏低时先用治疗卡
 *   2. 使用永久增益类技能卡
 *   3. 使用伤害类技能卡（伤害高的先用）
 *   4. 装备卡：空槽位直接装；已有装备时只换"更强"的
 *   5. 发动一次基础攻击
 *
 * 全部是固定步骤的循环，没有 while，所以不会出现卡住或死循环。
 * 电脑和玩家使用完全相同的 useCard / baseAttack，规则一致。
 */
import { CARD_TYPE, getCardById } from '../data/cards.js'
import { ENEMY_HEAL_THRESHOLD } from '../config.js'
import { SIDE, addLog, heroOf, setHint } from '../core/state.js'
import { useCard } from '../core/effects.js'
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

  // 1) 治疗：血量低于阈值时先回血
  if (enemy.hp <= enemy.maxHp * ENEMY_HEAL_THRESHOLD) {
    const healCard = hand.find((item) => (cardOf(item)?.heal || 0) > 0)
    if (healCard) {
      useCard(state, side, healCard)
    }
  }

  // 2) 永久增益类技能（攻击 / 防御永久提升）
  const buffCards = hand.filter((item) => {
    const card = cardOf(item)
    return card && card.type === CARD_TYPE.SKILL && (card.attack || card.defense) && !card.damage && !card.heal
  })
  for (const item of buffCards) {
    if (state.finished) break
    useCard(state, side, item)
  }

  // 3) 伤害类技能：伤害高的先用
  const damageCards = hand
    .filter((item) => (cardOf(item)?.damage || 0) > 0)
    .sort((a, b) => cardOf(b).damage - cardOf(a).damage)
  for (const item of damageCards) {
    if (state.finished) break
    useCard(state, side, item)
  }

  // 4) 装备：先看最强的，优先换更好的（避免同一回合先装弱再被替换，浪费卡牌）
  const equipmentCards = hand
    .filter((item) => cardOf(item)?.type === CARD_TYPE.EQUIPMENT)
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
