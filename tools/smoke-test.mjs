/**
 * 自检脚本（不需要浏览器，也不需要安装任何东西）
 *
 * 用法：node tools/smoke-test.mjs
 * 作用：检查数据是否合法、战斗规则是否正确、三个界面能否正常生成 HTML。
 * 每次改完代码跑一下，能提前发现低级错误和规则写错的问题。
 */
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BASE_COST_PER_TURN, MAX_COST } from '../src/config.js'
import { HEROES, getHeroById } from '../src/data/heroes.js'
import {
  ALL_CARD_ROLES,
  CARDS,
  CARD_TYPE,
  CARD_ROLE,
  expectedRoles,
  getCardById,
} from '../src/data/cards.js'
import {
  DECK_SIZE,
  ENEMY_MIN_ROLES,
  MAX_COPIES_PER_CARD,
  PRESET_ENEMY_DECK,
  PRESET_PLAYER_DECK,
  analyzeDeck,
  validateDeck,
} from '../src/data/decks.js'
import {
  SIDE,
  applyDamage,
  applyHeal,
  canAfford,
  checkBattleEnd,
  createBattleState,
  createCardInstance,
  createHeroInstance,
  getAttack,
  getCost,
  getDefense,
  getHpPercent,
  grantTurnCost,
  recalculateEquipmentBonuses,
  setHint,
  spendCost,
  TERMINAL_HINT_KINDS,
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

/**
 * 测试辅助：直接给某一方设置费用。
 * 用途：本文件里很多用例会在同一个回合内连续出牌，或者直接跳过 beginTurn 让电脑行动，
 * 这些场景需要充足费用才能复现原有意图；费用规则本身由 [16] 分组严格验证。
 */
function setCost(state, side, value) {
  state.costs[side] = value
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
setCost(equipState, SIDE.PLAYER, 20) // 本用例一个回合内连装 3 件装备，给足费用（费用规则由 [16] 验证）
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
setCost(healState, SIDE.PLAYER, 20) // 本用例连续使用治疗卡，给足费用
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
section('[12] 卡牌战斗定位标签')
check('卡池至少有 13 种卡牌', CARDS.length >= 13, `实际 ${CARDS.length} 种`)
check('卡牌 id 全唯一', new Set(CARDS.map((c) => c.id)).size === CARDS.length)
check('每张卡都有非空的 roles 数组', CARDS.every((c) => Array.isArray(c.roles) && c.roles.length > 0))
check('所有标签都在合法集合内', CARDS.every((c) => c.roles.every((r) => ALL_CARD_ROLES.includes(r))))
check('同一张卡不会重复标注同一标签', CARDS.every((c) => new Set(c.roles).size === c.roles.length))
check(
  '标签与卡牌实际效果一致（逐张核对 expectedRoles）',
  CARDS.every((c) => expectedRoles(c).slice().sort().join(',') === c.roles.slice().sort().join(',')),
  CARDS.filter((c) => expectedRoles(c).slice().sort().join(',') !== c.roles.slice().sort().join(','))
    .map((c) => `${c.name}：标注[${c.roles}] 应为[${expectedRoles(c)}]`)
    .join(' / '),
)
check('卡池里存在攻击定位的卡', CARDS.some((c) => c.roles.includes(CARD_ROLE.ATTACK)))
check('卡池里存在防御定位的卡', CARDS.some((c) => c.roles.includes(CARD_ROLE.DEFENSE)))
check('卡池里存在治疗定位的卡', CARDS.some((c) => c.roles.includes(CARD_ROLE.HEALING)))
check('卡池里存在功能定位的卡', CARDS.some((c) => c.roles.includes(CARD_ROLE.UTILITY)))
check(
  '新增的 4 张卡都已定义',
  ['spiked-shield', 'life-drain', 'holy-sanctuary', 'war-banner'].every((id) => getCardById(id) !== null),
)
check(
  '新增卡牌只使用现有引擎支持的效果字段',
  ['spiked-shield', 'life-drain', 'holy-sanctuary', 'war-banner'].every((id) => {
    const card = getCardById(id)
    return Boolean(card && (card.attack || card.defense || card.damage || card.heal))
  }),
)
check(
  '卡池理论上限足够组出 20 张卡组',
  CARDS.length * MAX_COPIES_PER_CARD >= DECK_SIZE,
  `${CARDS.length} × ${MAX_COPIES_PER_CARD} = ${CARDS.length * MAX_COPIES_PER_CARD}，不足 ${DECK_SIZE}`,
)

/* ================================================================== */
section('[13] 预设卡组合法性（纯数据校验，不涉及牌堆）')
check('卡组规则常量正确', DECK_SIZE === 20 && MAX_COPIES_PER_CARD === 2)
check(
  '卡组元素全部是卡牌定义 id 字符串（不含实例对象）',
  [PRESET_PLAYER_DECK, PRESET_ENEMY_DECK].every((deck) => deck.every((item) => typeof item === 'string')),
)

const playerStats = analyzeDeck(PRESET_PLAYER_DECK)
const playerCheck = validateDeck(PRESET_PLAYER_DECK, { label: '玩家卡组' })
check('玩家卡组恰好 20 张', PRESET_PLAYER_DECK.length === DECK_SIZE, `实际 ${PRESET_PLAYER_DECK.length} 张`)
check('玩家卡组通过合法性校验', playerCheck.ok, playerCheck.errors.join(' / '))
check('玩家卡组同名最多 2 张', playerStats.maxCopies <= MAX_COPIES_PER_CARD, `实际最多 ${playerStats.maxCopies} 张`)
check('玩家卡组所有卡牌 id 都有效', playerStats.unknownCards === 0, `无效 id：${playerStats.unknownIds.join(', ')}`)
check(
  '玩家卡组覆盖全部 4 种定位',
  ALL_CARD_ROLES.every((role) => playerStats.roleCounts[role] > 0),
  JSON.stringify(playerStats.roleCounts),
)

const enemyStats = analyzeDeck(PRESET_ENEMY_DECK)
const enemyCheck = validateDeck(PRESET_ENEMY_DECK, { label: '电脑卡组', minRoles: ENEMY_MIN_ROLES })
check('电脑卡组恰好 20 张', PRESET_ENEMY_DECK.length === DECK_SIZE, `实际 ${PRESET_ENEMY_DECK.length} 张`)
check('电脑卡组通过合法性校验（含最低构成）', enemyCheck.ok, enemyCheck.errors.join(' / '))
check('电脑卡组同名最多 2 张', enemyStats.maxCopies <= MAX_COPIES_PER_CARD, `实际最多 ${enemyStats.maxCopies} 张`)
check('电脑卡组所有卡牌 id 都有效', enemyStats.unknownCards === 0, `无效 id：${enemyStats.unknownIds.join(', ')}`)
check(
  `电脑卡组攻击定位 ≥ ${ENEMY_MIN_ROLES.attack} 张`,
  enemyStats.roleCounts[CARD_ROLE.ATTACK] >= ENEMY_MIN_ROLES.attack,
  `实际 ${enemyStats.roleCounts[CARD_ROLE.ATTACK]} 张`,
)
check(
  `电脑卡组防御定位 ≥ ${ENEMY_MIN_ROLES.defense} 张`,
  enemyStats.roleCounts[CARD_ROLE.DEFENSE] >= ENEMY_MIN_ROLES.defense,
  `实际 ${enemyStats.roleCounts[CARD_ROLE.DEFENSE]} 张`,
)
check(
  `电脑卡组治疗定位 ≥ ${ENEMY_MIN_ROLES.healing} 张`,
  enemyStats.roleCounts[CARD_ROLE.HEALING] >= ENEMY_MIN_ROLES.healing,
  `实际 ${enemyStats.roleCounts[CARD_ROLE.HEALING]} 张`,
)

// ---- 非法卡组必须被拒绝，并且能说明失败原因 ----
const tooShort = PRESET_PLAYER_DECK.slice(0, DECK_SIZE - 1)
const tooShortCheck = validateDeck(tooShort, { label: '测试卡组' })
check(
  '张数不足的卡组被拒绝（并说明要求张数）',
  tooShortCheck.ok === false && tooShortCheck.errors.some((e) => e.includes(String(DECK_SIZE))),
  tooShortCheck.errors.join(' / '),
)

// 把最后一张换成 iron-sword → 铁剑变成 3 张（张数仍是 20）
const tripleCopy = [...PRESET_PLAYER_DECK.slice(0, DECK_SIZE - 1), 'iron-sword']
const tripleCheck = validateDeck(tripleCopy, { label: '测试卡组' })
check(
  '同名超过 2 张的卡组被拒绝（并说明同名上限）',
  tripleCheck.ok === false && tripleCheck.errors.some((e) => e.includes('同名')),
  tripleCheck.errors.join(' / '),
)

const badId = [...PRESET_PLAYER_DECK.slice(0, DECK_SIZE - 1), 'not-a-real-card']
const badIdCheck = validateDeck(badId, { label: '测试卡组' })
check(
  '引用不存在卡牌 id 的卡组被拒绝（并指出是哪个 id）',
  badIdCheck.ok === false && badIdCheck.errors.some((e) => e.includes('not-a-real-card')),
  badIdCheck.errors.join(' / '),
)

const notArrayCheck = validateDeck(null, { label: '测试卡组' })
check('非数组输入被拒绝并说明原因', notArrayCheck.ok === false && notArrayCheck.errors.some((e) => e.includes('数组')))

// 一套 20 张、同名合规、但完全没有治疗卡的卡组 → 应被"最低构成"拦下
const noHealingDeck = [
  'iron-sword',
  'iron-sword',
  'great-axe',
  'great-axe',
  'leather-armor',
  'leather-armor',
  'guardian-plate',
  'guardian-plate',
  'spiked-shield',
  'spiked-shield',
  'power-amulet',
  'power-amulet',
  'fireball',
  'fireball',
  'heavy-strike',
  'heavy-strike',
  'blessing',
  'blessing',
  'war-banner',
  'war-banner',
]
const noHealingStats = analyzeDeck(noHealingDeck)
const noHealingCheck = validateDeck(noHealingDeck, { label: '测试卡组', minRoles: ENEMY_MIN_ROLES })
check(
  '无治疗卡的 20 张卡组：张数与同名上限本身是合法的',
  noHealingDeck.length === DECK_SIZE && noHealingStats.maxCopies <= MAX_COPIES_PER_CARD,
)
check(
  '无治疗卡的卡组仍被最低构成拦下（并指出治疗不足）',
  noHealingCheck.ok === false && noHealingCheck.errors.some((e) => e.includes('治疗')),
  noHealingCheck.errors.join(' / '),
)
check('同一套卡组在不要求最低构成时可以通过校验', validateDeck(noHealingDeck, { label: '测试卡组' }).ok === true)

// 多定位卡只计一次张数，但可同时满足多个定位
const multiRoleDeck = ['war-banner', 'war-banner']
const multiRoleStats = analyzeDeck(multiRoleDeck)
check('多定位卡在总张数里只算一次', multiRoleStats.total === 2)
check(
  '多定位卡可同时计入多个定位',
  multiRoleStats.roleCounts[CARD_ROLE.ATTACK] === 2 &&
    multiRoleStats.roleCounts[CARD_ROLE.DEFENSE] === 2 &&
    multiRoleStats.roleCounts[CARD_ROLE.UTILITY] === 2,
  JSON.stringify(multiRoleStats.roleCounts),
)

/* ================================================================== */
section('[14] 战斗规则修正（D1–D6）')

// ---------- D1：满血时纯治疗卡继续被拒绝 ----------
const d1State = startBattle('knight', 'mage')
d1State.hands[SIDE.PLAYER] = []
const d1Heal = giveCard(d1State, SIDE.PLAYER, 'heal')
const d1Check = canUseCard(d1State, SIDE.PLAYER, d1Heal)
check('D1 满血时纯治疗卡被拒绝', d1Check.ok === false && d1Check.reason.includes('满'), d1Check.reason)
check(
  'D1 被拒绝后生命值不变、卡仍留在手牌',
  d1State.player.hp === d1State.player.maxHp && d1State.hands[SIDE.PLAYER].length === 1,
)
const d1CardDef = getCardById('heal')
check(
  'D1 治疗术确实只含治疗效果（无伤害/增益字段）',
  Boolean(d1CardDef.heal) && !d1CardDef.damage && !d1CardDef.attack && !d1CardDef.defense,
)

// ---------- D2：满血时生命汲取可以使用 ----------
const d2State = startBattle('knight', 'mage')
d2State.hands[SIDE.PLAYER] = []
const d2Card = giveCard(d2State, SIDE.PLAYER, 'life-drain')
const d2EnemyBefore = d2State.enemy.hp
const d2Check = canUseCard(d2State, SIDE.PLAYER, d2Card)
check('D2 满血时生命汲取可以使用', d2Check.ok === true, d2Check.reason)
const d2Result = useCard(d2State, SIDE.PLAYER, d2Card)
check('D2 生命汲取的伤害正常结算（敌方 -3）', d2State.enemy.hp === d2EnemyBefore - 3, `实际 ${d2State.enemy.hp}`)
check('D2 满血时治疗效果为 0（不额外恢复生命）', d2State.player.hp === d2State.player.maxHp, `实际 ${d2State.player.hp}`)
check('D2 使用后卡牌离开手牌', d2Result.ok === true && d2State.hands[SIDE.PLAYER].length === 0)

// ---------- D3：满血时神圣庇护可以使用，永久防御增益生效 ----------
const d3State = startBattle('knight', 'mage')
d3State.hands[SIDE.PLAYER] = []
const d3Card = giveCard(d3State, SIDE.PLAYER, 'holy-sanctuary')
const d3DefBefore = getDefense(d3State.player)
const d3Check = canUseCard(d3State, SIDE.PLAYER, d3Card)
check('D3 满血时神圣庇护可以使用', d3Check.ok === true, d3Check.reason)
useCard(d3State, SIDE.PLAYER, d3Card)
check('D3 满血时治疗量为 0', d3State.player.hp === d3State.player.maxHp, `实际 ${d3State.player.hp}`)
check('D3 永久防御 +2 正常生效', getDefense(d3State.player) === d3DefBefore + 2, `实际 ${getDefense(d3State.player)}`)

// ---------- D4：非致命时，生命汲取照常执行治疗 ----------
const d4aState = startBattle('knight', 'mage')
d4aState.hands[SIDE.PLAYER] = []
applyDamage(d4aState, SIDE.PLAYER, 10, '测试')
const d4aCard = giveCard(d4aState, SIDE.PLAYER, 'life-drain')
const d4aHpBefore = d4aState.player.hp
const d4aEnemyBefore = d4aState.enemy.hp
useCard(d4aState, SIDE.PLAYER, d4aCard)
check('D4 非致命：伤害 -3 正常结算', d4aState.enemy.hp === d4aEnemyBefore - 3, `实际 ${d4aState.enemy.hp}`)
check('D4 非致命：治疗 +3 正常结算', d4aState.player.hp === d4aHpBefore + 3, `实际 ${d4aState.player.hp}`)
check('D4 非致命：战斗继续', d4aState.finished === false)

// ---------- D4：致命伤害后，跳过该卡剩余的治疗 ----------
const d4bState = startBattle('knight', 'mage')
d4bState.hands[SIDE.PLAYER] = []
applyDamage(d4bState, SIDE.PLAYER, 10, '测试') // 先掉血，便于验证"治疗确实被跳过"
const d4bCard = giveCard(d4bState, SIDE.PLAYER, 'life-drain')
d4bState.enemy.hp = 2
const d4bHpBefore = d4bState.player.hp
useCard(d4bState, SIDE.PLAYER, d4bCard)
check('D4 致命：敌方生命归零', d4bState.enemy.hp === 0, `实际 ${d4bState.enemy.hp}`)
check('D4 致命：战斗立即结束并判定玩家胜利', d4bState.finished === true && d4bState.winner === SIDE.PLAYER)
check(
  'D4 致命：剩余治疗被跳过（玩家生命保持不变）',
  d4bState.player.hp === d4bHpBefore,
  `实际 ${d4bState.player.hp}，应保持 ${d4bHpBefore}`,
)

// ---------- D5：胜负提示不会被卡牌效果 / 普通提示覆盖 ----------
const d5State = startBattle('knight', 'mage')
d5State.hands[SIDE.PLAYER] = []
const d5Card = giveCard(d5State, SIDE.PLAYER, 'fireball')
d5State.enemy.hp = 3
useCard(d5State, SIDE.PLAYER, d5Card)
check('D5 技能击杀后战斗结束', d5State.finished === true && d5State.winner === SIDE.PLAYER)
check(
  'D5 技能击杀后提示仍为胜利结论（未被卡牌效果提示覆盖）',
  d5State.hint?.kind === 'win' && d5State.hint.text.includes('胜利'),
  JSON.stringify(d5State.hint),
)

const d5bState = startBattle('mage', 'priest')
d5bState.enemy.hp = 1
baseAttack(d5bState, SIDE.PLAYER)
check('D5 基础攻击击杀后提示仍为胜利', d5bState.hint?.kind === 'win', JSON.stringify(d5bState.hint))
setHint(d5bState, '这条普通提示不应该覆盖胜负结论', 'info')
setHint(d5bState, '这条卡牌效果提示也不应该覆盖', 'skill')
check(
  'D5 战斗结束后普通/卡牌提示都无法覆盖结论',
  d5bState.hint.kind === 'win' && !d5bState.hint.text.includes('不应该'),
  JSON.stringify(d5bState.hint),
)

const d5cState = startBattle('priest', 'mage')
d5cState.player.hp = 2
d5cState.turn = SIDE.ENEMY
d5cState.baseAttacksThisTurn = 0
baseAttack(d5cState, SIDE.ENEMY)
check(
  'D5 失败时提示为失败结论',
  d5cState.hint?.kind === 'lose' && d5cState.hint.text.includes('失败'),
  JSON.stringify(d5cState.hint),
)

const d5dState = startBattle('knight', 'mage')
d5dState.player.hp = 0
d5dState.enemy.hp = 0
checkBattleEnd(d5dState)
setHint(d5dState, '不应覆盖平局结论', 'info')
check(
  'D5 平局提示使用终局类型且不会被覆盖',
  d5dState.winner === 'draw' && d5dState.hint?.kind === 'draw' && !d5dState.hint.text.includes('不应'),
  JSON.stringify(d5dState.hint),
)

// ---------- D6：战斗结束后的伤害 / 治疗路径不再改变状态 ----------
const d6State = startBattle('mage', 'priest')
d6State.enemy.hp = 1
baseAttack(d6State, SIDE.PLAYER) // 击杀
const d6Frozen = {
  enemyHp: d6State.enemy.hp,
  playerHp: d6State.player.hp,
  finished: d6State.finished,
  winner: d6State.winner,
  logLength: d6State.log.length,
  skillAttackBonus: d6State.player.skillAttackBonus,
  skillDefenseBonus: d6State.player.skillDefenseBonus,
}
const d6Damage = applyDamage(d6State, SIDE.PLAYER, 5, '战斗结束后测试')
const d6Heal = applyHeal(d6State, SIDE.PLAYER, 5, '战斗结束后测试')
check('D6 战斗结束后 applyDamage 被忽略（返回 0）', d6Damage === 0, `实际 ${d6Damage}`)
check('D6 战斗结束后 applyHeal 被忽略（返回 0）', d6Heal === 0, `实际 ${d6Heal}`)
check(
  'D6 结束后双方生命值不再变化',
  d6State.enemy.hp === d6Frozen.enemyHp && d6State.player.hp === d6Frozen.playerHp,
  `敌方 ${d6State.enemy.hp}/${d6Frozen.enemyHp}，我方 ${d6State.player.hp}/${d6Frozen.playerHp}`,
)
check(
  'D6 结束后不再追加战斗日志',
  d6State.log.length === d6Frozen.logLength,
  `实际 ${d6State.log.length} 条，结束时 ${d6Frozen.logLength} 条`,
)
check(
  'D6 结束后胜负结论与永久加成不变',
  d6State.finished === true &&
    d6State.winner === d6Frozen.winner &&
    d6State.player.skillAttackBonus === d6Frozen.skillAttackBonus &&
    d6State.player.skillDefenseBonus === d6Frozen.skillDefenseBonus,
)
const d6Card = giveCard(d6State, SIDE.PLAYER, 'fireball')
check('D6 结束后仍然不能使用卡牌', canUseCard(d6State, SIDE.PLAYER, d6Card).ok === false)

// ---------- 回归：原有普通攻击 / 装备 / 技能规则未变 ----------
check(
  '回归：技能伤害仍然不计算防御',
  (() => {
    const s = startBattle('knight', 'mage')
    s.enemy.equipment.armor = { instanceId: 'reg-1', cardId: 'guardian-plate' }
    recalculateEquipmentBonuses(s.enemy)
    s.hands[SIDE.PLAYER] = []
    const card = giveCard(s, SIDE.PLAYER, 'fireball')
    const before = s.enemy.hp
    useCard(s, SIDE.PLAYER, card)
    return s.enemy.hp === before - 5
  })(),
)
check(
  '回归：基础攻击仍计算防御且最低造成 1 点',
  (() => {
    const s = startBattle('priest', 'mage')
    s.enemy.equipment.armor = { instanceId: 'reg-2', cardId: 'guardian-plate' }
    recalculateEquipmentBonuses(s.enemy)
    return baseAttack(s, SIDE.PLAYER).damage === 1
  })(),
)
check(
  '回归：非满血时纯治疗卡仍可正常使用',
  (() => {
    const s = startBattle('knight', 'mage')
    s.hands[SIDE.PLAYER] = []
    applyDamage(s, SIDE.PLAYER, 10, '测试')
    const card = giveCard(s, SIDE.PLAYER, 'heal')
    const before = s.player.hp
    useCard(s, SIDE.PLAYER, card)
    return s.player.hp === before + 6
  })(),
)
check(
  '回归：装备替换仍不叠加、不残留（守护铠甲 +4 → 皮甲 +2）',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 20) // 本用例一回合连换两件装备，给足费用
    s.hands[SIDE.PLAYER] = []
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'guardian-plate'))
    const boosted = getDefense(s.player)
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'leather-armor'))
    return boosted === 4 && getDefense(s.player) === 2
  })(),
)

/* ================================================================== */
section('[15] 修复项验证：平局提示样式 + 电脑治疗选卡')

// ---------- CSS：每一个提示种类都必须有对应样式 ----------
const cssFile = resolve(dirname(fileURLToPath(import.meta.url)), '../src/styles/main.css')
const cssText = readFileSync(cssFile, 'utf8')
const HINT_KINDS_USED = ['info', 'warn', 'damage', 'heal', 'equip', 'skill', 'win', 'lose', 'draw']
const missingHintStyles = HINT_KINDS_USED.filter((kind) => !cssText.includes(`.hint--${kind}`))
check('CSS：所有用到的提示种类都有对应样式', missingHintStyles.length === 0, `缺少：${missingHintStyles.join(', ')}`)
check(
  'CSS：终局提示种类（win / lose / draw）都有样式',
  TERMINAL_HINT_KINDS.every((kind) => cssText.includes(`.hint--${kind}`)),
)
check(
  'CSS：平局样式与胜负同属"结论"外观（含背景色与边框色）',
  /\.hint--draw\s*\{[^}]*background[^}]*border-color[^}]*\}/.test(cssText),
)
check(
  '渲染层：平局时输出 hint--draw 类名',
  (() => {
    const s = startBattle('knight', 'mage')
    s.player.hp = 0
    s.enemy.hp = 0
    checkBattleEnd(s)
    return renderBattleScreen(s, { busy: false }).includes('hint--draw')
  })(),
)

// ---------- 电脑 AI：治疗时优先使用治疗量更高的卡 ----------
// 手牌故意把"生命汲取"（治疗 3）放在最前、治疗术（治疗 6）放在后面：
// 改动前会先抓到手牌里第一张带治疗的卡，导致治疗术本回合无人使用、回合结束被弃掉。
const aiState = startBattle('knight', 'priest')
setCost(aiState, SIDE.ENEMY, 20) // 电脑本回合要连出治疗 + 吸血，给足费用（费用规则由 [16] 验证）
aiState.turn = SIDE.ENEMY
aiState.baseAttacksThisTurn = 0
aiState.hands[SIDE.ENEMY] = []
aiState.enemy.hp = 20 // 圣光牧师 maxHp 34 → 58.8% ≤ 60%，会进入治疗分支
const aiDrain = createCardInstance('life-drain')
const aiHeal = createCardInstance('heal')
aiState.hands[SIDE.ENEMY].push(aiDrain, aiHeal)
const aiPlayerHpBefore = aiState.player.hp
runEnemyTurn(aiState)
check(
  'AI 优先使用治疗量最高的卡（治疗术已被消耗，不会留到回合结束被弃掉）',
  !aiState.hands[SIDE.ENEMY].some((item) => item.instanceId === aiHeal.instanceId),
)
check(
  'AI 仍把多效果卡用在后续环节（生命汲取的伤害与治疗都已结算）',
  !aiState.hands[SIDE.ENEMY].some((item) => item.instanceId === aiDrain.instanceId),
)
check(
  'AI 治疗量符合预期（治疗术 +6、生命汲取 +3，20 → 29）',
  aiState.enemy.hp === 29,
  `实际 ${aiState.enemy.hp}`,
)
check(
  'AI 对玩家的总伤害未被影响（生命汲取 3 + 基础攻击 3）',
  aiState.player.hp === aiPlayerHpBefore - 6,
  `实际 ${aiState.player.hp}，行动前 ${aiPlayerHpBefore}`,
)

// 手中只有一张多效果治疗卡时，仍要正常治疗（改动不能导致"不治疗"）
const aiSoloState = startBattle('knight', 'priest')
setCost(aiSoloState, SIDE.ENEMY, 20)
aiSoloState.turn = SIDE.ENEMY
aiSoloState.baseAttacksThisTurn = 0
aiSoloState.hands[SIDE.ENEMY] = []
aiSoloState.enemy.hp = 20
aiSoloState.hands[SIDE.ENEMY].push(createCardInstance('life-drain'))
runEnemyTurn(aiSoloState)
check('AI 只有多效果治疗卡时仍会治疗（20 → 23）', aiSoloState.enemy.hp === 23, `实际 ${aiSoloState.enemy.hp}`)
check('AI 使用后该卡已结算、手牌清空', aiSoloState.hands[SIDE.ENEMY].length === 0)

// 神圣庇护（治疗 4）优先于生命汲取（治疗 3）
const aiOrderState = startBattle('knight', 'priest')
setCost(aiOrderState, SIDE.ENEMY, 20)
aiOrderState.turn = SIDE.ENEMY
aiOrderState.baseAttacksThisTurn = 0
aiOrderState.hands[SIDE.ENEMY] = []
aiOrderState.enemy.hp = 20
aiOrderState.hands[SIDE.ENEMY].push(createCardInstance('life-drain'), createCardInstance('holy-sanctuary'))
runEnemyTurn(aiOrderState)
check(
  'AI 治疗优先级正确（神圣庇护 4 > 生命汲取 3，两张都结算：20 → 27）',
  aiOrderState.enemy.hp === 27,
  `实际 ${aiOrderState.enemy.hp}`,
)

// 高于治疗阈值时仍然不乱用治疗卡（保持原有阈值策略不变）
const aiHighState = startBattle('knight', 'priest')
setCost(aiHighState, SIDE.ENEMY, 20) // 给足费用：确保"不用治疗卡"的原因只能是血量高于阈值，而不是付不起
aiHighState.turn = SIDE.ENEMY
aiHighState.baseAttacksThisTurn = 0
aiHighState.hands[SIDE.ENEMY] = []
aiHighState.enemy.hp = 30 // 88% > 60% → 不进入治疗分支
const aiHighHeal = createCardInstance('heal')
aiHighState.hands[SIDE.ENEMY].push(aiHighHeal)
runEnemyTurn(aiHighState)
check(
  'AI 高于治疗阈值时不使用治疗卡（阈值策略未被改动）',
  aiHighState.enemy.hp === 30 && aiHighState.hands[SIDE.ENEMY].some((i) => i.instanceId === aiHighHeal.instanceId),
  `生命 ${aiHighState.enemy.hp}，手牌 ${aiHighState.hands[SIDE.ENEMY].length}`,
)

/* ================================================================== */
section('[16] 费用机制（批准规则）')

// ---------- 费用数据与常量 ----------
check('费用常量：每回合 +3、上限 8', BASE_COST_PER_TURN === 3 && MAX_COST === 8)
check(
  '13 张卡都有整数费用',
  CARDS.every((c) => Number.isInteger(c.cost)),
  CARDS.filter((c) => !Number.isInteger(c.cost)).map((c) => c.id).join(', '),
)
const EXPECTED_COSTS = {
  'iron-sword': 1,
  'leather-armor': 1,
  'heavy-strike': 1,
  'power-amulet': 2,
  'spiked-shield': 2,
  'blessing': 2,
  'heal': 2,
  'life-drain': 2,
  'great-axe': 3,
  'guardian-plate': 3,
  'fireball': 3,
  'holy-sanctuary': 3,
  'war-banner': 3,
}
check(
  '费用分配与批准表完全一致',
  CARDS.every((c) => c.cost === EXPECTED_COSTS[c.id]),
  CARDS.filter((c) => c.cost !== EXPECTED_COSTS[c.id])
    .map((c) => `${c.id}:${c.cost}≠${EXPECTED_COSTS[c.id]}`)
    .join(' '),
)
check('费用取值都在 1~8 之间', CARDS.every((c) => c.cost >= 1 && c.cost <= MAX_COST))

const EXPECTED_EFFECTS = {
  'iron-sword': [2, 0, 0, 0],
  'great-axe': [4, -1, 0, 0],
  'leather-armor': [0, 2, 0, 0],
  'guardian-plate': [0, 4, 0, 0],
  'power-amulet': [1, 1, 0, 0],
  'spiked-shield': [2, 1, 0, 0],
  'fireball': [0, 0, 5, 0],
  'heavy-strike': [0, 0, 3, 0],
  'life-drain': [0, 0, 3, 3],
  'heal': [0, 0, 0, 6],
  'holy-sanctuary': [0, 2, 0, 4],
  'blessing': [2, 0, 0, 0],
  'war-banner': [2, 1, 0, 0],
}
const effectSnapshot = (c) => [c.attack || 0, c.defense || 0, c.damage || 0, c.heal || 0].join(',')
check(
  '加费用没有改动任何战斗数值（逐张快照）',
  CARDS.every((c) => effectSnapshot(c) === EXPECTED_EFFECTS[c.id].join(',')),
  CARDS.filter((c) => effectSnapshot(c) !== EXPECTED_EFFECTS[c.id].join(','))
    .map((c) => c.id)
    .join(' '),
)

// ---------- 发放、上限、保留、结束保护 ----------
const freshCostState = createBattleState('knight', 'mage')
check(
  '新战斗状态的双方初始费用都是 0',
  getCost(freshCostState, SIDE.PLAYER) === 0 && getCost(freshCostState, SIDE.ENEMY) === 0,
)

const firstTurnState = startBattle('knight', 'mage')
check(
  '玩家在自己的回合开始时获得 3 点费用',
  getCost(firstTurnState, SIDE.PLAYER) === BASE_COST_PER_TURN,
  `实际 ${getCost(firstTurnState, SIDE.PLAYER)}`,
)
check('玩家发费不影响电脑费用（独立费用池）', getCost(firstTurnState, SIDE.ENEMY) === 0)

const enemyTurnCostState = startBattle('knight', 'mage')
endPlayerTurn(enemyTurnCostState)
check(
  '电脑在自己的回合开始时获得 3 点费用',
  getCost(enemyTurnCostState, SIDE.ENEMY) === BASE_COST_PER_TURN,
  `实际 ${getCost(enemyTurnCostState, SIDE.ENEMY)}`,
)
check('电脑发费不影响玩家费用', getCost(enemyTurnCostState, SIDE.PLAYER) === BASE_COST_PER_TURN)

const keepCostState = startBattle('knight', 'mage')
setCost(keepCostState, SIDE.PLAYER, 2)
beginTurn(keepCostState, SIDE.PLAYER)
check('剩余费用保留：2 → 5', getCost(keepCostState, SIDE.PLAYER) === 5, `实际 ${getCost(keepCostState, SIDE.PLAYER)}`)

const capCostState = startBattle('knight', 'mage')
setCost(capCostState, SIDE.PLAYER, 7)
beginTurn(capCostState, SIDE.PLAYER)
check('费用上限封顶：7 → 8（不是 10）', getCost(capCostState, SIDE.PLAYER) === MAX_COST, `实际 ${getCost(capCostState, SIDE.PLAYER)}`)

const fullCostState = startBattle('knight', 'mage')
setCost(fullCostState, SIDE.PLAYER, MAX_COST)
check('已满 8 时再次发放仍为 8', grantTurnCost(fullCostState, SIDE.PLAYER) === MAX_COST)

const endedCostState = startBattle('knight', 'mage')
setCost(endedCostState, SIDE.PLAYER, 2)
endedCostState.finished = true
check(
  '战斗结束后不再发放费用',
  grantTurnCost(endedCostState, SIDE.PLAYER) === 2,
  `实际 ${getCost(endedCostState, SIDE.PLAYER)}`,
)

// ---------- 扣费、失败保护、边界 ----------
check(
  '1 费卡：费用 3 → 2 且装备生效',
  (() => {
    const s = startBattle('knight', 'mage')
    s.hands[SIDE.PLAYER] = []
    const result = useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'iron-sword'))
    return result.ok === true && getCost(s, SIDE.PLAYER) === 2 && s.player.equipment.weapon?.cardId === 'iron-sword'
  })(),
)
check(
  '3 费卡：费用 3 → 0 且伤害生效',
  (() => {
    const s = startBattle('knight', 'mage')
    s.hands[SIDE.PLAYER] = []
    const before = s.enemy.hp
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'fireball'))
    return getCost(s, SIDE.PLAYER) === 0 && s.enemy.hp === before - 5
  })(),
)
check(
  '多效果卡（生命汲取）只扣一次费用',
  (() => {
    const s = startBattle('knight', 'mage')
    s.hands[SIDE.PLAYER] = []
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'life-drain'))
    return getCost(s, SIDE.PLAYER) === 1
  })(),
)
check(
  '费用不足：canUseCard 拒绝并说明费用',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 1)
    s.hands[SIDE.PLAYER] = []
    const result = canUseCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'fireball'))
    return result.ok === false && result.reason.includes('费用')
  })(),
)
check(
  '费用不足：不扣费、不产生效果、卡仍留在手牌',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 1)
    s.hands[SIDE.PLAYER] = []
    const card = giveCard(s, SIDE.PLAYER, 'fireball')
    const enemyHp = s.enemy.hp
    const result = useCard(s, SIDE.PLAYER, card)
    return (
      result.ok === false &&
      getCost(s, SIDE.PLAYER) === 1 &&
      s.enemy.hp === enemyHp &&
      s.hands[SIDE.PLAYER].length === 1
    )
  })(),
)
check(
  '边界：费用恰好等于卡费时可以成功使用',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 3)
    s.hands[SIDE.PLAYER] = []
    const result = useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'fireball'))
    return result.ok === true && getCost(s, SIDE.PLAYER) === 0
  })(),
)
check(
  'spendCost 不会让费用变成负数',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 2)
    const ok = spendCost(s, SIDE.PLAYER, 5)
    return ok === false && getCost(s, SIDE.PLAYER) === 2
  })(),
)
check(
  '双方费用互相独立：扣玩家费用不改变电脑费用',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 5)
    setCost(s, SIDE.ENEMY, 5)
    s.hands[SIDE.PLAYER] = []
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'iron-sword'))
    return getCost(s, SIDE.PLAYER) === 4 && getCost(s, SIDE.ENEMY) === 5
  })(),
)

// ---------- 装备：支付一次、替换不退款 ----------
check(
  '装备只支付一次费用，替换不退款也不重复扣费',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 10)
    s.hands[SIDE.PLAYER] = []
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'iron-sword')) // 1 费
    const afterFirst = getCost(s, SIDE.PLAYER)
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'great-axe')) // 3 费
    const afterSecond = getCost(s, SIDE.PLAYER)
    return afterFirst === 9 && afterSecond === 6 && s.player.equipment.weapon?.cardId === 'great-axe'
  })(),
)

// ---------- 基础攻击始终免费 ----------
check(
  '基础攻击免费：0 费也能攻击且费用不变',
  (() => {
    const s = startBattle('mage', 'priest')
    setCost(s, SIDE.PLAYER, 0)
    const before = s.enemy.hp
    const result = baseAttack(s, SIDE.PLAYER)
    return result.ok === true && getCost(s, SIDE.PLAYER) === 0 && s.enemy.hp === before - result.damage
  })(),
)

// ---------- 与 D4 / D6 的交互 ----------
check(
  '致命一击时费用已经扣除（不退款）',
  (() => {
    const s = startBattle('knight', 'mage')
    s.hands[SIDE.PLAYER] = []
    s.enemy.hp = 3
    useCard(s, SIDE.PLAYER, giveCard(s, SIDE.PLAYER, 'fireball'))
    return s.finished === true && s.winner === SIDE.PLAYER && getCost(s, SIDE.PLAYER) === 0
  })(),
)

// ---------- 电脑 AI ----------
check(
  'AI 只使用付得起的卡（2 费时不会使用 3 费的巨斧）',
  (() => {
    const s = startBattle('knight', 'priest')
    s.turn = SIDE.ENEMY
    s.baseAttacksThisTurn = 0
    s.hands[SIDE.ENEMY] = []
    setCost(s, SIDE.ENEMY, 2)
    const axe = createCardInstance('great-axe')
    s.hands[SIDE.ENEMY].push(axe)
    runEnemyTurn(s)
    return s.hands[SIDE.ENEMY].some((i) => i.instanceId === axe.instanceId) && getCost(s, SIDE.ENEMY) === 2
  })(),
)
check(
  'AI 治疗：付不起最高治疗量的卡时，改用可负担的治疗卡（不会"有钱不治"）',
  (() => {
    const s = startBattle('knight', 'priest')
    s.turn = SIDE.ENEMY
    s.baseAttacksThisTurn = 0
    s.hands[SIDE.ENEMY] = []
    s.enemy.hp = 20 // ≤60% → 进入治疗分支
    setCost(s, SIDE.ENEMY, 2) // 够生命汲取(2 费)，不够神圣庇护(3 费)
    const sanctuary = createCardInstance('holy-sanctuary')
    const drain = createCardInstance('life-drain')
    s.hands[SIDE.ENEMY].push(sanctuary, drain)
    runEnemyTurn(s)
    const drainUsed = !s.hands[SIDE.ENEMY].some((i) => i.instanceId === drain.instanceId)
    const sanctuaryKept = s.hands[SIDE.ENEMY].some((i) => i.instanceId === sanctuary.instanceId)
    return drainUsed && sanctuaryKept && s.enemy.hp === 23 && getCost(s, SIDE.ENEMY) === 0
  })(),
)
check(
  'AI 费用为 0 时仍执行免费的基础攻击',
  (() => {
    const s = startBattle('knight', 'priest')
    s.turn = SIDE.ENEMY
    s.baseAttacksThisTurn = 0
    s.hands[SIDE.ENEMY] = []
    setCost(s, SIDE.ENEMY, 0)
    const before = s.player.hp
    runEnemyTurn(s)
    return s.player.hp < before && getCost(s, SIDE.ENEMY) === 0
  })(),
)
check(
  'AI 与玩家共用同一套费用门槛（同费用同结果）',
  (() => {
    const s = startBattle('knight', 'mage')
    setCost(s, SIDE.PLAYER, 3)
    setCost(s, SIDE.ENEMY, 1)
    const fireballCard = getCardById('fireball')
    return canAfford(s, SIDE.PLAYER, fireballCard) === true && canAfford(s, SIDE.ENEMY, fireballCard) === false
  })(),
)

// ---------- 界面显示费用 ----------
const uiCostState = startBattle('knight', 'mage')
uiCostState.hands[SIDE.PLAYER] = []
giveCard(uiCostState, SIDE.PLAYER, 'heal') // 2 费卡，用于验证卡面费用显示
const uiCostHtml = renderBattleScreen(uiCostState, { busy: false })
check(
  '界面显示玩家的当前费用与上限',
  uiCostHtml.includes(`费用 ${getCost(uiCostState, SIDE.PLAYER)} / ${MAX_COST}`),
  `期望包含「费用 ${getCost(uiCostState, SIDE.PLAYER)} / ${MAX_COST}」`,
)
check('界面显示每张卡牌的费用', uiCostHtml.includes('费用 2'))
check(
  '界面显示电脑的费用',
  uiCostHtml.includes(`费用：${getCost(uiCostState, SIDE.ENEMY)} / ${MAX_COST}`),
  `期望包含「费用：${getCost(uiCostState, SIDE.ENEMY)} / ${MAX_COST}」`,
)

/* ================================================================== */
console.log(`\n结果：通过 ${passed} 项，失败 ${failed} 项\n`)
process.exit(failed === 0 ? 0 : 1)
