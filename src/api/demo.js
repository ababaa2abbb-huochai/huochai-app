// 試玩模式：在瀏覽器裡跑一個真的 Postgres（PGlite），載入和正式版同一份 SQL 規則。
// 資料存在這台裝置的瀏覽器裡，可以切換身分、快轉時間來試流程。
import { PGlite } from '@electric-sql/pglite';
import schema from '../../supabase/migrations/0001_schema.sql?raw';
import logic from '../../supabase/migrations/0002_logic.sql?raw';
import read from '../../supabase/migrations/0003_read.sql?raw';
import { seedDemo } from './seed.js';

const DB_NAME = 'idb://huochai-demo-v1';
const STATE_KEY = 'huochai-demo-state';

let db = null;
let state = loadState();
const listeners = new Set();

function loadState() {
  try {
    return JSON.parse(localStorage.getItem(STATE_KEY)) || {};
  } catch {
    return {};
  }
}
function saveState() {
  try {
    localStorage.setItem(STATE_KEY, JSON.stringify(state));
  } catch {
    /* 私密瀏覽等情況存不了，照樣可以用 */
  }
}

async function open(fresh) {
  let d;
  try {
    d = fresh ? new PGlite() : new PGlite(DB_NAME);
    await d.waitReady;
  } catch {
    d = new PGlite();
    await d.waitReady;
  }
  const has = await d.query(`select to_regclass('public.members') is not null as ok`);
  if (!has.rows[0].ok) {
    await d.exec(schema + '\n' + logic + '\n' + read);
    const seeded = await seedDemo(d);
    state = { memberId: seeded.adminId, now: seeded.now };
    saveState();
  } else {
    // 規則有更新時重新載入函式（資料保留）
    await d.exec(logic + '\n' + read);
  }
  return d;
}

async function applySession() {
  await db.query(`select set_config('app.member_id', $1, false), set_config('app.now', $2, false)`,
    [state.memberId || '', state.now || '']);
}

export const demo = {
  isDemo: true,
  async init() {
    db = await open(false);
    if (!state.memberId) {
      const r = await db.query(`select id from members where role = 'admin' order by created_at limit 1`);
      state.memberId = r.rows[0]?.id;
      saveState();
    }
    await applySession();
    await demo.rpc('tick');
  },
  async rpc(fn, args = {}) {
    const names = Object.keys(args);
    const sql = names.length
      ? `select ${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as v`
      : `select ${fn}() as v`;
    const vals = names.map((n) => {
      const v = args[n];
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : v;
    });
    const r = await db.query(sql, vals);
    return r.rows[0].v;
  },
  async runAction(fn, args) {
    await db.exec('begin');
    try {
      const v = await demo.rpc(fn, args);
      await db.exec('commit');
      emit();
      return v;
    } catch (e) {
      await db.exec('rollback');
      throw e;
    }
  },
  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
  // 試玩專用
  async listIdentities() {
    const r = await db.query(`select id, name, role from members where status = 'active' order by created_at, name`);
    return r.rows;
  },
  currentId() {
    return state.memberId;
  },
  async switchTo(memberId) {
    state.memberId = memberId;
    saveState();
    await applySession();
    emit();
  },
  nowIso() {
    return state.now;
  },
  async advance(hours) {
    const base = state.now ? new Date(state.now) : new Date();
    state.now = new Date(base.getTime() + hours * 3600 * 1000).toISOString();
    saveState();
    await applySession();
    await db.exec('begin');
    await demo.rpc('tick');
    await db.exec('commit');
    emit();
  },
  async reset() {
    try {
      await db.close();
    } catch {
      /* ignore */
    }
    await new Promise((resolve) => {
      try {
        const req = indexedDB.deleteDatabase('/pglite/huochai-demo-v1');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      } catch {
        resolve();
      }
    });
    state = {};
    saveState();
    db = await open(false);
    await applySession();
    emit();
  },
};

function emit() {
  for (const cb of listeners) cb();
}
