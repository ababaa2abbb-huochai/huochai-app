// 正式版：Supabase 存資料、LINE LIFF 登入
// 設定值來自 .env（見 docs/上線指南.md）
import { createClient } from '@supabase/supabase-js';

const URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;
const LIFF_ID = import.meta.env.VITE_LIFF_ID;
const TOKEN_KEY = 'huochai-session';

let client = null;
let session = null; // { access_token, expires_at, member }
const listeners = new Set();

function loadLiff() {
  return new Promise((resolve, reject) => {
    if (window.liff) return resolve(window.liff);
    const s = document.createElement('script');
    s.src = 'https://static.line-scdn.net/liff/edge/2/sdk.js';
    s.onload = () => resolve(window.liff);
    s.onerror = () => reject(new Error('liff_load_failed'));
    document.head.appendChild(s);
  });
}

function makeClient(token) {
  client = createClient(URL, ANON, {
    global: { headers: token ? { Authorization: `Bearer ${token}` } : {} },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (token) client.realtime.setAuth(token);
}

async function login() {
  const liff = await loadLiff();
  await liff.init({ liffId: LIFF_ID });
  if (!liff.isLoggedIn()) {
    liff.login({ redirectUri: location.href });
    return new Promise(() => {}); // 轉去 LINE 登入
  }
  const idToken = liff.getIDToken();
  const res = await fetch(`${URL}/functions/v1/line-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${ANON}` },
    body: JSON.stringify({ id_token: idToken }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || 'login_failed');
  session = body;
  try {
    sessionStorage.setItem(TOKEN_KEY, JSON.stringify(session));
  } catch {
    /* ignore */
  }
  return session;
}

export const live = {
  isDemo: false,
  liff: null,
  async init() {
    try {
      session = JSON.parse(sessionStorage.getItem(TOKEN_KEY));
    } catch {
      session = null;
    }
    if (!session || session.expires_at * 1000 < Date.now() + 60_000) {
      session = await login();
    }
    makeClient(session.access_token);
    try {
      live.liff = await loadLiff();
    } catch {
      live.liff = null;
    }
    // 跟我有關的資料一變動就重新整理：通知、班表、案件
    client
      .channel('changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'notifications' }, emit)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'assignments' }, emit)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'availability' }, emit)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'case_days' }, emit)
      .subscribe();
    setInterval(emit, 60_000);
  },
  async rpc(fn, args = {}) {
    const { data, error } = await client.rpc(fn, args);
    if (error) {
      if (/JWT expired/i.test(error.message)) {
        sessionStorage.removeItem(TOKEN_KEY);
        location.reload();
      }
      throw new Error(error.message);
    }
    return data;
  },
  async runAction(fn, args) {
    const v = await live.rpc(fn, args);
    emit();
    return v;
  },
  subscribe(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

let pending = null;
function emit() {
  // 短時間內多個變動只重新整理一次
  clearTimeout(pending);
  pending = setTimeout(() => {
    for (const cb of listeners) cb();
  }, 250);
}
