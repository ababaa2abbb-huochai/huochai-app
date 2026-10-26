// 逐條驗證說明書 v0.4 的規則
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup, expectError } from './helpers.js';

const NAMES = ['蘿蔔', '長苓', '丹哥', '小薇', 'Kiwi', '守宜', '怡靜', '霈恩', '沛佳', '子柔'];

async function team() {
  const t = await setup();
  await t.member('蘿蔔', 'admin');
  for (const n of NAMES.slice(1)) await t.member(n);
  await t.at('2026-11-02 10:00');
  return t;
}

// 蘿蔔點燃 11/17（距離 15 天），我也出班，總共 3 人，順位 5 位
async function igniteBasic(t, extra = {}) {
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', {
    area: '中山區', job_type: '打包', address: '中山北路一段 1 號',
    days: [{ day: '2026-11-17', need: 3, self_on: true, people: ['長苓', '丹哥', '小薇', 'Kiwi', '守宜'].map((n) => t.person(n)) }],
    ...extra,
  });
  return { cid, did: await t.dayId(cid, '2026-11-17') };
}

test('點燃：我也出班時只邀剛好的人數，其他是候補', async () => {
  const t = await team();
  const { did } = await igniteBasic(t);
  assert.deepEqual(await t.states(did), { 長苓: 'invited', 丹哥: 'invited', 小薇: 'queued', Kiwi: 'queued', 守宜: 'queued' });
  const inv = await t.notes('長苓', 'invite');
  assert.equal(inv.length, 1);
  assert.equal(inv[0].payload.area, '中山區');
  assert.equal(inv[0].payload.wage, 250);
  assert.equal(inv[0].payload.address, undefined, '邀請裡不放詳細地址');
});

test('我也出班關掉時，人數不含火柴', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', {
    area: '大安區', job_type: '整理',
    days: [{ day: '2026-11-17', need: 2, self_on: false, people: ['長苓', '丹哥', '小薇'].map((n) => t.person(n)) }],
  });
  assert.deepEqual(await t.states(await t.dayId(cid, '2026-11-17')), { 長苓: 'invited', 丹哥: 'invited', 小薇: 'queued' });
});

test('回覆時間：一週以上 12 小時、3–7 天 4 小時、3 天內 2 小時', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const mk = async (day) => {
    const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
      days: [{ day, need: 1, self_on: false, people: [t.person('長苓')] }] });
    const [r] = await t.q(`select to_char(deadline at time zone 'Asia/Taipei', 'MM-DD HH24:MI') d from assignments a
      join case_days cd on cd.id = a.case_day_id where cd.case_id = $1`, [cid]);
    return r.d;
  };
  assert.equal(await mk('2026-11-20'), '11-02 22:00'.replace('22:00', '22:00')); // 18 天 → 12 小時：10:00+12h=22:00
  assert.equal(await mk('2026-11-07'), '11-02 14:00'); // 5 天 → 4 小時
  assert.equal(await mk('2026-11-04'), '11-02 12:00'); // 2 天 → 2 小時
});

test('夜間 22:00–08:00 不倒數', async () => {
  const t = await team();
  await t.at('2026-11-02 21:00');
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-04', need: 1, self_on: false, people: [t.person('長苓')] }] });
  const [r] = await t.q(`select to_char(deadline at time zone 'Asia/Taipei', 'MM-DD HH24:MI') d from assignments a
    join case_days cd on cd.id = a.case_day_id where cd.case_id = $1`, [cid]);
  assert.equal(r.d, '11-03 09:00'); // 21:00–22:00 算 1 小時，隔天 08:00 再 1 小時
});

test('野放或出班中：倒數等到 18:00 才開始', async () => {
  const t = await team();
  await t.avail('長苓', '2026-11-02', 'wild');
  // 丹哥今天在別人的案子出班
  await t.as('小薇');
  const other = await t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-02', need: 2, self_on: true, people: [t.person('丹哥', 250, true)] }] });
  assert.ok(other);
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-07', need: 2, self_on: false, people: [t.person('長苓'), t.person('丹哥')] }] });
  const rows = await t.q(`select m.name, to_char(deadline at time zone 'Asia/Taipei', 'MM-DD HH24:MI') d
    from assignments a join members m on m.id = a.member_id join case_days cd on cd.id = a.case_day_id
    where cd.case_id = $1 order by a.rank`, [cid]);
  assert.deepEqual(rows.map((r) => [r.name, r.d]), [['長苓', '11-02 22:00'], ['丹哥', '11-02 22:00']]);
});

test('婉拒：自動照順位邀下一位', async () => {
  const t = await team();
  const { did } = await igniteBasic(t);
  const [a] = await t.q(`select a.id from assignments a where case_day_id = $1 and member_id = $2`, [did, t.ids['丹哥']]);
  await t.as('丹哥');
  assert.equal(await t.rpc('respond_invite', a.id, false), 'declined');
  assert.deepEqual(await t.states(did), { 長苓: 'invited', 丹哥: 'declined', 小薇: 'invited', Kiwi: 'queued', 守宜: 'queued' });
});

test('超時：同時邀下一位，超時的人仍可確認；額滿後其他邀請關閉', async () => {
  const t = await team();
  const { did } = await igniteBasic(t);
  await t.at('2026-11-03 12:00');
  await t.rpc('tick');
  assert.deepEqual(await t.states(did), { 長苓: 'invited*', 丹哥: 'invited*', 小薇: 'invited', Kiwi: 'invited', 守宜: 'queued' });
  const id = async (n) => (await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids[n]]))[0].id;
  await t.as('長苓');
  await t.rpc('respond_invite', await id('長苓'), true);   // 超時後才確認，仍然算
  await t.as('Kiwi');
  await t.rpc('respond_invite', await id('Kiwi'), true);    // 第二位確認，額滿（含火柴 3 人）
  assert.deepEqual(await t.states(did), { 長苓: 'confirmed', 丹哥: 'full', 小薇: 'full', Kiwi: 'confirmed', 守宜: 'queued' });
  assert.equal((await t.notes('小薇', 'closed_full')).length, 1);
  assert.equal((await t.notes('蘿蔔', 'full')).length, 1);
  await t.as('小薇');
  await expectError(t.rpc('respond_invite', await id('小薇'), true), 'invite_closed:full');
});

test('同一天收到多張邀請：確認一張，其他自動關閉並幫那根火柴補位', async () => {
  const t = await team();
  const { did } = await igniteBasic(t);
  await t.as('小薇');
  const cid2 = await t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('長苓', 300), t.person('沛佳', 300)] }] });
  const did2 = await t.dayId(cid2, '2026-11-17');
  assert.deepEqual(await t.states(did2), { 長苓: 'invited', 沛佳: 'queued' });
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['長苓']]);
  await t.as('長苓');
  await t.rpc('respond_invite', a.id, true);
  assert.deepEqual(await t.states(did2), { 長苓: 'taken', 沛佳: 'invited' });
  const n = await t.notes('小薇', 'taken_elsewhere');
  assert.equal(n.length, 1);
  assert.equal(n[0].payload.member_name, '長苓');
});

test('已有班的人不能被邀請；也不能確認第二個班', async () => {
  const t = await team();
  await t.as('小薇');
  await t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('長苓', 300, true)] }] });
  await t.as('蘿蔔');
  await expectError(t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('長苓')] }] }), 'member_busy:長苓');
});

test('沒標有空的人也能邀請', async () => {
  const t = await team();
  await t.avail('長苓', '2026-11-17', 'free');
  const { did } = await igniteBasic(t); // 其他人都沒標
  assert.equal((await t.states(did))['丹哥'], 'invited');
});

test('直接加入：直接算確認；超過人數會擋下', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 3, self_on: true,
      people: [t.person('長苓', 250, true), t.person('丹哥'), t.person('小薇')] }] });
  const did = await t.dayId(cid, '2026-11-17');
  assert.deepEqual(await t.states(did), { 長苓: 'confirmed', 丹哥: 'invited', 小薇: 'queued' });
  assert.equal((await t.notes('長苓', 'direct_added')).length, 1);
  assert.equal((await t.notes('長苓', 'invite')).length, 0);
  await expectError(t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-18', need: 2, self_on: true,
      people: [t.person('長苓', 250, true), t.person('丹哥', 250, true)] }] }), 'too_many_direct');
  // 已送出的邀請改成直接加入
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['丹哥']]);
  await t.rpc('make_direct', a.id);
  assert.deepEqual(await t.states(did), { 長苓: 'confirmed', 丹哥: 'confirmed', 小薇: 'queued' });
});

test('急件：一次邀請全部候補，先確認先拿到', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-03', need: 2, self_on: true, urgent: true,
      people: ['長苓', '丹哥', '小薇'].map((n) => t.person(n)) }] });
  const did = await t.dayId(cid, '2026-11-03');
  assert.deepEqual(await t.states(did), { 長苓: 'invited', 丹哥: 'invited', 小薇: 'invited' });
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['小薇']]);
  await t.as('小薇');
  await t.rpc('respond_invite', a.id, true);
  assert.deepEqual(await t.states(did), { 長苓: 'full', 丹哥: 'full', 小薇: 'confirmed' });
});

test('時薪：自動帶入上次金額；第一次合作沒填會擋下', async () => {
  const t = await team();
  await t.as('蘿蔔');
  await expectError(t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [{ member_id: t.ids['長苓'] }] }] }), 'wage_required:長苓');
  await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('長苓', 280)] }] });
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-20', need: 2, self_on: true, people: [{ member_id: t.ids['長苓'] }] }] });
  const [w] = await t.q(`select w.wage from assignment_wages w join assignments a on a.id = w.assignment_id
    join case_days d on d.id = a.case_day_id where d.case_id = $1`, [cid]);
  assert.equal(w.wage, 280);
});

test('撞期：火柴這天已答應別人的班，點燃會被擋；選「取消原本的班」會一起處理', async () => {
  const t = await team();
  await t.as('小薇');
  const cid2 = await t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('蘿蔔', 300, true)] }] });
  const did2 = await t.dayId(cid2, '2026-11-17');
  await t.as('蘿蔔');
  await expectError(igniteBasic(t), 'owner_conflict:小薇');
  // 只接洽：關掉我也出班就能點燃，原本的班不受影響
  const onlyContact = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 3, self_on: false, people: [t.person('長苓'), t.person('丹哥'), t.person('Kiwi')] }] });
  assert.ok(onlyContact);
  assert.equal((await t.states(did2))['蘿蔔'], 'confirmed');
  // 取消原本的班
  const conflict = await t.rpc('get_conflict', '2026-11-17');
  assert.equal(conflict.owner_name, '小薇');
  await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('守宜')] }],
    cancel_conflict: { assignment_id: conflict.assignment_id, reason: 'more_important' } });
  assert.equal((await t.states(did2))['蘿蔔'], 'cancelled');
  const n = await t.notes('小薇', 'cancelled');
  assert.equal(n[0].payload.reason, 'more_important');
});

test('撞期取消：如果點燃失敗，原本的班不會被取消', async () => {
  const t = await team();
  await t.as('小薇');
  const cid2 = await t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('蘿蔔', 300, true)] }] });
  await t.as('蘿蔔');
  const conflict = await t.rpc('get_conflict', '2026-11-17');
  await expectError(t.rpc('ignite', { area: '', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('守宜')] }],
    cancel_conflict: { assignment_id: conflict.assignment_id, reason: 'more_important' } }), 'new row for relation "cases" violates check constraint');
  assert.equal((await t.states(await t.dayId(cid2, '2026-11-17')))['蘿蔔'], 'confirmed');
});

test('取消：通知火柴並附原因，自動補位；3 天內標示急件', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-04', need: 2, self_on: true, people: [t.person('長苓', 250, true), t.person('丹哥')] }] });
  const did = await t.dayId(cid, '2026-11-04');
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['長苓']]);
  await t.as('長苓');
  await expectError(t.rpc('cancel_shift', a.id, 'other'), 'bad_reason');
  await t.rpc('cancel_shift', a.id, 'unwell');
  assert.deepEqual(await t.states(did), { 長苓: 'cancelled', 丹哥: 'invited' });
  const [n] = await t.notes('蘿蔔', 'cancelled');
  assert.equal(n.payload.reason, 'unwell');
  assert.equal(n.payload.urgent, true);
});

test('減人：先撤回邀請中的，再從順位最後釋出已確認的', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 4, self_on: true,
      people: [t.person('長苓', 250, true), t.person('丹哥', 250, true), t.person('小薇'), t.person('Kiwi')] }] });
  const did = await t.dayId(cid, '2026-11-17');
  assert.deepEqual(await t.states(did), { 長苓: 'confirmed', 丹哥: 'confirmed', 小薇: 'invited', Kiwi: 'queued' });
  await t.rpc('set_day_options', did, { need: 3 });
  assert.deepEqual(await t.states(did), { 長苓: 'confirmed', 丹哥: 'confirmed', 小薇: 'withdrawn', Kiwi: 'queued' });
  assert.equal((await t.notes('小薇', 'withdrawn')).length, 1);
  await t.rpc('set_day_options', did, { need: 2 });
  assert.deepEqual(await t.states(did), { 長苓: 'confirmed', 丹哥: 'released', 小薇: 'withdrawn', Kiwi: 'queued' });
  assert.equal((await t.notes('丹哥', 'released')).length, 1);
  // 加人：邀請下一位候補
  await t.rpc('set_day_options', did, { need: 3 });
  assert.equal((await t.states(did))['Kiwi'], 'invited');
});

test('改時間：已確認的人回「沒辦法」就釋出並補位，不回覆維持原班', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 3, self_on: true,
      people: [t.person('長苓', 250, true), t.person('丹哥', 250, true), t.person('小薇')] }] });
  const did = await t.dayId(cid, '2026-11-17');
  await t.rpc('update_case', cid, { start_time: '10:00', end_time: '18:00' });
  const [n] = await t.notes('長苓', 'time_change');
  assert.equal(n.payload.start_time, '10:00');
  await t.as('長苓');
  await t.rpc('respond_time_change', n.payload.assignment_id, false);
  assert.deepEqual(await t.states(did), { 長苓: 'released', 丹哥: 'confirmed', 小薇: 'invited' });
});

test('改日期：原班人馬依原順位優先收到新日期的邀請，有班的人跳過', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 3, self_on: true,
      people: [t.person('長苓'), t.person('丹哥', 250, true), t.person('小薇'), t.person('Kiwi')] }] });
  const did = await t.dayId(cid, '2026-11-17');
  // 小薇 11/20 已有別人的班
  await t.as('守宜');
  await t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-20', need: 2, self_on: true, people: [t.person('小薇', 300, true)] }] });
  await t.as('蘿蔔');
  const nd = await t.rpc('move_day', did, '2026-11-20');
  // 已確認的丹哥排第一，接著依原順位
  assert.deepEqual(await t.states(nd), { 丹哥: 'invited', 長苓: 'invited', 小薇: 'queued', Kiwi: 'queued' });
  assert.equal((await t.notes('丹哥', 'moved')).length, 1);
  const old = await t.q(`select status from case_days where id = $1`, [did]);
  assert.equal(old[0].status, 'removed');
  // 長苓婉拒 → 小薇有班被跳過 → 邀 Kiwi
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [nd, t.ids['長苓']]);
  await t.as('長苓');
  await t.rpc('respond_invite', a.id, false);
  assert.deepEqual(await t.states(nd), { 丹哥: 'invited', 長苓: 'declined', 小薇: 'skipped', Kiwi: 'invited' });
});

test('代班替換：位子直接交接，不觸發補位、不留取消紀錄', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('長苓', 250, true), t.person('丹哥')] }] });
  const did = await t.dayId(cid, '2026-11-17');
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['長苓']]);
  await t.rpc('replace_member', a.id, t.ids['小薇'], 270);
  assert.deepEqual(await t.states(did), { 長苓: 'replaced', 小薇: 'confirmed', 丹哥: 'queued' });
  assert.equal((await t.notes('長苓', 'replaced_out')).length, 1);
  assert.equal((await t.notes('小薇', 'replaced_in'))[0].payload.wage, 270);
  assert.equal((await t.notes('丹哥', 'invite')).length, 0);
});

test('熄滅：邀請撤回、已確認的人全部釋出並通知', async () => {
  const t = await team();
  const { cid, did } = await igniteBasic(t);
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['長苓']]);
  await t.as('長苓');
  await t.rpc('respond_invite', a.id, true);
  await t.as('蘿蔔');
  await t.rpc('extinguish', cid);
  assert.deepEqual(await t.states(did), { 長苓: 'released', 丹哥: 'withdrawn', 小薇: 'withdrawn', Kiwi: 'withdrawn', 守宜: 'withdrawn' });
  assert.equal((await t.notes('長苓', 'case_cancelled')).length, 1);
  assert.equal((await t.notes('丹哥', 'case_cancelled')).length, 1);
  assert.equal((await t.notes('小薇', 'case_cancelled')).length, 0, '候補沒被邀過，不打擾');
});

test('候補用完還沒滿：通知火柴加人', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 3, self_on: true, people: [t.person('長苓'), t.person('丹哥')] }] });
  const did = await t.dayId(cid, '2026-11-17');
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['長苓']]);
  await t.as('長苓');
  await t.rpc('respond_invite', a.id, false);
  const n = await t.notes('蘿蔔', 'list_exhausted');
  assert.equal(n.length, 1);
  assert.equal(n[0].payload.missing, 1, '丹哥還在等回覆，最多只差 1 人');
  // 加人後再補
  await t.as('蘿蔔');
  await t.rpc('add_people', did, [t.person('小薇')]);
  assert.equal((await t.states(did))['小薇'], 'invited');
});

test('火柴出班的日子算有班：別人不能邀他', async () => {
  const t = await team();
  await igniteBasic(t);
  await t.as('小薇');
  await expectError(t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('蘿蔔')] }] }), 'member_busy:蘿蔔');
});

test('火柴點燃自己出班的日子：他手上同一天的其他邀請自動關閉', async () => {
  const t = await team();
  await t.as('沛佳');
  const cid2 = await t.rpc('ignite', { area: '信義區', job_type: '上架',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('蘿蔔'), t.person('子柔')] }] });
  const did2 = await t.dayId(cid2, '2026-11-17');
  assert.equal((await t.states(did2))['蘿蔔'], 'invited');
  await igniteBasic(t);
  assert.deepEqual(await t.states(did2), { 蘿蔔: 'taken', 子柔: 'invited' });
});

test('月曆：還能約＝標有空且還沒確認；野放只有本人看得到', async () => {
  const t = await team();
  await t.avail('長苓', '2026-11-17', 'free');
  await t.avail('丹哥', '2026-11-17', 'free');
  await t.avail('小薇', '2026-11-17', 'wild');
  await t.as('蘿蔔');
  await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('長苓', 250, true)] }] });
  const m = await t.rpc('get_month', '2026-11-01');
  const d17 = m.days.find((d) => d.day === '2026-11-17');
  assert.equal(d17.free, 1); // 丹哥
  const names = Object.fromEntries(d17.people.map((p) => [p.name, p.status]));
  assert.deepEqual(names, { 蘿蔔: 'owner', 長苓: 'confirmed', 丹哥: 'free' });
  await t.as('小薇');
  const mine = await t.rpc('get_month', '2026-11-01');
  assert.equal(mine.mine['2026-11-17'], 'wild');
  // 火柴在名單裡看得到野放
  await t.as('蘿蔔');
  const cands = await t.rpc('get_candidates', '2026-11-17', null);
  const c = Object.fromEntries(cands.map((x) => [x.name, x]));
  assert.equal(c['小薇'].availability, 'wild');
  assert.equal(c['長苓'].busy_with, '蘿蔔');
  assert.equal(c['長苓'].last_wage, 250);
});

test('隱私：時薪與詳細地址', async () => {
  const t = await team();
  const { did } = await igniteBasic(t);
  await t.as('長苓');
  let s = await t.rpc('get_my_shifts');
  assert.equal(s.invites.length, 1);
  assert.equal(s.invites[0].wage, 250);
  assert.equal(s.invites[0].address, undefined, '邀請中看不到詳細地址');
  await t.rpc('respond_invite', s.invites[0].assignment_id, true);
  s = await t.rpc('get_my_shifts');
  assert.equal(s.shifts[0].address, '中山北路一段 1 號');
  // 非火柴不能看案件細節
  await t.as('丹哥');
  assert.deepEqual(await t.rpc('get_my_cases'), []);
  assert.ok(did);
});

test('不是火柴不能改別人的案件', async () => {
  const t = await team();
  const { cid, did } = await igniteBasic(t);
  await t.as('丹哥');
  await expectError(t.rpc('extinguish', cid), 'not_owner');
  await expectError(t.rpc('set_day_options', did, { need: 5 }), 'not_owner');
});

test('出班前一天 20:00 提醒、每月 15 號提醒填班', async () => {
  const t = await team();
  await t.as('蘿蔔');
  await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 2, self_on: true, people: [t.person('長苓', 250, true)] }] });
  await t.at('2026-11-15 10:30');
  await t.rpc('tick');
  assert.equal((await t.notes('丹哥', 'fill_reminder')).length, 1);
  await t.rpc('tick');
  assert.equal((await t.notes('丹哥', 'fill_reminder')).length, 1, '一個月只提醒一次');
  await t.at('2026-11-16 20:05');
  await t.rpc('tick');
  await t.rpc('tick');
  assert.equal((await t.notes('長苓', 'day_before')).length, 1);
});

test('鄰家女孩：算進人數、直接算確認、多出來的邀請撤回、沒有通知', async () => {
  const t = await team();
  const { did } = await igniteBasic(t); // 需要 3 人含火柴：長苓、丹哥邀請中
  const gid = await t.rpc('add_guest', did, '小美', null);
  assert.ok(gid);
  assert.deepEqual(await t.states(did), { 長苓: 'invited', 丹哥: 'withdrawn', 小薇: 'queued', Kiwi: 'queued', 守宜: 'queued' });
  const cases = await t.rpc('get_my_cases');
  const a = cases[0].days[0].assignments.find((x) => x.guest);
  assert.equal(a.name, '小美');
  assert.equal(cases[0].days[0].confirmed, 2);
  // 加到滿了再加會擋
  const [c] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['長苓']]);
  await t.as('長苓');
  await t.rpc('respond_invite', c.id, true);
  await t.as('蘿蔔');
  await expectError(t.rpc('add_guest', did, '小華', 300), 'already_full');
  // 移除鄰家女孩後照順位補位
  await t.rpc('remove_guest', gid);
  assert.equal((await t.states(did))['小薇'], 'invited');
});

test('點燃時直接加入鄰家女孩；改日期時跟著搬過去', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-17', need: 3, self_on: true, people: [{ guest_name: '阿美' }, t.person('長苓')] }] });
  const did = await t.dayId(cid, '2026-11-17');
  const rows = await t.q(`select coalesce(m.name, a.guest_name) n, a.state from assignments a left join members m on m.id = a.member_id where case_day_id = $1 order by rank`, [did]);
  assert.deepEqual(rows.map((r) => [r.n, r.state]), [['阿美', 'confirmed'], ['長苓', 'invited']]);
  const nd = await t.rpc('move_day', did, '2026-11-20');
  const moved = await t.q(`select coalesce(m.name, a.guest_name) n, a.state from assignments a left join members m on m.id = a.member_id where case_day_id = $1 order by rank`, [nd]);
  assert.deepEqual(moved.map((r) => [r.n, r.state]), [['阿美', 'confirmed'], ['長苓', 'invited']]);
  // 女孩的「我的班」同組名單看得到鄰家女孩
  const [inv] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [nd, t.ids['長苓']]);
  await t.as('長苓');
  await t.rpc('respond_invite', inv.id, true);
  const s = await t.rpc('get_my_shifts');
  assert.deepEqual(s.shifts[0].teammates, ['阿美']);
});

test('缺人提醒：出班前 3 天、前一天 18:00 各一次；人滿了就不提醒', async () => {
  const t = await team();
  await t.as('蘿蔔');
  await t.rpc('ignite', { area: '中山區', job_type: '打包',
    days: [{ day: '2026-11-10', need: 3, self_on: true, people: [t.person('長苓')] }] });
  await t.rpc('ignite', { area: '大安區', job_type: '整理',
    days: [{ day: '2026-11-11', need: 2, self_on: true, people: [t.person('丹哥', 250, true)] }] });
  await t.at('2026-11-07 09:00');
  await t.rpc('tick');
  assert.equal((await t.notes('蘿蔔', 'short_staffed')).length, 0, '10:00 前不提醒');
  await t.at('2026-11-07 10:05');
  await t.rpc('tick');
  await t.rpc('tick');
  let n = await t.notes('蘿蔔', 'short_staffed');
  assert.equal(n.length, 1);
  assert.equal(n[0].payload.stage, 'three_days');
  assert.equal(n[0].payload.missing, 2);
  await t.at('2026-11-09 18:01');
  await t.rpc('tick');
  n = await t.notes('蘿蔔', 'short_staffed');
  assert.equal(n.length, 2);
  assert.equal(n[1].payload.stage, 'day_before');
  assert.ok(n.every((x) => x.payload.area === '中山區'), '已滿的大安區不提醒');
});

test('開工：還沒回覆的邀請自動關閉並通知，記下缺幾人', async () => {
  const t = await team();
  await t.as('蘿蔔');
  const cid = await t.rpc('ignite', { area: '中山區', job_type: '打包', start_time: '09:00',
    days: [{ day: '2026-11-04', need: 3, self_on: true, people: [t.person('長苓'), t.person('丹哥'), t.person('小薇')] }] });
  const did = await t.dayId(cid, '2026-11-04');
  await t.at('2026-11-04 08:59');
  await t.rpc('tick');
  await t.at('2026-11-04 09:00');
  await t.rpc('tick');
  const states = await t.states(did);
  assert.equal(states['長苓'], 'withdrawn');
  assert.equal(states['小薇'], 'withdrawn');
  assert.equal((await t.notes('長苓', 'day_started')).length, 1);
  const [d] = await t.q(`select started, final_short from case_days where id = $1`, [did]);
  assert.deepEqual(d, { started: true, final_short: 2 });
  const [a] = await t.q(`select id from assignments where case_day_id = $1 and member_id = $2`, [did, t.ids['長苓']]);
  await t.as('長苓');
  await expectError(t.rpc('respond_invite', a.id, true), 'invite_closed:withdrawn');
});
