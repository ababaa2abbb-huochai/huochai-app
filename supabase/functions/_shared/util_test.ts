import { signJwt, verifyLineSignature } from './util.ts';
import { jwtVerify } from 'npm:jose@5.9.6';

Deno.test('登入憑證可以用同一把 JWT Secret 驗證', async () => {
  const secret = 'super-secret-jwt-token-with-at-least-32-characters-long';
  const exp = Math.floor(Date.now() / 1000) + 60;
  const token = await signJwt({ aud: 'authenticated', role: 'authenticated', sub: 'abc', member_id: 'abc', exp }, secret);
  const { payload } = await jwtVerify(token, new TextEncoder().encode(secret), { audience: 'authenticated' });
  if (payload.member_id !== 'abc' || payload.role !== 'authenticated') throw new Error('payload 錯誤');
});

Deno.test('LINE Webhook 簽章：正確的通過、竄改的擋下', async () => {
  const secret = 'channelsecret';
  const body = JSON.stringify({ events: [] });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
  if (!(await verifyLineSignature(body, sig, secret))) throw new Error('應該通過');
  if (await verifyLineSignature(body + ' ', sig, secret)) throw new Error('應該擋下');
  if (await verifyLineSignature(body, null, secret)) throw new Error('沒有簽章應該擋下');
});
