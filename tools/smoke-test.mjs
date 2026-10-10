/**
 * 自检脚本（不需要浏览器，也不需要安装任何东西）
 *
 * 用法：node tools/smoke-test.mjs
 * 作用：检查数据是否合法、战斗规则是否正确、三个界面能否正常生成 HTML。
 * 每次改完代码跑一下，能提前发现低级错误和规则写错的问题。
 */
import { HEROES, getHeroById } from '../src/data/heroes.js'
import { CARDS, CARD_TYPE, getCardById } from '../src/data/cards.js'
import {
  SIDE,
  applyDamage,
  createCardInstance,
  createHeroInstance,
  getAttack,
  getDefense,
  getHpPercent,
  recalculateEquipmentBonuses,
} from '../src/core/state.js'
import {
  baseAttack,
  beginTurn,
  canBaseAttack,
  discardHand,
  drawCards,
  endPlayerTurn,
  finishEnemyTurn,
  startBattle,
} from '../src/core/turn.js'
import { canUseCard, useCard } from '../src/core/effects.js'
import { runEnemyTurn } from '../src/ai/ai.js'
import { renderStartScreen, renderHeroSelectScreen, renderBattleScreen } from '../src/ui/render.js'

let passed = 0
let failed = 0

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1
    console.log(`  ✔ ${name}`)
  } else {
    failed += 1
    console.log(`  ✘ ${name} ${extra}`)
  }
}

function section(title) {
  console.log(`\n${title}`)
}

/** 给某一方塞一张指定的卡（方便做确定性测试） */
function giveCard(state, side, cardId) {
  const instance = createCardInstance(cardId)
  state.hands[side].push(instance)
  return instance
}

/** 取手牌里的某张卡 */
function findInHand(state, side, cardId) {
  return state.hands[side].find((item) => item.cardId === cardId) || null
}

/* ================================================================== */
section('[1] 主角数据')
check('主角数量 >= 3', HEROES.length >= 3, `实际 ${HEROES.length}`)
check('主角 id 不重复', new Set(HEROES.map((h) => h.id)).size === HEROES.length)
check(
  '每个主角都有名称/生命/攻击/描述',
  HEROES.every((h) => h.name && h.maxHp > 0 && h.baseAttack > 0 && h.description),
)
check('getHeroById 能找到角色', getHeroById(HEROES[0].id)?.id === HEROES[0].id)
check('getHeroById 找不到时返回 null', getHeroById('不存在的角色') === null)

section('[2] 卡牌数据')
check('卡牌数量 >= 5', CARDS.length >= 5, `实际 ${CARDS.length}`)
check('卡牌 id 不重复', new Set(CARDS.map((c) => c.id)).size === CARDS.length)
check('卡牌类型只有装备和技能', CARDS.every((c) => c.type === CARD_TYPE.EQUIPMENT || c.type === CARD_TYPE.SKILL))
check('每张卡都有名称和描述', CARDS.every((c) => c.name && c.description))
check(
  '装备卡都填了装备位置',
  CARDS.filter((c) => c.type === CARD_TYPE.EQUIPMENT).every((c) => ['weapon', 'armor', 'accessory'].includes(c.slot)),
)
check('铁剑：装备后攻击 +2', getCardById('iron-sword')?.attack === 2)
check('火球术：伤害 5', getCardById('fireball')?.damage === 5)
check('治疗术：回复 6', getCardById('heal')?.heal === 6)

/* ================================================================== */
section('[3] 模板与战斗实例分离')
const template = getHeroById('knight')
const instance = createHeroInstance('knight', SIDE.PLAYER)
instance.hp -= 10
instance.equipmentAttackBonus += 5
check('战斗实例掉血不会改到模板', template.maxHp === 30 && getHeroById('knight').maxHp === 30)
check('模板里没有 hp / 加成字段', !('hp' in template) && !('equipmentAttackBonus' in template))
check('实例初始满血', createHeroInstance('mage', SIDE.ENEMY).hp === getHeroById('mage').maxHp)

/* ================================================================== */
section('[4] 随机抽卡')
const oneDraw = drawCards(3)
check('一次抽 3 张', oneDraw.length === 3)
check('同一次抽卡不会重复', new Set(oneDraw.map((c) => c.cardId)).size === 3)

const seen = new Set()
for (let i = 0; i < 200; i += 1) {
  for (const card of drawCards(3)) seen.add(card.cardId)
}
check('长期抽卡能覆盖几乎整个卡池', seen.size >= CARDS.length - 1, `实际出现 ${seen.size} / ${CARDS.length} 种`)

const drawState = startBattle('knight', 'mage')
check('开局玩家手牌 3 张', drawState.hands[SIDE.PLAYER].length === 3)
check('开局电脑手牌 0 张（轮到它才抽）', drawState.hands[SIDE.ENEMY].length === 0)
check('开局轮到玩家', drawState.turn === SIDE.PLAYER && drawState.round === 1)

/* ================================================================== */
section('[5] 装备卡效果')
const equipState = startBattle('knight', 'mage')
equipState.hands[SIDE.PLAYER] = []
const sword = giveCard(equipState, SIDE.PLAYER, 'iron-sword')
const beforeAttack = getAttack(equipState.player)
useCard(equipState, SIDE.PLAYER, sword)
check('铁剑装备后攻击力 +2', getAttack(equipState.player) === beforeAttack + 2, `实际 ${getAttack(equipState.player)}`)
check('装备卡从手牌中移除', equipState.hands[SIDE.PLAYER].length === 0)
check('装备进入装备栏', equipState.player.equipment.weapon?.cardId === 'iron-sword')

// 同位置替换：巨斧（攻击 +4、防御 -1）应该替换掉铁剑，而不是叠加
const axe = giveCard(equipState, SIDE.PLAYER, 'great-axe')
useCard(equipState, SIDE.PLAYER, axe)
check(
  '同位置新装备会替换旧装备（不叠加）',
  getAttack(equipState.player) === equipState.player.baseAttack + 4,
  `实际攻击 ${getAttack(equipState.player)}`,
)
check(
  '防御力负加成会被限制为 0（不会出现负防御）',
  getDefense(equipState.player) === 0,
  `实际防御 ${getDefense(equipState.player)}`,
)
check('防御力最低为 0 时攻击加成不受影响', getAttack(equipState.player) === equipState.player.baseAttack + 4)

// 不同位置可以同时装备
const armor = giveCard(equipState, SIDE.PLAYER, 'leather-armor')
useCard(equipState, SIDE.PLAYER, armor)
check('护甲与武器可以同时生效', getDefense(equipState.player) === 1, `实际防御 ${getDefense(equipState.player)}`)

// 重复重算不会越叠越多
const attackBeforeRecalc = getAttack(equipState.player)
recalculateEquipmentBonuses(equipState.player)
recalculateEquipmentBonuses(equipState.player)
check('重复计算装备加成不会越叠越多', getAttack(equipState.player) === attackBeforeRecalc)

/* ================================================================== */
section('[6] 技能卡效果')
const skillState = startBattle('knight', 'mage')
skillState.hands[SIDE.PLAYER] = []
const fireball = giveCard(skillState, SIDE.PLAYER, 'fireball')
const enemyHpBefore = skillState.enemy.hp
useCard(skillState, SIDE.PLAYER, fireball)
check('火球术造成 5 点伤害', skillState.enemy.hp === enemyHpBefore - 5, `实际 ${skillState.enemy.hp}`)
check('技能卡使用后从手牌消失', skillState.hands[SIDE.PLAYER].length === 0)

// 治疗术：满血时不能用
const healState = startBattle('priest', 'mage')
healState.hands[SIDE.PLAYER] = []
const healCard = giveCard(healState, SIDE.PLAYER, 'heal')
const healCheck = canUseCard(healState, SIDE.PLAYER, healCard)
check('满血时治疗术不可用', healCheck.ok === false && healCheck.reason.includes('满'))
useCard(healState, SIDE.PLAYER, healCard)
check('不可用的卡不会生效', healState.player.hp === healState.player.maxHp)
check('不可用的卡仍留在手牌里', healState.hands[SIDE.PLAYER].length === 1)

// 掉血后治疗 6 点
applyDamage(healState, SIDE.PLAYER, 10, '测试')
healState.hands[SIDE.PLAYER] = []
const healCard2 = giveCard(healState, SIDE.PLAYER, 'heal')
const hpBeforeHeal = healState.player.hp
useCard(healState, SIDE.PLAYER, healCard2)
check('治疗术恢复 6 点生命', healState.player.hp === hpBeforeHeal + 6, `实际 ${healState.player.hp}`)

// 治疗不会超过最大生命值
healState.player.hp = healState.player.maxHp - 2
const healCard3 = giveCard(healState, SIDE.PLAYER, 'heal')
useCard(healState, SIDE.PLAYER, healCard3)
check('治疗不会超过最大生命值', healState.player.hp === healState.player.maxHp)

// 不是自己的回合不能用卡
const notMyTurn = startBattle('knight', 'mage')
notMyTurn.turn = SIDE.ENEMY
const cardOutOfTurn = giveCard(notMyTurn, SIDE.PLAYER, 'fireball')
const outOfTurnCheck = canUseCard(notMyTurn, SIDE.PLAYER, cardOutOfTurn)
check('不是自己回合不能用卡', outOfTurnCheck.ok === false && outOfTurnCheck.reason.includes('回合'))

/* ================================================================== */
section('[7] 基础攻击')
const attackState = startBattle('knight', 'mage')
const atk = getAttack(attackState.player)
const def = getDefense(attackState.enemy)
const result = baseAttack(attackState, SIDE.PLAYER)
check(
  '伤害 = 攻击力 − 防御力',
  result.damage === Math.max(1, atk - def) && attackState.enemy.hp === attackState.enemy.maxHp - result.damage,
)
check('每回合只能攻击一次', canBaseAttack(attackState, SIDE.PLAYER).ok === false)
check('攻击次数记录正确', attackState.baseAttacksThisTurn === 1)

// 最低伤害 1：牧师（攻击 3）打穿守护铠甲（防御 4）
const minState = startBattle('priest', 'mage')
minState.player.equipment.armor = { instanceId: 'x', cardId: 'guardian-plate' }
recalculateEquipmentBonuses(minState.player)
minState.enemy.equipment.armor = { instanceId: 'y', cardId: 'guardian-plate' }
recalculateEquipmentBonuses(minState.enemy)
const minResult = baseAttack(minState, SIDE.PLAYER)
check('攻击力低于防御力时至少造成 1 点伤害', minResult.damage === 1, `实际 ${minResult.damage}`)

// 不是自己的回合不能攻击
const enemyTurnState = startBattle('knight', 'mage')
enemyTurnState.turn = SIDE.ENEMY
check('电脑回合玩家不能攻击', canBaseAttack(enemyTurnState, SIDE.PLAYER).ok === false)

/* ================================================================== */
section('[8] 回合流程与电脑行动')
const flowState = startBattle('knight', 'priest')
endPlayerTurn(flowState)
check('结束回合后玩家手牌被弃掉', flowState.hands[SIDE.PLAYER].length === 0)
check('结束回合后轮到电脑', flowState.turn === SIDE.ENEMY)
check('电脑回合开始时抽到 3 张牌', flowState.hands[SIDE.ENEMY].length === 3)
check('新回合可以重新攻击', flowState.baseAttacksThisTurn === 0)

const logCountBeforeAi = flowState.log.length
runEnemyTurn(flowState)
check('电脑回合产生了行动记录', flowState.log.length > logCountBeforeAi)
check('电脑进行了基础攻击', flowState.log.some((entry) => entry.text.includes('基础攻击')))

finishEnemyTurn(flowState)
check('电脑回合结束后轮回玩家', flowState.turn === SIDE.PLAYER)
check('回合数 +1', flowState.round === 2)
check('玩家重新抽到 3 张牌', flowState.hands[SIDE.PLAYER].length === 3)
check('电脑手牌被弃掉', flowState.hands[SIDE.ENEMY].length === 0)

// 连续跑 60 个回合：不能卡住，必须能正常打完并分出胜负
const loopState = startBattle('knight', 'mage')
let rounds = 0
while (!loopState.finished && rounds < 60) {
  discardHand(loopState, SIDE.PLAYER)
  baseAttack(loopState, SIDE.PLAYER)
  if (!loopState.finished) {
    endPlayerTurn(loopState)
    runEnemyTurn(loopState)
    if (!loopState.finished) finishEnemyTurn(loopState)
  }
  rounds += 1
}
check('连续对局不会卡死，能正常结束', loopState.finished, `跑了 ${rounds} 回合仍未结束`)
check('结束后有明确的胜者', loopState.winner === SIDE.PLAYER || loopState.winner === SIDE.ENEMY || loopState.winner === 'draw')
check('结束后回合数合理', loopState.round >= 1)

/* ================================================================== */
section('[9] 胜负判定与结束后的限制')
const winState = startBattle('mage', 'priest')
winState.enemy.hp = 3
const winResult = baseAttack(winState, SIDE.PLAYER)
check('生命值降到 0 立即结束战斗', winState.finished === true && winState.enemy.hp === 0)
check('判定玩家胜利', winState.winner === SIDE.PLAYER)
check('胜利有日志记录', winState.log.some((entry) => entry.kind === 'win'))
check('战斗结束后不能继续攻击', canBaseAttack(winState, SIDE.PLAYER).ok === false && winResult.ok === true)

const afterEndCard = giveCard(winState, SIDE.PLAYER, 'fireball')
check('战斗结束后不能使用卡牌', canUseCard(winState, SIDE.PLAYER, afterEndCard).ok === false)
const handBeforeEndedTurn = winState.hands[SIDE.PLAYER].length
beginTurn(winState, SIDE.PLAYER)
check('战斗结束后不再抽卡', winState.hands[SIDE.PLAYER].length === handBeforeEndedTurn)

const loseState = startBattle('priest', 'mage')
loseState.player.hp = 2
loseState.turn = SIDE.ENEMY // 轮到电脑行动
loseState.baseAttacksThisTurn = 0
baseAttack(loseState, SIDE.ENEMY)
check('玩家生命值降到 0 判定失败', loseState.finished === true && loseState.winner === SIDE.ENEMY)
check('失败有日志记录', loseState.log.some((entry) => entry.kind === 'lose'))

/* ================================================================== */
section('[10] 重新开始')
const firstBattle = startBattle('knight', 'mage')
const secondBattle = startBattle('knight', 'priest')
check('重新开始后生命值满血', secondBattle.player.hp === secondBattle.player.maxHp)
check('重新开始后没有旧装备', Object.values(secondBattle.player.equipment).every((slot) => slot === null))
check('重新开始后加成归零', getAttack(secondBattle.player) === secondBattle.player.baseAttack && getDefense(secondBattle.player) === 0)
check('重新开始后回合数回到 1', secondBattle.round === 1)
check('重新开始后手牌重新抽 3 张', secondBattle.hands[SIDE.PLAYER].length === 3)
check('重新开始后是全新的日志', !secondBattle.log.some((entry) => entry.text.includes(firstBattle.enemy.name)))
check('两场战斗是互相独立的对象', firstBattle !== secondBattle && firstBattle.log !== secondBattle.log)

/* ================================================================== */
section('[11] 界面渲染')
const uiState = startBattle('knight', 'mage')
const screens = {
  开始界面: renderStartScreen(),
  选主角界面: renderHeroSelectScreen(),
  对战界面: renderBattleScreen(uiState, { busy: false }),
}
for (const [name, html] of Object.entries(screens)) {
  check(`${name} 有内容`, html.length > 200, `长度 ${html.length}`)
  check(`${name} 没有 undefined`, !html.includes('undefined'))
  check(`${name} 标签大致配对`, (html.match(/<div/g) || []).length === (html.match(/<\/div>/g) || []).length)
}

const battleHtml = screens.对战界面
check('对战界面含电脑对手区', battleHtml.includes('board__side--enemy'))
check('对战界面含玩家区', battleHtml.includes('board__side--player'))
check('对战界面含双方主角名', battleHtml.includes(uiState.player.name) && battleHtml.includes(uiState.enemy.name))
check('对战界面含生命值', battleHtml.includes(`${uiState.player.hp} / ${uiState.player.maxHp}`))
check('对战界面含攻击力与防御力', battleHtml.includes('攻击') && battleHtml.includes('防御'))
check('对战界面含装备栏', battleHtml.includes('slot__value'))
check('对战界面含手牌', battleHtml.includes('data-action="play-card"'))
check('对战界面含回合提示', battleHtml.includes('当前回合'))
check('对战界面含提示条', battleHtml.includes('class="hint'))
check('对战界面含操作按钮', ['attack', 'end-turn', 'restart', 'go-select'].every((a) => battleHtml.includes(`data-action="${a}"`)))
check('对战界面含战斗信息区', battleHtml.includes('战斗信息'))

// 满血时治疗卡应显示为"当前用不上"
const blockedState = startBattle('priest', 'mage')
blockedState.hands[SIDE.PLAYER] = []
giveCard(blockedState, SIDE.PLAYER, 'heal')
const blockedHtml = renderBattleScreen(blockedState, { busy: false })
check('用不上的卡会显示原因', blockedHtml.includes('card--blocked') && blockedHtml.includes('用不上'))

// 电脑行动时按钮应禁用（真实流程里此时已轮到电脑）
const busyState = startBattle('knight', 'mage')
endPlayerTurn(busyState)
const busyHtml = renderBattleScreen(busyState, { busy: true })
check('电脑行动时按钮禁用', busyHtml.includes('disabled'))
check('电脑行动时有明确提示', busyHtml.includes('电脑行动中'))

// 战斗结束时显示胜负浮层
const overState = startBattle('mage', 'priest')
overState.enemy.hp = 1
baseAttack(overState, SIDE.PLAYER)
const overHtml = renderBattleScreen(overState, { busy: false })
check('战斗结束显示浮层', overHtml.includes('overlay'))
check('胜利时显示"胜利"', overHtml.includes('胜利'))
check('浮层提供再来一局', overHtml.includes('overlay__actions') && overHtml.includes('data-action="restart"'))

// 血条百分比
const hpState = createHeroInstance('knight', SIDE.PLAYER)
hpState.hp = Math.floor(hpState.maxHp / 2)
check('血条百分比计算正确', Math.round(getHpPercent(hpState)) === 50)

/* ================================================================== */
console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项\n`)
process.exit(failed === 0 ? 0 : 1)
