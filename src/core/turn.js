/**
 * 回合流程：抽卡、弃牌、基础攻击、回合切换
 *
 * 一个回合的完整顺序（以玩家为例）：
 *   1. beginTurn(玩家)     → 抽 3 张卡，本回合基础攻击次数归零
 *   2. 玩家自由出牌（effects.js）、可以基础攻击 1 次（本文件的 baseAttack）
 *   3. endPlayerTurn()     → 弃掉没用完的手牌，轮到电脑，电脑抽 3 张
 *   4. ai.js 让电脑行动
 *   5. finishEnemyTurn()   → 弃掉电脑剩下的手牌，回合数 +1，轮回玩家
 *
 * 这里的函数都是"同步、立刻完成"的，方便测试，也不会有卡死或死循环的风险。
 */
import { CARDS } from '../data/cards.js'
import { CARDS_PER_TURN, MAX_BASE_ATTACKS_PER_TURN, MAX_COST, MIN_DAMAGE } from '../config.js'
import {
  SIDE,
  SIDE_LABEL,
  addLog,
  applyDamage,
  checkBattleEnd,
  createBattleState,
  createCardInstance,
  getAttack,
  getCost,
  getDefense,
  grantTurnCost,
  heroOf,
  opponentSide,
  setHint,
} from './state.js'

/**
 * 随机抽 count 张卡。
 * 做法：把整个卡牌池复制一份，每次随机取走一张。
 * 这样同一回合抽到的卡一定互不相同，长期下来各种卡都会出现。
 */
export function drawCards(count = CARDS_PER_TURN) {
  const pool = [...CARDS]
  const drawn = []

  while (drawn.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length)
    const [card] = pool.splice(index, 1)
    drawn.push(createCardInstance(card.id))
  }

  return drawn
}

/** 弃掉某一方手里没用完的牌 */
export function discardHand(state, side) {
  const count = state.hands[side].length
  state.hands[side] = []
  if (count > 0) {
    addLog(state, `${SIDE_LABEL[side]}弃掉了 ${count} 张没用上的卡牌。`, 'info')
  }
  return count
}

/** 开始某一方的回合：发放费用 + 抽牌 + 重置本回合的攻击次数 */
export function beginTurn(state, side) {
  if (state.finished) return

  state.turn = side
  state.baseAttacksThisTurn = 0
  // 费用：在"自己的回合开始"时发放，新费用 = min(当前 + 3, 上限 8)；
  // 剩余费用保留（不清零），战斗结束后不再发放（grantTurnCost 内部有 finished 守卫）
  grantTurnCost(state, side)
  state.hands[side] = drawCards(CARDS_PER_TURN)

  addLog(
    state,
    `【第 ${state.round} 回合】${SIDE_LABEL[side]}获得 ${CARDS_PER_TURN} 张卡牌、费用补至 ${getCost(state, side)} / ${MAX_COST}。`,
    'system',
  )
  if (side === SIDE.PLAYER) {
    setHint(
      state,
      `轮到你了：本回合获得 ${CARDS_PER_TURN} 张卡牌，当前费用 ${getCost(state, side)} / ${MAX_COST}，可以出牌并发动一次基础攻击。`,
      'info',
    )
  } else {
    setHint(state, '电脑对手正在行动…', 'warn')
  }
}

/** 开始一整场战斗：创建状态并让玩家先手抽牌 */
export function startBattle(playerHeroId, enemyHeroId) {
  const state = createBattleState(playerHeroId, enemyHeroId)
  beginTurn(state, SIDE.PLAYER)
  return state
}

/** 玩家点了"结束回合"：弃牌 → 轮到电脑 → 电脑抽牌（电脑的实际行动由 ai.js 负责） */
export function endPlayerTurn(state) {
  if (state.finished) return
  discardHand(state, SIDE.PLAYER)
  beginTurn(state, SIDE.ENEMY)
}

/** 电脑行动完毕：弃掉电脑剩下的手牌 → 回合数 +1 → 轮回玩家 */
export function finishEnemyTurn(state) {
  if (state.finished) return
  discardHand(state, SIDE.ENEMY)
  state.round += 1
  beginTurn(state, SIDE.PLAYER)
}

/** 现在能不能基础攻击？不能的话给出原因 */
export function canBaseAttack(state, side) {
  if (state.finished) {
    return { ok: false, reason: '战斗已经结束，不能再攻击。' }
  }
  if (state.turn !== side) {
    return { ok: false, reason: side === SIDE.PLAYER ? '现在不是你的回合。' : '现在不是电脑的回合。' }
  }
  if (state.baseAttacksThisTurn >= MAX_BASE_ATTACKS_PER_TURN) {
    return {
      ok: false,
      reason: side === SIDE.PLAYER ? '本回合已经进行过基础攻击了，结束回合后可以再次攻击。' : '电脑本回合已经攻击过了。',
    }
  }
  return { ok: true, reason: '' }
}

/**
 * 基础攻击。
 * 伤害 = 攻击方当前攻击力 − 防御方当前防御力，最低 MIN_DAMAGE 点。
 */
export function baseAttack(state, side) {
  const check = canBaseAttack(state, side)
  if (!check.ok) {
    if (side === SIDE.PLAYER) setHint(state, check.reason, 'warn')
    return { ok: false, reason: check.reason }
  }

  const attacker = heroOf(state, side)
  const defenderSide = opponentSide(side)
  const defender = heroOf(state, defenderSide)

  const attack = getAttack(attacker)
  const defense = getDefense(defender)
  const rawDamage = attack - defense
  const damage = Math.max(MIN_DAMAGE, rawDamage)

  state.baseAttacksThisTurn += 1

  let formula = `攻击力 ${attack} − 防御力 ${defense} = ${Math.max(rawDamage, 0)}`
  if (rawDamage < MIN_DAMAGE) {
    formula += `，但最低造成 ${MIN_DAMAGE} 点伤害`
  }
  addLog(state, `${SIDE_LABEL[side]}（${attacker.name}）发动基础攻击：${formula}。`, 'info')
  applyDamage(state, defenderSide, damage, `${attacker.name} 的基础攻击`)

  if (side === SIDE.PLAYER) {
    setHint(state, `你的基础攻击造成 ${damage} 点伤害（本回合已攻击过）。`, 'damage')
  }

  return { ok: true, damage }
}

/** 供外部（界面）使用：战斗是否已经结束 */
export function isBattleOver(state) {
  return Boolean(state.finished) || checkBattleEnd(state)
}
