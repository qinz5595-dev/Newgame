/**
 * 卡牌效果处理
 *
 * 卡片效果分两种来源：
 *   1. 数据驱动：卡牌数据里写了 attack / defense / damage / heal 字段，
 *      这里会自动按字段生效。想加一张普通卡，只要在 data/cards.js 里加一条数据。
 *   2. 特殊效果：普通字段表达不了的卡（例如"每回合结束抽一张牌"），
 *      在下面的 SPECIAL_EFFECTS 里按卡牌 id 注册一个函数即可。
 */
import { CARD_TYPE, SLOT_LABEL, getCardById } from '../data/cards.js'
import {
  SIDE,
  addLog,
  applyDamage,
  applyHeal,
  getAttack,
  getDefense,
  heroOf,
  opponentSide,
  recalculateEquipmentBonuses,
  setHint,
} from './state.js'

/**
 * 特殊效果注册表（暂时为空）
 * 用法示例：
 *   export const SPECIAL_EFFECTS = {
 *     'my-special-card': ({ state, side, hero, card }) => { ... },
 *   }
 */
export const SPECIAL_EFFECTS = {}

/**
 * 现在能不能使用这张卡？
 * 不能用的原因会返回给界面，用于给出清楚的提示。
 */
export function canUseCard(state, side, cardInstance) {
  const card = getCardById(cardInstance.cardId)

  if (!card) {
    return { ok: false, reason: '这张卡牌不存在。' }
  }
  if (state.finished) {
    return { ok: false, reason: '战斗已经结束，不能再使用卡牌。' }
  }
  if (state.turn !== side) {
    return { ok: false, reason: side === SIDE.PLAYER ? '现在不是你的回合。' : '现在不是电脑的回合。' }
  }
  if (!state.hands[side].some((item) => item.instanceId === cardInstance.instanceId)) {
    return { ok: false, reason: '这张卡已经不在手牌里了。' }
  }

  const hero = heroOf(state, side)

  // 治疗类技能在满血时用了也没有意义，直接算"条件不满足"
  if (card.type === CARD_TYPE.SKILL && card.heal && hero.hp >= hero.maxHp) {
    return { ok: false, reason: `${hero.name} 的生命值已经满了，「${card.name}」现在用不上。` }
  }

  return { ok: true, reason: '' }
}

/**
 * 使用一张卡牌。
 * 成功时：装备卡进入装备栏并持续生效；技能卡立即生效并从手牌消失。
 * 失败时：不产生任何效果，只给出提示。
 */
export function useCard(state, side, cardInstance) {
  const check = canUseCard(state, side, cardInstance)
  if (!check.ok) {
    if (side === SIDE.PLAYER) {
      setHint(state, check.reason, 'warn')
      addLog(state, `无法使用这张卡：${check.reason}`, 'warn')
    }
    return { ok: false, reason: check.reason }
  }

  const card = getCardById(cardInstance.cardId)

  // 先把手牌里的这张卡移除（装备卡也一样：装上去就离开手牌）
  state.hands[side] = state.hands[side].filter((item) => item.instanceId !== cardInstance.instanceId)

  if (card.type === CARD_TYPE.EQUIPMENT) {
    return equipCard(state, side, card, cardInstance)
  }
  return castSkillCard(state, side, card)
}

/** 装备卡：写入装备栏（同位置替换），并重算装备加成 */
function equipCard(state, side, card, cardInstance) {
  const hero = heroOf(state, side)
  const slot = card.slot

  const previous = hero.equipment[slot]
  const previousCard = previous ? getCardById(previous.cardId) : null

  hero.equipment[slot] = { instanceId: cardInstance.instanceId, cardId: card.id }
  recalculateEquipmentBonuses(hero)

  const replaceText = previousCard ? `，替换下原来的「${previousCard.name}」` : ''
  addLog(
    state,
    `${hero.name} 装备了「${card.name}」（${SLOT_LABEL[slot] || slot}）${replaceText}。` +
      `当前攻击力 ${getAttack(hero)}、防御力 ${getDefense(hero)}。`,
    'equip',
  )

  if (side === SIDE.PLAYER) {
    setHint(state, `已装备「${card.name}」，攻击力 ${getAttack(hero)}、防御力 ${getDefense(hero)}（装备永久生效）。`, 'equip')
  }

  return { ok: true, kind: 'equipment', card }
}

/** 技能卡：立即生效，用完即消失 */
function castSkillCard(state, side, card) {
  const hero = heroOf(state, side)
  const enemySide = opponentSide(side)
  const enemy = heroOf(state, enemySide)
  const effects = []

  addLog(state, `${hero.name} 使用了技能卡「${card.name}」。`, 'skill')

  if (card.damage) {
    applyDamage(state, enemySide, card.damage, `「${card.name}」命中 ${enemy.name}`)
    effects.push(`对 ${enemy.name} 造成 ${card.damage} 点伤害`)
  }

  if (card.heal) {
    const healed = applyHeal(state, side, card.heal, `「${card.name}」生效`)
    effects.push(`恢复 ${healed} 点生命值`)
  }

  if (card.attack) {
    hero.skillAttackBonus += card.attack
    effects.push(`攻击力永久 +${card.attack}`)
    addLog(state, `${hero.name} 的攻击力永久 +${card.attack}，当前攻击力 ${getAttack(hero)}。`, 'skill')
  }

  if (card.defense) {
    hero.skillDefenseBonus += card.defense
    effects.push(`防御力永久 +${card.defense}`)
    addLog(state, `${hero.name} 的防御力永久 +${card.defense}，当前防御力 ${getDefense(hero)}。`, 'skill')
  }

  // 特殊效果（如果有登记）
  const special = SPECIAL_EFFECTS[card.id]
  if (special) {
    special({ state, side, hero, card })
    effects.push('触发了特殊效果')
  }

  if (side === SIDE.PLAYER && effects.length > 0) {
    setHint(state, `「${card.name}」：${effects.join('，')}。`, 'skill')
  }

  return { ok: true, kind: 'skill', card }
}
