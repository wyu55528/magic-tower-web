/**
 * 回合制战斗结算（纯函数）。
 * 玩家先手，双方每回合各攻击一次；伤害最低 1 点。
 *
 * 塔里没有药水：加血只有即时性，没有"存起来以后再喝"的东西。
 * 所以这场仗怎么打就怎么结算：
 *   1) 血量只会往下掉，不会比开打时更多；
 *   2) 打不赢就是打不赢，血量一路掉到 0，没有药能续命；
 *   3) 全塔只有两处回血：捡到生命结晶（当场回满），推开魔王房的门（回满）。
 */
export function resolveBattle(player, monster) {
  const log = [];
  const hpAtStart = player.hp;
  let mHp = monster.hp;
  let pHp = player.hp;
  let rounds = 0;

  while (pHp > 0 && mHp > 0) {
    rounds++;

    const dmgToMonster = Math.max(1, player.atk - monster.def);
    mHp -= dmgToMonster;
    log.push(`你攻击 ${monster.name}，造成 ${dmgToMonster} 点伤害`);
    if (mHp <= 0) break;

    const dmgToPlayer = Math.max(1, monster.atk - player.def);
    pHp -= dmgToPlayer;
    log.push(`${monster.name} 攻击你，造成 ${dmgToPlayer} 点伤害`);
    if (pHp <= 0) break;
  }

  return {
    win: mHp <= 0 && pHp > 0,
    rounds,
    hpLeft: Math.max(0, pHp),
    monsterHpLeft: Math.max(0, mHp),
    gold: monster.gold || 0,
    log,
    hpAtStart,
  };
}

/**
 * 图鉴用的战斗预判：按玩家当前面板真打一遍，
 * 结论和真打的时候完全一致：
 *   'unsolvable' 不可战胜（这场仗怎么打都赢不了，硬冲就是死）
 *   'nodamage'   无伤击杀
 *   'damage'     损失 XXX 点血量
 */
export function previewFight(player, monster) {
  const res = resolveBattle(player, monster);
  const loss = Math.max(0, player.hp - res.hpLeft);
  const verdict = !res.win ? 'unsolvable' : (loss === 0 ? 'nodamage' : 'damage');
  return { verdict, loss, rounds: res.rounds };
}

/** 把战斗预判翻成一句人话 */
export function verdictText(result) {
  if (result.verdict === 'unsolvable') return '不可战胜';
  if (result.verdict === 'nodamage') return '无伤击杀';
  return `损失 ${result.loss} 点血量`;
}
