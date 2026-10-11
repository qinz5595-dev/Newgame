/**
 * 游戏入口：界面切换 + 玩家操作分发
 *
 * 界面切换用最简单的办法：一个变量记录当前界面，改完变量重新渲染一次。
 * 点击事件统一从这里分发（看元素上的 data-action 属性），不需要给每个按钮单独绑定。
 *
 * 电脑回合的处理方式：
 *   玩家点"结束回合" → 先切到电脑回合并渲染一次（按钮全部禁用，显示"电脑行动中"）
 *   → 等一小段时间后执行电脑行动 → 回到玩家回合并渲染
 *   只用一个定时器，不会出现重复行动或卡住。
 */
import { APP_VERSION, ENEMY_TURN_DELAY_MS } from './config.js'
import { SCREEN, SIDE, addLog, setHint } from './core/state.js'
import { startBattle, endPlayerTurn, finishEnemyTurn, baseAttack, canBaseAttack } from './core/turn.js'
import { useCard } from './core/effects.js'
import { runEnemyTurn } from './ai/ai.js'
import { renderStartScreen, renderHeroSelectScreen, renderBattleScreen } from './ui/render.js'

/** 整个游戏只保存这一份界面状态 */
const app = {
  screen: SCREEN.START,
  battle: null, // 战斗开始后才有值
  busy: false, // 电脑正在行动时，禁止玩家操作
  timer: null, // 电脑回合的定时器
  // 战斗记录是否收起。必须放在这里：render() 会用 innerHTML 整块重建界面，
  // 任何存在 DOM / CSS 里的状态都会被重建冲掉。刷新页面即恢复默认（展开）。
  logCollapsed: false,
}

const screenEl = document.getElementById('screen')
const versionEl = document.getElementById('app-version')

/** 重新渲染当前界面 */
function render() {
  if (versionEl) {
    versionEl.textContent = `v${APP_VERSION}`
  }
  if (!screenEl) return

  if (app.screen === SCREEN.HERO_SELECT) {
    screenEl.innerHTML = renderHeroSelectScreen()
  } else if (app.screen === SCREEN.BATTLE && app.battle) {
    screenEl.innerHTML = renderBattleScreen(app.battle, { busy: app.busy, logCollapsed: app.logCollapsed })
  } else {
    screenEl.innerHTML = renderStartScreen()
  }

  scrollLogToBottom()
}

/** 战斗信息自动滚到最新一条 */
function scrollLogToBottom() {
  const list = screenEl ? screenEl.querySelector('.log__list') : null
  if (list) {
    list.scrollTop = list.scrollHeight
  }
}

/** 清掉还没执行的电脑回合定时器（重新开始、换主角时用） */
function clearTimer() {
  if (app.timer !== null) {
    clearTimeout(app.timer)
    app.timer = null
  }
}

/* ------------------------------------------------------------------ */
/* 各个操作                                                            */
/* ------------------------------------------------------------------ */

function goStart() {
  clearTimer()
  app.busy = false
  app.screen = SCREEN.START
  app.battle = null
  render()
}

function goSelect() {
  clearTimer()
  app.busy = false
  app.screen = SCREEN.HERO_SELECT
  app.battle = null
  render()
}

/** 玩家选好主角：开始一场全新的战斗（电脑对手随机分配） */
function startNewBattle(heroId) {
  clearTimer()
  app.busy = false
  app.battle = startBattle(heroId)
  app.screen = SCREEN.BATTLE
  render()
}

/** 用同一个主角重开一局：所有数值、手牌、装备、回合数和日志都会重新生成 */
function restartBattle() {
  const heroId = app.battle ? app.battle.player.templateId : null
  if (!heroId) {
    goSelect()
    return
  }
  startNewBattle(heroId)
}

/** 玩家点击手牌 */
function playCard(target) {
  const battle = app.battle
  if (!battle || app.busy) return

  const instanceId = target.dataset.instanceId
  const instance = battle.hands[SIDE.PLAYER].find((item) => item.instanceId === instanceId)
  if (!instance) return

  const result = useCard(battle, SIDE.PLAYER, instance)
  render()
  return result
}

/** 玩家点击基础攻击 */
function playerAttack() {
  const battle = app.battle
  if (!battle || app.busy) return

  const check = canBaseAttack(battle, SIDE.PLAYER)
  if (!check.ok) {
    setHint(battle, check.reason, 'warn')
    render()
    return
  }

  baseAttack(battle, SIDE.PLAYER)
  render()
}

/** 玩家点击结束回合：先渲染"电脑行动中"，再执行电脑回合 */
function playerEndTurn() {
  const battle = app.battle
  if (!battle || app.busy || battle.finished) return
  if (battle.turn !== SIDE.PLAYER) return

  endPlayerTurn(battle) // 弃掉玩家手牌 + 轮到电脑 + 电脑抽牌
  app.busy = true
  render()

  app.timer = setTimeout(() => {
    app.timer = null
    // 万一这期间玩家已经重开或换主角，就不要再操作旧的战斗状态
    if (app.battle !== battle) return

    runEnemyTurn(battle) // 电脑出牌 + 基础攻击

    if (!battle.finished) {
      finishEnemyTurn(battle) // 弃掉电脑手牌 + 回合数 +1 + 轮到玩家并抽牌
    } else {
      addLog(battle, '战斗已经结束。', 'system')
    }

    app.busy = false
    render()
  }, ENEMY_TURN_DELAY_MS)
}

/** 收起/展开左侧战斗记录：只切换界面偏好，不碰任何战斗状态 */
function toggleLogPanel() {
  app.logCollapsed = !app.logCollapsed
  render()
}

/* ------------------------------------------------------------------ */
/* 事件分发                                                            */
/* ------------------------------------------------------------------ */
const ACTIONS = {
  'go-start': goStart,
  'go-select': goSelect,
  'restart': restartBattle,
  'pick-hero': (target) => startNewBattle(target.dataset.heroId),
  'play-card': playCard,
  'attack': playerAttack,
  'end-turn': playerEndTurn,
  'toggle-log': toggleLogPanel,
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]')
  if (!target) return

  const handler = ACTIONS[target.dataset.action]
  if (!handler) return

  event.preventDefault()
  handler(target)
})

// 启动！
render()
console.log(`[卡牌对战] v${APP_VERSION} 已就绪`)

// 方便在浏览器控制台里查看当前状态，也方便调试
window.__CARD_BATTLE__ = app
