/**
 * 全局配置常量
 * 想把游戏调难或调简单，优先改这里，不用翻逻辑代码。
 */
export const APP_VERSION = '0.2.0'

/** 每个回合抽几张牌 */
export const CARDS_PER_TURN = 3

/** 每个回合开始时发放的基础费用（玩家与电脑各自独立） */
export const BASE_COST_PER_TURN = 3

/** 费用储存上限（未用完的费用会保留到下一回合，但不会超过这个上限） */
export const MAX_COST = 8

/** 基础攻击的最低伤害（攻击力再低也至少打这么多） */
export const MIN_DAMAGE = 1

/** 每个回合最多进行几次基础攻击 */
export const MAX_BASE_ATTACKS_PER_TURN = 1

/** 电脑回合的展示延迟（毫秒），让玩家看清"电脑行动中" */
export const ENEMY_TURN_DELAY_MS = 900

/** 电脑在生命值低于"最大生命值 × 这个比例"时会优先治疗 */
export const ENEMY_HEAL_THRESHOLD = 0.6

/** 主角选择界面上显示的角色数量（目前就是全部） */
export const HEROES_PER_SELECT = 4
