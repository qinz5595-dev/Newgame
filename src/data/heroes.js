/**
 * 主角卡数据（只放"角色模板"，不要在战斗中被修改）
 *
 * 以后要加新主角，只需要在 HEROES 里多加一条数据即可。
 * 字段说明：
 *   id          唯一标识，代码里用它查找角色
 *   name        角色名称
 *   maxHp       最大生命值
 *   baseAttack  基础攻击力
 *   description 简短描述
 *   icon        临时的占位图标（以后换成正式立绘）
 */
export const HEROES = [
  {
    id: 'knight',
    name: '铁壁骑士',
    maxHp: 30,
    baseAttack: 4,
    description: '攻守均衡的骑士，生命与攻击都不吃亏，适合第一次上手。',
    icon: '🛡️',
  },
  {
    id: 'mage',
    name: '烈焰法师',
    maxHp: 22,
    baseAttack: 6,
    description: '生命值偏低，但基础攻击力最高，追求快速结束战斗。',
    icon: '🔥',
  },
  {
    id: 'ranger',
    name: '疾风游侠',
    maxHp: 26,
    baseAttack: 5,
    description: '各项数值居中，稳定发挥，不容易被一波带走。',
    icon: '🏹',
  },
  {
    id: 'priest',
    name: '圣光牧师',
    maxHp: 34,
    baseAttack: 3,
    description: '生命值最高、攻击最低，靠装备和技能慢慢积累优势。',
    icon: '✨',
  },
]

/** 按 id 取角色模板；找不到就返回 null，避免出错时页面直接崩掉 */
export function getHeroById(id) {
  return HEROES.find((hero) => hero.id === id) || null
}

/** 随机取一个角色模板（阶段 3 用来给电脑对手分配主角） */
export function getRandomHero() {
  const index = Math.floor(Math.random() * HEROES.length)
  return HEROES[index]
}
