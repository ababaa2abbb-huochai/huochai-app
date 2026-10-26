// LINE 登入：驗證 LIFF 拿到的 ID Token，找到（或建立）成員，發一張 12 小時的登入憑證
import { cors, json, admin, signJwt } from '../_shared/util.ts';

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

    const { data: member, error } = await admin().rpc('line_upsert_member', {
      p_line_user_id: profile.sub, p_name: profile.name ?? '',
    });
    if (error) throw error;

    const now = Math.floor(Date.now() / 1000);
    const exp = now + 12 * 3600;
    const access_token = await signJwt({
      aud: 'authenticated', role: 'authenticated', sub: member.id, member_id: member.id, iat: now, exp,
    }, Deno.env.get('APP_JWT_SECRET')!);

    return json({ access_token, expires_at: exp, member });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
