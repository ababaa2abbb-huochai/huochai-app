// LINE 登入：驗證 LIFF 拿到的 ID Token，對應到 Supabase 的登入帳號，回傳一組可自動續期的登入狀態
// 使用 Supabase 自己的登入系統（新版的非對稱金鑰也適用），不需要 JWT Secret
import { createClient } from 'npm:@supabase/supabase-js@2.49.4';
import { cors, json, admin, env } from '../_shared/util.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const { id_token } = await req.json();
    if (!id_token) return json({ error: 'missing_token' }, 400);

    const verify = await fetch('https://api.line.me/oauth2/v2.1/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ id_token, client_id: Deno.env.get('LINE_LOGIN_CHANNEL_ID')! }),
    });
    const profile = await verify.json();
    if (!verify.ok || !profile.sub) return json({ error: 'line_verify_failed' }, 401);

    // 每個 LINE 帳號對應一個 Supabase 登入帳號（信箱只是內部識別用，不會寄信）
    const email = `line-${String(profile.sub).toLowerCase()}@users.huochai.app`;
    const db = admin();
    await db.auth.admin.createUser({ email, email_confirm: true, user_metadata: { line_sub: profile.sub, name: profile.name } })
      .catch(() => null); // 已經有帳號就略過
    const { data: link, error: linkErr } = await db.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkErr || !link?.user) throw linkErr ?? new Error('link_failed');

    const pub = createClient(env('SUPABASE_URL'), env('SB_PUBLISHABLE_KEY', 'SUPABASE_ANON_KEY'), { auth: { persistSession: false } });
    const { data: signed, error: otpErr } = await pub.auth.verifyOtp({ token_hash: link.properties.hashed_token, type: 'email' });
    if (otpErr || !signed.session) throw otpErr ?? new Error('session_failed');

    const { data: member, error } = await db.rpc('line_upsert_member', {
      p_line_user_id: profile.sub, p_name: profile.name ?? '', p_auth_user_id: link.user.id,
    });
    if (error) throw error;

    const s = signed.session;
    return json({ access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at, member });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
