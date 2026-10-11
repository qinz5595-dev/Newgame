/**
 * 界面渲染：把战斗状态变成页面上的 HTML
 *
 * 这里只负责"显示"和"按钮能不能点"，战斗规则全部在 core 里。
 * 事件绑定统一由 main.js 用 data-action 属性处理。
 */
import { HEROES } from '../data/heroes.js'
import { CARD_TYPE, CARD_TYPE_LABEL, SLOT_LABEL, getCardById } from '../data/cards.js'
import { CARDS_PER_TURN, MAX_COST } from '../config.js'
import {
  SIDE,
  SIDE_LABEL,
  getAttack,
  getAttackParts,
  getCost,
  getDefense,
  getDefenseParts,
  getHpPercent,
} from '../core/state.js'
import { canBaseAttack } from '../core/turn.js'
import { canUseCard } from '../core/effects.js'

/** 把用户数据放进 HTML 前先转义，避免特殊情况把页面弄坏 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => {
    switch (char) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}

/* ------------------------------------------------------------------ */
/* 开始界面                                                            */
/* ------------------------------------------------------------------ */
export function renderStartScreen() {
  return `
    <section class="screen screen--center">
      <div class="panel panel--start">
        <p class="panel__eyebrow">单机卡牌对战 · 玩家 vs 电脑</p>
        <h2 class="panel__title">卡牌对战</h2>
        <p class="panel__text">
          选择一位主角，与电脑对手轮流行动。每个回合你都会获得 ${CARDS_PER_TURN} 张随机卡牌：
          用装备卡永久强化自己，用技能卡立刻打击敌人，再配合基础攻击击倒对手。
        </p>
        <ul class="rules">
          <li>每个回合开始随机获得 ${CARDS_PER_TURN} 张卡牌，回合结束时没用完的卡会被弃掉</li>
          <li>装备卡持续生效，技能卡使用后立即消失</li>
          <li>每回合可以发动一次基础攻击：伤害 = 攻击力 − 对方防御力（最低 1 点）</li>
          <li>任意一方生命值降到 0，战斗立即结束</li>
        </ul>
        <button class="btn btn--primary btn--big" type="button" data-action="go-select">开始游戏</button>
        <p class="panel__note">当前版本可完整体验：抽卡、装备、技能、攻击、电脑行动与胜负判定。</p>
      </div>
    </section>
  `
}

/* ------------------------------------------------------------------ */
/* 主角选择界面                                                        */
/* ------------------------------------------------------------------ */
export function renderHeroSelectScreen() {
  const cards = HEROES.map(
    (hero) => `
      <button class="hero-pick" type="button" data-action="pick-hero" data-hero-id="${escapeHtml(hero.id)}">
        <span class="hero-pick__icon" aria-hidden="true">${escapeHtml(hero.icon)}</span>
        <span class="hero-pick__body">
          <span class="hero-pick__name">${escapeHtml(hero.name)}</span>
          <span class="hero-pick__desc">${escapeHtml(hero.description)}</span>
          <span class="hero-pick__stats">
            <span class="chip chip--hp">生命 ${hero.maxHp}</span>
            <span class="chip chip--atk">攻击 ${hero.baseAttack}</span>
          </span>
        </span>
      </button>
    `,
  ).join('')

  return `
    <section class="screen">
      <div class="panel panel--select">
        <h2 class="panel__title">选择你的主角</h2>
        <p class="panel__text">电脑对手会从其余角色中随机挑选一位。正式的角色背景与立绘将在以后设计。</p>
        <div class="hero-grid">${cards}</div>
        <button class="btn btn--ghost btn--block" type="button" data-action="go-start">返回开始界面</button>
      </div>
    </section>
  `
}

/* ------------------------------------------------------------------ */
/* 对战界面                                                            */
/* ------------------------------------------------------------------ */

/** 一张主角卡（双方共用） */
function renderHeroPanel(hero, { active, label, handCount, cost, costMax, isEnemy }) {
  const attack = getAttack(hero)
  const defense = getDefense(hero)
  const attackParts = getAttackParts(hero)
  const defenseParts = getDefenseParts(hero)

  const attackBreakdown = [
    `基础 ${attackParts.base}`,
    attackParts.equipment !== 0 ? `装备 ${attackParts.equipment > 0 ? '+' : ''}${attackParts.equipment}` : '',
    attackParts.skill !== 0 ? `技能 ${attackParts.skill > 0 ? '+' : ''}${attackParts.skill}` : '',
  ]
    .filter(Boolean)
    .join(' ')

  const defenseBreakdown =
    defenseParts.equipment === 0 && defenseParts.skill === 0
      ? '无加成'
      : [
          defenseParts.equipment !== 0 ? `装备 ${defenseParts.equipment > 0 ? '+' : ''}${defenseParts.equipment}` : '',
          defenseParts.skill !== 0 ? `技能 ${defenseParts.skill > 0 ? '+' : ''}${defenseParts.skill}` : '',
        ]
          .filter(Boolean)
          .join(' ')

  const slotKeys = ['weapon', 'armor', 'accessory']
  const slots = slotKeys
    .map((slotKey) => {
      const equipped = hero.equipment[slotKey]
      const card = equipped ? getCardById(equipped.cardId) : null
      return `
        <li class="slot ${card ? '' : 'slot--empty'}">
          <span class="slot__label">${SLOT_LABEL[slotKey]}</span>
          <span class="slot__value">${escapeHtml(card ? card.name : '空')}</span>
        </li>
      `
    })
    .join('')

  // 附加信息行：电脑显示"手牌张数 + 当前费用"，方便玩家看到双方的资源状况
  const extraParts = []
  if (typeof handCount === 'number') extraParts.push(`手牌：${handCount} 张（内容隐藏）`)
  if (typeof cost === 'number') extraParts.push(`费用：${cost} / ${costMax}`)
  const hiddenHand = extraParts.length > 0 ? `<p class="hero-panel__extra">${extraParts.join(' · ')}</p>` : ''

  const hpPercent = getHpPercent(hero)
  const lowHp = hpPercent <= 30 ? 'hpbar--low' : ''

  return `
    <article class="hero-panel ${active ? 'hero-panel--active' : ''} ${isEnemy ? 'hero-panel--enemy' : ''}">
      <header class="hero-panel__head">
        <span class="hero-panel__icon" aria-hidden="true">${escapeHtml(hero.icon)}</span>
        <span class="hero-panel__titles">
          <span class="side__label">${escapeHtml(label)}</span>
          <span class="hero-panel__name">${escapeHtml(hero.name)}</span>
        </span>
        ${active ? '<span class="badge badge--turn">行动中</span>' : ''}
      </header>

      <div class="hpbar ${lowHp}">
        <div class="hpbar__fill" style="width: ${hpPercent}%"></div>
        <span class="hpbar__text">${hero.hp} / ${hero.maxHp}</span>
      </div>

      <div class="stats">
        <span class="stat">
          <span class="stat__label">攻击</span>
          <span class="stat__value">${attack}</span>
          <span class="stat__base">${escapeHtml(attackBreakdown)}</span>
        </span>
        <span class="stat">
          <span class="stat__label">防御</span>
          <span class="stat__value">${defense}</span>
          <span class="stat__base">${escapeHtml(defenseBreakdown)}</span>
        </span>
      </div>

      <div class="hero-panel__texts">
        <p class="hero-panel__desc">${escapeHtml(hero.description)}</p>
        ${hiddenHand}
      </div>
      <ul class="slots">${slots}</ul>
    </article>
  `
}

/** 一张手牌 */
function renderCard(state, cardInstance, { interactive }) {
  const card = getCardById(cardInstance.cardId)
  if (!card) return ''

  const isEquipment = card.type === CARD_TYPE.EQUIPMENT
  const usable = canUseCard(state, SIDE.PLAYER, cardInstance)
  const blocked = interactive && !usable.ok

  const values = []
  // 费用放在最前面，让玩家第一眼看到这张卡要花多少钱
  if (card.cost) values.push(`费用 ${card.cost}`)
  if (card.attack) values.push(`攻击 ${card.attack > 0 ? '+' : ''}${card.attack}`)
  if (card.defense) values.push(`防御 ${card.defense > 0 ? '+' : ''}${card.defense}`)
  if (card.damage) values.push(`伤害 ${card.damage}`)
  if (card.heal) values.push(`回复 ${card.heal}`)
  if (isEquipment && card.slot) values.push(SLOT_LABEL[card.slot])

  const footer = isEquipment ? '装备后持续生效' : '使用后立即消失'
  const blockedNote = blocked ? `<span class="card__blocked">${escapeHtml(usable.reason)}</span>` : ''

  return `
    <button
      class="card ${isEquipment ? 'card--equipment' : 'card--skill'} ${blocked ? 'card--blocked' : ''}"
      type="button"
      data-action="play-card"
      data-instance-id="${escapeHtml(cardInstance.instanceId)}"
      data-card-id="${escapeHtml(card.id)}"
      data-card-name="${escapeHtml(card.name)}"
      ${interactive ? '' : 'disabled'}
    >
      <span class="card__type">${CARD_TYPE_LABEL[card.type]}</span>
      <span class="card__name">${escapeHtml(card.name)}</span>
      <span class="card__desc">${escapeHtml(card.description)}</span>
      <span class="card__values">${values.map((item) => `<span class="card__value">${escapeHtml(item)}</span>`).join('')}</span>
      ${blockedNote}
      <span class="card__footer">${footer}</span>
    </button>
  `
}

/** 战斗信息区 */
function renderLog(log) {
  const items = log
    .map((entry) => `<li class="log__item log__item--${escapeHtml(entry.kind)}">${escapeHtml(entry.text)}</li>`)
    .join('')

  return `
    <div class="log">
      <p class="log__title">战斗信息</p>
      <ul class="log__list">${items}</ul>
    </div>
  `
}

/** 顶部醒目提示 */
function renderHint(state) {
  if (!state.hint) return ''
  return `<p class="hint hint--${escapeHtml(state.hint.kind)}">${escapeHtml(state.hint.text)}</p>`
}

/** 战斗结束时的浮层 */
function renderResultOverlay(state) {
  if (!state.finished) return ''

  const isWin = state.winner === SIDE.PLAYER
  const isDraw = state.winner === 'draw'
  const title = isDraw ? '平局' : isWin ? '胜利！' : '失败…'
  const text = isDraw
    ? '双方同时倒下，这一局没有赢家。'
    : isWin
      ? `你击败了电脑对手「${state.enemy.name}」，剩余生命 ${state.player.hp} / ${state.player.maxHp}。`
      : `你的主角「${state.player.name}」被击败了，电脑对手还剩 ${state.enemy.hp} / ${state.enemy.maxHp} 生命。`

  return `
    <div class="overlay">
      <div class="overlay__card ${isWin ? 'overlay__card--win' : isDraw ? '' : 'overlay__card--lose'}">
        <p class="overlay__eyebrow">第 ${state.round} 回合 · 战斗结束</p>
        <h3 class="overlay__title">${escapeHtml(title)}</h3>
        <p class="overlay__text">${escapeHtml(text)}</p>
        <div class="overlay__actions">
          <button class="btn btn--primary" type="button" data-action="restart">再来一局</button>
          <button class="btn btn--ghost" type="button" data-action="go-select">更换主角</button>
        </div>
      </div>
    </div>
  `
}

/**
 * 对战界面
 * @param state 战斗状态
 * @param ui    { busy } busy 表示电脑正在行动，此时禁止玩家操作
 */
export function renderBattleScreen(state, ui = {}) {
  const busy = Boolean(ui.busy)
  const isPlayerTurn = state.turn === SIDE.PLAYER && !state.finished
  const canAct = isPlayerTurn && !busy

  const attackCheck = canBaseAttack(state, SIDE.PLAYER)
  const attackDisabled = !canAct || !attackCheck.ok

  const handCards = state.hands[SIDE.PLAYER]
  const hand =
    handCards.length > 0
      ? handCards.map((cardInstance) => renderCard(state, cardInstance, { interactive: canAct })).join('')
      : '<p class="hand__empty">本回合手牌已用完，结束回合后会重新抽牌。</p>'

  const turnText = state.finished
    ? '战斗已结束'
    : busy && state.turn === SIDE.ENEMY
      ? '电脑对手行动中…'
      : `当前回合：${SIDE_LABEL[state.turn]}`

  const handHint = !canAct
    ? state.finished
      ? '战斗已经结束'
      : '等待电脑行动…'
    : attackCheck.ok
      ? `点击卡牌使用，还可以发动一次基础攻击（手牌 ${handCards.length} 张）`
      : '点击卡牌使用；本回合的基础攻击已用完'

  const endTurnLabel = state.finished
    ? '战斗已结束'
    : isPlayerTurn
      ? '结束回合（交给电脑）'
      : busy
        ? '电脑行动中…'
        : '等待电脑'

  return `
    <section class="screen screen--battle">
      <div class="board">
        <div class="board__side board__side--enemy">
          ${renderHeroPanel(state.enemy, {
            active: state.turn === SIDE.ENEMY && !state.finished,
            label: SIDE_LABEL[SIDE.ENEMY],
            handCount: state.hands[SIDE.ENEMY].length,
            cost: getCost(state, SIDE.ENEMY),
            costMax: MAX_COST,
            isEnemy: true,
          })}
        </div>

        <div class="battlefield">
          <div class="turn ${state.turn === SIDE.PLAYER ? 'turn--player' : 'turn--enemy'}">
            ${escapeHtml(turnText)}
            <span class="turn__round">第 ${state.round} 回合</span>
          </div>
          ${renderHint(state)}
          ${renderLog(state.log)}
        </div>

        <div class="board__side board__side--player">
          ${renderHeroPanel(state.player, {
            active: isPlayerTurn,
            label: SIDE_LABEL[SIDE.PLAYER],
          })}
        </div>
      </div>

      <div class="hand">
        <div class="hand__head">
          <p class="hand__title">
            你的手牌<span class="hand__count">${handCards.length} 张</span>
            <span class="hand__count">费用 ${getCost(state, SIDE.PLAYER)} / ${MAX_COST}</span>
          </p>
          <p class="hand__hint">${escapeHtml(handHint)}</p>
        </div>
        <div class="hand__list">${hand}</div>
      </div>

      <div class="actions">
        <button class="btn btn--primary" type="button" data-action="attack" ${attackDisabled ? 'disabled' : ''}>
          基础攻击
        </button>
        <button class="btn btn--ghost" type="button" data-action="end-turn" ${canAct ? '' : 'disabled'}>
          ${escapeHtml(endTurnLabel)}
        </button>
        <button class="btn btn--ghost" type="button" data-action="go-select">更换主角</button>
        <button class="btn btn--danger" type="button" data-action="restart">重新开始</button>
      </div>

      ${renderResultOverlay(state)}
    </section>
  `
}
