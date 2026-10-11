/**
 * 牌堆系统：抽牌堆 / 手牌 / 弃牌堆 之间的卡牌流动
 *
 * 设计要点：
 *   1. 本模块只管"卡牌在区域之间移动"，不参与费用、伤害、胜负等规则。
 *   2. 一张卡牌实例（{ instanceId, cardId }）在任何时刻最多属于一个区域：
 *        抽牌堆 draw / 手牌 hand / 弃牌堆 discard
 *      装备栏 hero.equipment[slot] 只是"引用"（另存一份 { instanceId, cardId }），
 *      不是第四个区域，因此不计入牌堆守恒数量。
 *   3. 依赖方向：本模块依赖 core/state.js（createCardInstance / addLog 等），
 *      而 state.js 不反向依赖本模块 —— 避免循环依赖。
 *      双方牌堆的初始化统一由 core/turn.js 的 startBattle() 调用。
 *   4. 卡组不合法时直接抛出错误（不允许静默使用错误数据开局）。
 */
import { ENEMY_MIN_ROLES, validateDeck } from '../data/decks.js'
import { SIDE, SIDE_LABEL, addLog, createCardInstance } from './state.js'

/**
 * 洗牌（Fisher-Yates）。
 * 返回一个新数组，不修改传入的数组。
 */
export function shuffle(list) {
  const result = [...list]
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = result[i]
    result[i] = result[j]
    result[j] = tmp
  }
  return result
}

/**
 * 取某一方的牌堆。
 * 结构不存在时按需补上空牌堆，方便测试与防御性调用。
 */
export function getPile(state, side) {
  if (!state.piles) state.piles = {}
  if (!state.piles[side]) state.piles[side] = { draw: [], discard: [] }
  return state.piles[side]
}

/**
 * 用一套卡组（卡牌定义 id 的数组）建出一个洗好的抽牌堆。
 * 卡组不合法时抛出明确错误 —— 报错信息里带卡组名称与具体原因，便于定位。
 *
 * @param {string[]} cardIds 卡牌定义 id 列表
 * @param {object} [options] 透传给 validateDeck 的选项（label / size / maxCopies / minRoles）
 * @returns {{ draw: object[], discard: object[] }}
 */
export function createPile(cardIds, options = {}) {
  const check = validateDeck(cardIds, options)
  if (!check.ok) {
    const label = options.label || '卡组'
    throw new Error(`${label}不合法，无法开始战斗：${check.errors.join('；')}`)
  }

  // 每个 id 都生成一个独立实例，保证实例 id 唯一、双方不会共用同一个对象
  return { draw: shuffle(cardIds).map((cardId) => createCardInstance(cardId)), discard: [] }
}

/**
 * 开局：把双方的卡组分别变成各自的抽牌堆，并各自独立洗牌。
 * 任何一方的卡组不合法都会抛错，从而阻止开局。
 */
export function initPiles(state, { playerDeck, enemyDeck }) {
  state.piles = {
    [SIDE.PLAYER]: createPile(playerDeck, { label: '玩家卡组' }),
    [SIDE.ENEMY]: createPile(enemyDeck, { label: '电脑卡组', minRoles: ENEMY_MIN_ROLES }),
  }
  return state.piles
}

/**
 * 抽牌。
 * 规则：
 *   - 抽牌堆还有牌时正常抽；
 *   - 抽牌堆空了但弃牌堆有牌 → 把弃牌堆洗成新的抽牌堆再继续抽
 *     （本次已经抽出来的牌不在弃牌堆里，所以不会被立刻重复抽到）；
 *   - 两个牌堆都空了 → 少抽（不报错、不改动其他战斗状态）。
 *
 * @returns {object[]} 实际抽到的卡牌实例（可能少于 count）
 */
export function drawFromPile(state, side, count) {
  const pile = getPile(state, side)
  const drawn = []

  for (let i = 0; i < count; i += 1) {
    if (pile.draw.length === 0) {
      if (pile.discard.length === 0) break

      const reshuffled = pile.discard.length
      pile.draw = shuffle(pile.discard)
      pile.discard = []
      addLog(state, `${SIDE_LABEL[side]}的弃牌堆洗回抽牌堆（${reshuffled} 张）。`, 'system')
    }

    drawn.push(pile.draw.pop())
  }

  if (drawn.length < count) {
    addLog(
      state,
      `${SIDE_LABEL[side]}的抽牌堆与弃牌堆都没有牌了，本次只能抽到 ${drawn.length} 张。`,
      'warn',
    )
  }

  return drawn
}

/**
 * 把一张卡牌实例放进弃牌堆。
 * 同一个实例已经在弃牌堆里时直接忽略 —— 从结构上避免重复入库。
 *
 * @returns {boolean} 是否真的放入了（false = 已经存在或参数为空）
 */
export function discardCard(state, side, instance) {
  if (!instance) return false

  const pile = getPile(state, side)
  if (pile.discard.some((item) => item.instanceId === instance.instanceId)) return false

  pile.discard.push(instance)
  return true
}

/**
 * 回合结束：把某一方手里没用完的牌全部转入弃牌堆。
 * @returns {number} 转移的张数
 */
export function discardHandToPile(state, side) {
  const hand = state.hands[side] || []
  const count = hand.length

  for (const instance of hand) {
    discardCard(state, side, instance)
  }
  state.hands[side] = []

  return count
}

/**
 * 某一方"抽牌堆 / 弃牌堆 / 手牌"的数量（界面显示与测试用）。
 */
export function getPileCounts(state, side) {
  const pile = getPile(state, side)
  return {
    draw: pile.draw.length,
    discard: pile.discard.length,
    hand: (state.hands[side] || []).length,
  }
}

/**
 * 某一方"位于区域内"的卡牌总数 = 抽牌堆 + 手牌 + 弃牌堆。
 * 装备栏只是引用，不计入此数量（用于守恒校验）。
 */
export function countCardsInZones(state, side) {
  const counts = getPileCounts(state, side)
  return counts.draw + counts.hand + counts.discard
}
