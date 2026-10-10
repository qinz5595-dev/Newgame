/**
 * 终端里跑一整局（不需要浏览器）
 *
 * 用法：
 *   node tools/simulate-battle.mjs                 随机双方主角
 *   node tools/simulate-battle.mjs knight mage      指定"玩家主角 电脑主角"
 *
 * 作用：
 *   1. 把完整的回合流程跑一遍，确认没有卡死、没有死循环；
 *   2. 把战斗日志打到终端，方便不看浏览器也能检查规则对不对。
 */
import { HEROES, getHeroById } from '../src/data/heroes.js'
import { SIDE, heroOf, getAttack, getDefense } from '../src/core/state.js'
import { startBattle, baseAttack, endPlayerTurn, finishEnemyTurn } from '../src/core/turn.js'
import { useCard, canUseCard } from '../src/core/effects.js'
import { runEnemyTurn } from '../src/ai/ai.js'
import { CARD_TYPE, getCardById } from '../src/data/cards.js'

const args = process.argv.slice(2)
const pick = (index) => (args[index] ? getHeroById(args[index]) : null)
const playerHero = pick(0) || HEROES[Math.floor(Math.random() * HEROES.length)]
const enemyHero = pick(1) || HEROES.find((hero) => hero.id !== playerHero.id)

/** 玩家这边的"简易自动打法"，只是为了让演示能自己跑完 */
function autoPlayPlayer(state) {
  const side = SIDE.PLAYER
  const player = heroOf(state, side)

  for (const instance of [...state.hands[side]]) {
    const card = getCardById(instance.cardId)
    if (!card) continue

    const usable = canUseCard(state, side, instance)
    if (!usable.ok) continue

    const isHeal = card.type === CARD_TYPE.SKILL && card.heal
    const isWeaponOrArmor = card.type === CARD_TYPE.EQUIPMENT
    const isDamage = card.type === CARD_TYPE.SKILL && card.damage

    // 治疗：血量低于 70% 才用
    if (isHeal && player.hp > player.maxHp * 0.7) continue
    // 装备：只装比现在更好的
    if (isWeaponOrArmor) {
      const current = player.equipment[card.slot]
      const currentCard = current ? getCardById(current.cardId) : null
      const score = (c) => (c ? (c.attack || 0) + (c.defense || 0) : -1)
      if (score(card) <= score(currentCard)) continue
    }
    if (isDamage || isHeal || isWeaponOrArmor) {
      useCard(state, side, instance)
    }
  }

  baseAttack(state, side)
}

const state = startBattle(playerHero.id, enemyHero.id)
console.log('='.repeat(64))
console.log(`玩家：${state.player.name}（生命 ${state.player.maxHp}，攻击 ${state.player.baseAttack}）`)
console.log(`电脑：${state.enemy.name}（生命 ${state.enemy.maxHp}，攻击 ${state.enemy.baseAttack}）`)
console.log('='.repeat(64))

let guard = 0
while (!state.finished && guard < 80) {
  guard += 1
  autoPlayPlayer(state)
  if (state.finished) break

  endPlayerTurn(state)
  runEnemyTurn(state)
  if (state.finished) break
  finishEnemyTurn(state)
}

console.log('\n--- 战斗日志 ---')
for (const entry of state.log) {
  console.log(`[${entry.kind}] ${entry.text}`)
}

console.log('\n--- 结果 ---')
console.log(
  `第 ${state.round} 回合结束 · 玩家 ${state.player.hp}/${state.player.maxHp}（攻击 ${getAttack(state.player)}、防御 ${getDefense(
    state.player,
  )}） · 电脑 ${state.enemy.hp}/${state.enemy.maxHp}（攻击 ${getAttack(state.enemy)}、防御 ${getDefense(state.enemy)}）`,
)
console.log(
  state.winner === SIDE.PLAYER ? '玩家胜利' : state.winner === SIDE.ENEMY ? '电脑胜利' : state.winner === 'draw' ? '平局' : '未分出胜负',
)

if (!state.finished) {
  console.log('警告：跑了 80 个回合仍未结束，可能是规则出了问题。')
  process.exit(1)
}
