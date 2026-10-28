import { verifyLineSignature } from './util.ts';

Deno.test('LINE Webhook 簽章：正確的通過、竄改的擋下', async () => {
  const secret = 'channelsecret';
  const body = JSON.stringify({ events: [] });
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))));
  if (!(await verifyLineSignature(body, sig, secret))) throw new Error('應該通過');
  if (await verifyLineSignature(body + ' ', sig, secret)) throw new Error('應該擋下');
  if (await verifyLineSignature(body, null, secret)) throw new Error('沒有簽章應該擋下');
});
