// 把通知匣裡還沒送的通知送出去。由排程每分鐘呼叫一次。
// 省訊息額度：只有「邀請」「時間變更」「缺人提醒」走 LINE 推播，其他通知留在 App 的鈴鐺裡。
import { json, admin, linePush } from '../_shared/util.ts';

const LIFF_URL = `https://liff.line.me/${Deno.env.get('LIFF_ID')}`;
const PUSH_KINDS = new Set((Deno.env.get('LINE_PUSH_KINDS') ?? 'invite,time_change,short_staffed').split(','));
const WD = ['日', '一', '二', '三', '四', '五', '六'];

function mdw(day: string) {
  const d = new Date(day + 'T00:00:00Z');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}（${WD[d.getUTCDay()]}）`;
}

function row(label: string, value: string, bold = false) {
  return {
    type: 'box', layout: 'baseline', spacing: 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: '#6B645D', flex: 2 },
      { type: 'text', text: value, size: 'sm', color: '#1F1D1B', flex: 6, wrap: true, weight: bold ? 'bold' : 'regular' },
    ],
  };
}

function inviteMessage(p: Record<string, any>) {
  return {
    type: 'flex',
    altText: `${p.owner_name} 邀你 ${mdw(p.day)} 出班`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', backgroundColor: '#C2410C', paddingAll: '16px',
        contents: [{ type: 'text', text: `${p.owner_name} 想邀你出班`, color: '#FFFFFF', weight: 'bold', size: 'md' }],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          row('日期', mdw(p.day), true),
          row('時間', `${p.start_time}–${p.end_time}`),
          row('區域', p.area),
          row('類型', p.job_type),
          row('時薪', `NT$ ${p.wage}（其他夥伴看不到）`, true),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          { type: 'button', style: 'primary', color: '#C2410C',
            action: { type: 'postback', label: '確認出班', data: `respond:${p.assignment_id}:yes`, displayText: '確認出班' } },
          { type: 'button', style: 'secondary',
            action: { type: 'postback', label: '婉拒', data: `respond:${p.assignment_id}:no`, displayText: '婉拒' } },
          { type: 'button', style: 'link', action: { type: 'uri', label: '打開小火柴', uri: `${LIFF_URL}?tab=shifts` } },
        ],
      },
    },
  };
}

function timeChangeMessage(p: Record<string, any>) {
  return {
    type: 'text',
    text: `${p.owner_name} ${mdw(p.day)} 的時間改成 ${p.start_time}–${p.end_time}（原本 ${p.old_start}–${p.old_end}）。\n可以配合嗎？請到小火柴回覆，不回覆就維持原班：${LIFF_URL}?tab=shifts`,
  };
}

function shortMessage(p: Record<string, any>) {
  const head = p.stage === 'day_before' ? `明天 ${mdw(p.day)}` : mdw(p.day);
  return {
    type: 'text',
    text: `${head}（${p.area}・${p.job_type}）還缺 ${p.missing} 人。\n可以改成急件、加人，或找鄰家女孩：${LIFF_URL}?tab=cases`,
  };
}

Deno.serve(async (req) => {
  const auth = req.headers.get('Authorization') ?? '';
  if (auth !== `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` && auth !== `Bearer ${Deno.env.get('CRON_SECRET')}`) {
    return json({ error: 'forbidden' }, 403);
  }
  const db = admin();
  const { data: list, error } = await db.rpc('take_unsent_notifications', { p_limit: 100 });
  if (error) return json({ error: error.message }, 500);

  const done: string[] = [];
  const failed: string[] = [];
  for (const n of list ?? []) {
    try {
      if (PUSH_KINDS.has(n.kind) && n.line_user_id) {
        const msg = n.kind === 'invite' ? inviteMessage(n.payload) : n.kind === 'short_staffed' ? shortMessage(n.payload) : timeChangeMessage(n.payload);
        await linePush(n.line_user_id, [msg]);
      }
      done.push(n.id);
    } catch (e) {
      failed.push(n.id);
      await db.rpc('mark_notifications_sent', { p_ids: [n.id], p_error: String((e as Error).message).slice(0, 300) });
    }
  }
  if (done.length) await db.rpc('mark_notifications_sent', { p_ids: done });
  return json({ sent: done.length, failed: failed.length });
});
