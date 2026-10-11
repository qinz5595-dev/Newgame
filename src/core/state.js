/**
 * 战斗状态与数值计算
 *
 * 设计要点：
 *   1. 「角色模板」（data/heroes.js）与「本场战斗的主角实例」分开保存，
 *      战斗中的一切改动只发生在实例上，模板永远不变。
 *   2. 攻击力 / 防御力的加成分成两类分开存：
 *        装备加成（equipmentAttackBonus）—— 换装备时整体重算，不会越加越多
 *        技能加成（skillAttackBonus）    —— 永久加成，重算装备时不受影响
 *   3. 伤害、治疗、胜负判定都集中在这里，保证规则只有一处实现。
 *
 * 这个文件不碰页面，可以直接用 Node 运行测试。
 */
import { getHeroById, getRandomHero } from '../data/heroes.js'
import { getCardById } from '../data/cards.js'
import { BASE_COST_PER_TURN, CARDS_PER_TURN, MAX_COST, MIN_DAMAGE } from '../config.js'

/** 对战的双方 */
export const SIDE = {
  PLAYER: 'player',
  ENEMY: 'enemy',
}

/** 界面所处的阶段（哪个界面正在显示） */
export const SCREEN = {
  START: 'start',
  HERO_SELECT: 'heroSelect',
  BATTLE: 'battle',
}

export const SIDE_LABEL = {
  [SIDE.PLAYER]: '玩家',
  [SIDE.ENEMY]: '电脑对手',
}

/**
 * 终局类提示的种类（D5）
 * 战斗结束后只允许出现这类提示；其他卡牌效果提示与普通提示不得覆盖胜负结论。
 */
export const TERMINAL_HINT_KINDS = ['win', 'lose', 'draw']

// 给每个实例一个唯一编号（手牌、日志都要用）
let instanceCounter = 0
export function nextInstanceId(prefix) {
  instanceCounter += 1
  return `${prefix}-${instanceCounter}`
}

/**
 * 用角色模板生成一张"本场战斗使用"的主角实例。
 * 战斗中掉血、加成都记在这里，模板保持原样。
 */
export function createHeroInstance(templateId, side) {
  const template = getHeroById(templateId)
  if (!template) {
    throw new Error(`找不到主角模板：${templateId}`)
  }

  return {
    instanceId: nextInstanceId('hero'),
    side,

    // 来自模板的信息
    templateId: template.id,
    name: template.name,
    icon: template.icon,
    description: template.description,
    maxHp: template.maxHp,
    baseAttack: template.baseAttack,

    // 战斗中的当前状态
    hp: template.maxHp,
    equipmentAttackBonus: 0,
    equipmentDefenseBonus: 0,
    skillAttackBonus: 0,
    skillDefenseBonus: 0,

    // 装备栏：同位置装了新装备会替换掉旧的
    equipment: {
      weapon: null,
      armor: null,
      accessory: null,
    },
  }
}

/** 生成一张手牌实例（只记录"是哪张卡"，卡牌数据仍然共用同一份模板） */
export function createCardInstance(cardId) {
  return {
    instanceId: nextInstanceId('card'),
    cardId,
  }
}

/**
 * 重新计算某个主角身上的"装备加成"。
 * 每次都从零开始累加，所以换装备、重复装备都不会出现加成越叠越多的问题。
 */
export function recalculateEquipmentBonuses(hero) {
  let attack = 0
  let defense = 0

  for (const equipped of Object.values(hero.equipment)) {
    if (!equipped) continue
    const card = getCardById(equipped.cardId)
    if (!card) continue
    attack += card.attack || 0
    defense += card.defense || 0
  }

  hero.equipmentAttackBonus = attack
  hero.equipmentDefenseBonus = defense
  return hero
}

/** 当前攻击力 = 基础攻击力 + 装备加成 + 技能加成（最低 0） */
export function getAttack(hero) {
  return Math.max(0, hero.baseAttack + hero.equipmentAttackBonus + hero.skillAttackBonus)
}

/** 当前防御力 = 装备加成 + 技能加成（最低 0） */
export function getDefense(hero) {
  return Math.max(0, hero.equipmentDefenseBonus + hero.skillDefenseBonus)
}

/** 攻击力的来历，界面上显示用 */
export function getAttackParts(hero) {
  return {
    base: hero.baseAttack,
    equipment: hero.equipmentAttackBonus,
    skill: hero.skillAttackBonus,
  }
}

/** 防御力的来历 */
export function getDefenseParts(hero) {
  return {
    equipment: hero.equipmentDefenseBonus,
    skill: hero.skillDefenseBonus,
  }
}

/** 生命值百分比，界面画血条用（限制在 0~100） */
export function getHpPercent(hero) {
  if (hero.maxHp <= 0) return 0
  const percent = (hero.hp / hero.maxHp) * 100
  return Math.max(0, Math.min(100, percent))
}

/** 按阵营取主角实例 */
export function heroOf(state, side) {
  return side === SIDE.PLAYER ? state.player : state.enemy
}

/** 取对手阵营的标识 */
export function opponentSide(side) {
  return side === SIDE.PLAYER ? SIDE.ENEMY : SIDE.PLAYER
}

/* ------------------------------------------------------------------ */
/* 日志与提示                                                          */
/* ------------------------------------------------------------------ */

/**
 * 追加一条战斗信息
 * kind 可用：system / info / warn / damage / heal / equip / skill / win / lose
 */
export function addLog(state, text, kind = 'info') {
  state.log.push({
    id: nextInstanceId('log'),
    kind,
    text,
  })
  return state
}

/**
 * 设置界面顶部那条醒目提示（只显示最新一条）
 *
 * D5：胜负结论是最终结果，不能被之后结算的卡牌效果或普通提示覆盖。
 * 所以战斗已结束时，只接受终局类提示（win / lose / draw）。
 */
export function setHint(state, text, kind = 'info') {
  if (state.finished && !TERMINAL_HINT_KINDS.includes(kind)) {
    return state
  }
  state.hint = { text, kind }
  return state
}

/* ------------------------------------------------------------------ */
/* 费用（玩家与电脑各自独立，不可共享、不可互扣）                       */
/* ------------------------------------------------------------------ */

/** 取某一方当前的费用 */
export function getCost(state, side) {
  return state.costs?.[side] ?? 0
}

/** 当前费用是否足够支付这张卡（card 是卡牌定义，不是实例） */
export function canAfford(state, side, card) {
  return getCost(state, side) >= (card?.cost || 0)
}

/**
 * 回合开始时发放基础费用：新费用 = min(当前费用 + 3, 上限 8)
 * 规则要求：战斗已经结束后不再发放费用。
 * @returns {number} 发放后的费用
 */
export function grantTurnCost(state, side) {
  if (state.finished) return getCost(state, side)
  state.costs[side] = Math.min(getCost(state, side) + BASE_COST_PER_TURN, MAX_COST)
  return state.costs[side]
}

/**
 * 扣除费用：只有足额才扣，绝不出现负数余额。
 * @returns {boolean} 是否扣费成功（false = 费用不足，且未做任何改动）
 */
export function spendCost(state, side, amount) {
  const need = Math.max(0, Math.round(amount || 0))
  if (getCost(state, side) < need) return false
  state.costs[side] = getCost(state, side) - need
  return true
}

/* ------------------------------------------------------------------ */
/* 伤害、治疗、胜负                                                    */
/* ------------------------------------------------------------------ */

/**
 * 让某一方受到伤害。
 * 返回实际造成的伤害值。
 */
export function applyDamage(state, targetSide, amount, reason) {
  // D6：战斗已经结束时，伤害路径不再改变任何战斗状态（返回 0 表示没有造成伤害）
  if (state.finished) return 0

  const target = heroOf(state, targetSide)
  const damage = Math.max(0, Math.round(amount))
  target.hp = Math.max(0, target.hp - damage)

  const who = SIDE_LABEL[targetSide]
  const prefix = reason ? `${reason}，` : ''
  addLog(state, `${prefix}${who}（${target.name}）受到 ${damage} 点伤害，剩余生命 ${target.hp} / ${target.maxHp}。`, 'damage')
  checkBattleEnd(state)
  return damage
}

/**
 * 为某一方恢复生命值（不会超过最大生命值）。
 * 返回实际恢复的数值。
 */
export function applyHeal(state, side, amount, reason) {
  // D6：战斗已经结束时，治疗路径不再改变任何战斗状态（返回 0 表示没有恢复生命）
  if (state.finished) return 0

  const hero = heroOf(state, side)
  const before = hero.hp
  hero.hp = Math.min(hero.maxHp, hero.hp + Math.max(0, Math.round(amount)))
  const healed = hero.hp - before

  const who = SIDE_LABEL[side]
  const prefix = reason ? `${reason}，` : ''
  if (healed > 0) {
    addLog(state, `${prefix}${who}（${hero.name}）恢复 ${healed} 点生命，当前生命 ${hero.hp} / ${hero.maxHp}。`, 'heal')
  } else {
    addLog(state, `${prefix}${who}（${hero.name}）的生命值已经满了。`, 'info')
  }
  return healed
}

/**
 * 检查战斗是否结束（任意一方生命值降到 0 就立刻结束）。
 * 已经结束时不再重复处理。
 */
export function checkBattleEnd(state) {
  if (state.finished) return true

  const playerDead = state.player.hp <= 0
  const enemyDead = state.enemy.hp <= 0
  if (!playerDead && !enemyDead) return false

  state.finished = true

  if (playerDead && enemyDead) {
    state.winner = 'draw'
    addLog(state, '双方同时倒下，战斗以平局结束。', 'system')
    setHint(state, '平局！', 'draw')
  } else if (enemyDead) {
    state.winner = SIDE.PLAYER
    addLog(state, `电脑对手（${state.enemy.name}）被击败，战斗结束——你赢了！`, 'win')
    setHint(state, '胜利！敌方主角已被击败。', 'win')
  } else {
    state.winner = SIDE.ENEMY
    addLog(state, `你的主角（${state.player.name}）倒下了，战斗结束——你输了。`, 'lose')
    setHint(state, '失败…你的主角已倒下。', 'lose')
  }

  return true
}

/* ------------------------------------------------------------------ */
/* 创建战斗                                                            */
/* ------------------------------------------------------------------ */

/**
 * 创建一场战斗的状态（只准备数据，不抽卡）。
 * enemyHeroId 不传时随机分配一个电脑主角。
 * 真正的"开局抽牌"由 core/turn.js 的 startBattle() 负责。
 */
export function createBattleState(playerHeroId, enemyHeroId) {
  const enemyTemplate = enemyHeroId ? getHeroById(enemyHeroId) : getRandomHero()
  if (!enemyTemplate) {
    throw new Error(`找不到电脑主角模板：${enemyHeroId}`)
  }

  const state = {
    player: createHeroInstance(playerHeroId, SIDE.PLAYER),
    enemy: createHeroInstance(enemyTemplate.id, SIDE.ENEMY),

    turn: SIDE.PLAYER, // 现在轮到谁
    round: 1, // 第几个回合（双方各行动一次算一个回合）
    baseAttacksThisTurn: 0, // 本回合已经基础攻击过几次

    hands: {
      [SIDE.PLAYER]: [],
      [SIDE.ENEMY]: [],
    },

    // 费用：双方各自独立，开局都是 0（各自的回合开始时才发放）
    costs: {
      [SIDE.PLAYER]: 0,
      [SIDE.ENEMY]: 0,
    },

    finished: false,
    winner: null,

    hint: null,
    log: [],
  }

  addLog(state, `对战开始：${state.player.name}（玩家） 对阵 ${state.enemy.name}（电脑对手）。`, 'system')
  addLog(
    state,
    `规则：每回合开始抽 ${CARDS_PER_TURN} 张卡牌、获得 ${BASE_COST_PER_TURN} 点费用（上限 ${MAX_COST} 点，未用完会保留）；基础攻击伤害 = 攻击力 − 防御力，最低 ${MIN_DAMAGE} 点。`,
    'info',
  )

  return state
}
