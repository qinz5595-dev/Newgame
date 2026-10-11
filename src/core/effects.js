/**
 * 卡牌效果处理
 *
 * 卡片效果分两种来源：
 *   1. 数据驱动：卡牌数据里写了 attack / defense / damage / heal 字段，
 *      这里会自动按字段生效。想加一张普通卡，只要在 data/cards.js 里加一条数据。
 *   2. 特殊效果：普通字段表达不了的卡（例如"每回合结束抽一张牌"），
 *      在下面的 SPECIAL_EFFECTS 里按卡牌 id 注册一个函数即可。
 */
import { MAX_COST } from '../config.js'
import { CARD_TYPE, SLOT_LABEL, getCardById } from '../data/cards.js'
import { discardCard } from './deck.js'
import {
  SIDE,
  addLog,
  applyDamage,
  applyHeal,
  canAfford,
  getAttack,
  getCost,
  getDefense,
  heroOf,
  opponentSide,
  recalculateEquipmentBonuses,
  setHint,
  spendCost,
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

  // 费用（规则 5 / 6）：费用不足时整张卡不可用。
  // 这里只是"判断"，不做任何扣费；扣费统一放在 useCard 里，保证失败时不会扣费、不会产生效果。
  if (!canAfford(state, side, card)) {
    return {
      ok: false,
      reason: `费用不足：「${card.name}」需要 ${card.cost} 点，当前只有 ${getCost(state, side)} 点。`,
    }
  }

  // D1：只有"纯治疗卡"（治疗是它唯一的效果）在满血时才算用不上，继续禁止。
  // D2 / D3：像生命汲取（伤害 + 治疗）、神圣庇护（治疗 + 永久防御）这类卡，
  //          即使治疗部分会浪费，其余效果依然有效，所以必须允许使用。
  const hasNonHealEffect = Boolean(card.damage || card.attack || card.defense)
  if (card.type === CARD_TYPE.SKILL && card.heal && !hasNonHealEffect && hero.hp >= hero.maxHp) {
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

  // 费用（规则 6 / 7）：通过门槛之后才扣费，而且必须在任何效果生效之前完成。
  // 这样即使后续效果被 D4（致命后跳过剩余效果）或 D6（战斗结束后冻结状态）中断，
  // 也不会出现"用了牌没花钱"或者"只扣了一半"的情况。
  // 装上/替换装备也只在这里扣一次，替换路径不退款、也不会重复扣旧装备的费用。
  if (!spendCost(state, side, card.cost || 0)) {
    // 防御式分支：理论上不可达（canUseCard 已经检查过费用）
    return { ok: false, reason: '费用不足，无法支付这张卡。' }
  }
  addLog(state, `支付 ${card.cost || 0} 点费用，剩余 ${getCost(state, side)} / ${MAX_COST} 点。`, 'info')

  // 先把手牌里的这张卡移除（装备卡也一样：装上去就离开手牌）
  state.hands[side] = state.hands[side].filter((item) => item.instanceId !== cardInstance.instanceId)

  // 牌堆：成功使用的卡牌（技能与装备一样）进入本方弃牌堆。
  // 出牌的唯一入口就是这里，所以每张牌只会入库一次；装备替换不会再次入库。
  // 位置放在"扣费 + 离开手牌之后、效果结算之前"：即使效果随后被
  // D4（致命后跳过剩余效果）或 D6（战斗结束后冻结状态）中断，也只入库一次。
  discardCard(state, side, cardInstance)

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

  // D4：这一次伤害如果已经分出胜负，本卡剩余效果（治疗 / 永久增益 / 特殊效果）一律跳过。
  //     伤害未致命时照常继续结算，行为与改动前完全一致。
  if (!state.finished) {
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
  }

  if (side === SIDE.PLAYER && effects.length > 0) {
    setHint(state, `「${card.name}」：${effects.join('，')}。`, 'skill')
  }

  return { ok: true, kind: 'skill', card }
}
