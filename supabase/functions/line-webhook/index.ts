// LINE 官方帳號的 Webhook：處理邀請卡上的「確認出班／婉拒」按鈕
// 回覆用 reply API，不吃每月推播額度
import { json, admin, verifyLineSignature, lineReply } from '../_shared/util.ts';

const CLOSED: Record<string, string> = {
  full: '這天已經額滿了，謝謝你。',
  taken: '你這天已經確認了別的班。',
  withdrawn: '火柴已經撤回這個邀請。',
  declined: '你已經婉拒了。',
  confirmed: '你已經確認了。',
};

function explain(message: string) {
  const [code, arg] = message.split(':');
  if (code === 'invite_closed') return CLOSED[arg] ?? '這個邀請已經關閉了。';
  if (code === 'already_busy') return `你這天已經有 ${arg} 的班了。`;
  if (code === 'not_active') return '你的帳號還沒開通，請找管理者。';
  return '沒辦法完成，請打開小火柴再試一次。';
}

Deno.serve(async (req) => {
  const body = await req.text();
  const ok = await verifyLineSignature(body, req.headers.get('x-line-signature'), Deno.env.get('LINE_CHANNEL_SECRET')!);
  if (!ok) return json({ error: 'bad_signature' }, 401);

  const { events = [] } = JSON.parse(body);
  const db = admin();
  for (const ev of events) {
    if (ev.type !== 'postback' || !ev.source?.userId) continue;
    const [kind, assignmentId, answer] = String(ev.postback?.data ?? '').split(':');
    if (kind !== 'respond') continue;
    const { data, error } = await db.rpc('respond_invite_by_line', {
      p_line_user_id: ev.source.userId, p_assignment: assignmentId, p_accept: answer === 'yes',
    });
    const text = error ? explain(error.message) : data === 'confirmed' ? '已確認出班，火柴會再拉群組布達細節。' : '已婉拒，謝謝你回覆。';
    await lineReply(ev.replyToken, [{ type: 'text', text }]);
  }
  return json({ ok: true });
});
