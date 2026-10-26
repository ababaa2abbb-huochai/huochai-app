// 測試工具：用 PGlite 在記憶體裡跑一個真的 Postgres，載入同一份 migrations
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

export function migrationSql() {
  const dir = join(root, 'supabase', 'migrations');
  return readdirSync(dir)
    .filter((f) => /^\d{4}_.*\.sql$/.test(f) && !f.includes('supabase_only'))
    .sort()
    .map((f) => readFileSync(join(dir, f), 'utf8'))
    .join('\n');
}

export async function setup() {
  const db = new PGlite();
  await db.exec(migrationSql());
  const t = {
    db,
    ids: {},
    async member(name, role = 'member') {
      const r = await db.query(
        `insert into members (name, role, status) values ($1, $2, 'active') returning id`, [name, role]);
      t.ids[name] = r.rows[0].id;
      return r.rows[0].id;
    },
    async as(name) {
      await db.query(`select set_config('app.member_id', $1, false)`, [t.ids[name]]);
    },
    async at(local) {
      // local: '2026-11-02 10:00'（台北時間）
      await db.query(`select set_config('app.now', $1, false)`, [`${local}+08`]);
    },
    async rpc(fn, ...args) {
      const ph = args.map((_, i) => `$${i + 1}`).join(', ');
      const r = await db.query(`select ${fn}(${ph}) as v`, args.map((a) =>
        a !== null && typeof a === 'object' ? JSON.stringify(a) : a));
      return r.rows[0].v;
    },
    async q(sql, params = []) {
      return (await db.query(sql, params)).rows;
    },
    async states(caseDayId) {
      const rows = await t.q(
        `select m.name, a.state, a.overdue from assignments a join members m on m.id = a.member_id
          where a.case_day_id = $1 order by a.rank`, [caseDayId]);
      return Object.fromEntries(rows.map((r) => [r.name, r.state + (r.overdue && r.state === 'invited' ? '*' : '')]));
    },
    async dayId(caseId, day) {
      return (await t.q(`select id from case_days where case_id = $1 and day = $2 and status = 'active'`, [caseId, day]))[0]?.id;
    },
    async notes(name, kind) {
      return t.q(`select kind, payload from notifications where member_id = $1 ${kind ? 'and kind = $2' : ''} order by created_at, id`,
        kind ? [t.ids[name], kind] : [t.ids[name]]);
    },
    async avail(name, day, state) {
      await t.as(name);
      await t.rpc('set_availability', [{ day, state }]);
    },
    person(name, wage = 250, direct = false) {
      return { member_id: t.ids[name], wage, direct };
    },
  };
  return t;
}

export async function expectError(promise, code) {
  try {
    await promise;
  } catch (e) {
    if (!String(e.message).startsWith(code)) {
      throw new Error(`預期錯誤 ${code}，實際是 ${e.message}`);
    }
    return e.message;
  }
  throw new Error(`預期錯誤 ${code}，但沒有出錯`);
}
