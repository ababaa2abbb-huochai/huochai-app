// 試玩資料：團隊成員、這個月與下個月的班表、幾根進行中的火柴
export const TEAM = ['蘿蔔', '長苓', '丹哥', '小薇', 'Kiwi', '守宜', '怡靜', '霈恩', '沛佳', '沂諠', '倇寧', '子柔', '巧芙'];

function ymd(d) {
  return d.toISOString().slice(0, 10);
}

// 台北時間的今天
function taipeiToday(now) {
  return new Date(new Date(now).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return ymd(d);
}

// 簡單的固定亂數，讓每次重設的試玩資料都一樣
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

export async function seedDemo(db) {
  const now = new Date();
  now.setMinutes(0, 0, 0);
  const nowIso = now.toISOString();
  const today = taipeiToday(nowIso);
  await db.query(`select set_config('app.now', $1, false)`, [nowIso]);

  const ids = {};
  for (const [i, name] of TEAM.entries()) {
    const r = await db.query(
      `insert into members (name, role, status, created_at) values ($1, $2, 'active', now() + ($3 || ' seconds')::interval) returning id`,
      [name, i === 0 ? 'admin' : 'member', String(i)]);
    ids[name] = r.rows[0].id;
  }

  const as = (name) => db.query(`select set_config('app.member_id', $1, false)`, [ids[name]]);
  const call = async (fn, args) => {
    const names = Object.keys(args);
    const r = await db.query(`select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`,
      names.map((n) => (args[n] !== null && typeof args[n] === 'object' ? JSON.stringify(args[n]) : args[n])));
    return r.rows[0].v;
  };

  // 班表：今天起 50 天，每人大約 45% 有空、8% 野放（蘿蔔留給試玩的人自己填一部分）
  const rand = rng(20261026);
  for (const name of TEAM) {
    await as(name);
    const changes = [];
    for (let i = 0; i < 50; i++) {
      const day = addDays(today, i);
      const r = rand();
      if (name === '蘿蔔' && i > 20) continue;
      if (r < 0.45) changes.push({ day, state: 'free' });
      else if (r < 0.53) changes.push({ day, state: 'wild' });
    }
    await call('set_availability', { changes });
  }

  const wage = (n, w) => ({ member_id: ids[n], wage: w });

  // 長苓的火柴：邀了蘿蔔，讓試玩的人一進來就有一張邀請可以回
  await as('長苓');
  await call('ignite', {
    p: {
      area: '大安區', job_type: '整理', start_time: '09:00', end_time: '16:00', address: '[詳細地址]',
      days: [{ day: addDays(today, 9), need: 3, self_on: true,
        people: [wage('蘿蔔', 300), wage('Kiwi', 280), wage('守宜', 280), wage('沂諠', 260)] }],
    },
  });

  // 蘿蔔的火柴：兩天的案子，第一天已有人確認、第二天還在找人
  await as('蘿蔔');
  await call('ignite', {
    p: {
      area: '中山區', job_type: '打包＋上架', start_time: '09:00', end_time: '17:00', address: '[詳細地址]',
      days: [
        { day: addDays(today, 12), need: 3, self_on: true,
          people: [{ ...wage('丹哥', 280), direct: true }, wage('小薇', 280), wage('倇寧', 260), wage('子柔', 260)] },
        { day: addDays(today, 13), need: 3, self_on: false,
          people: [wage('丹哥', 280), wage('小薇', 280), wage('怡靜', 260), wage('巧芙', 260)] },
      ],
    },
  });

  // 小薇回覆了蘿蔔的邀請
  await as('小薇');
  const inv = await db.query(
    `select a.id from assignments a join members m on m.id = a.member_id join case_days d on d.id = a.case_day_id
      where m.name = '小薇' and a.state = 'invited' and d.day = $1`, [addDays(today, 12)]);
  if (inv.rows[0]) await call('respond_invite', { p_assignment: inv.rows[0].id, p_accept: true });

  // 霈恩的火柴：已額滿的一般案子
  await as('霈恩');
  await call('ignite', {
    p: {
      area: '信義區', job_type: '上架',
      days: [{ day: addDays(today, 6), need: 2, self_on: true, people: [{ ...wage('沛佳', 270), direct: true }] }],
    },
  });

  return { adminId: ids['蘿蔔'], now: nowIso };
}
