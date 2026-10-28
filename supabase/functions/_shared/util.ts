// Edge Functions 共用工具
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}

// 依序找第一個有設定的環境變數（新版金鑰用自訂名稱，舊版沿用 Supabase 預設的）
export function env(...names: string[]) {
  for (const n of names) {
    const v = Deno.env.get(n);
    if (v) return v;
  }
  throw new Error(`missing env ${names.join(' / ')}`);
}

export function admin() {
  return createClient(env('SUPABASE_URL'), env('SB_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY'), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const enc = new TextEncoder();

function b64url(bytes: Uint8Array) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// 驗證 LINE Webhook 簽章
export async function verifyLineSignature(body: string, signature: string | null, channelSecret: string) {
  if (!signature) return false;
  const sig = await hmac(channelSecret, body);
  let s = '';
  for (const b of sig) s += String.fromCharCode(b);
  return btoa(s) === signature;
}

export async function linePush(to: string, messages: unknown[]) {
  const res = await fetch('https://api.line.me/v2/bot/message/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')}` },
    body: JSON.stringify({ to, messages }),
  });
  if (!res.ok) throw new Error(`LINE ${res.status}: ${await res.text()}`);
}

export async function lineReply(replyToken: string, messages: unknown[]) {
  await fetch('https://api.line.me/v2/bot/message/reply', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${Deno.env.get('LINE_CHANNEL_ACCESS_TOKEN')}` },
    body: JSON.stringify({ replyToken, messages }),
  });
}
