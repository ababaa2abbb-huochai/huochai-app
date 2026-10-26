import { useState } from 'preact/hooks';
import { useApp, useData, useAction, Sheet, Flame } from '../ui.jsx';
import { REASONS, mdw, remaining, twTime, twDay, parseDay } from '../lib/text.js';

export function Shifts() {
  const [data, error] = useData('get_my_shifts');
  const [cancel, setCancel] = useState(null);
  const { today } = useApp();
  if (error) return <p class="empty">{error}</p>;
  if (!data) return <p class="empty">讀取中…</p>;
  return (
    <div class="pad stack" style="gap:16px">
      <h1 class="page">我的班</h1>
      {data.invites.length > 0 && <h2>等你回覆（{data.invites.length}）</h2>}
      {data.invites.map((x) => <InviteCard x={x} />)}
      <h2 style="margin-top:6px">接下來的班</h2>
      {data.shifts.length === 0 && <p class="note">還沒有確認的班。月曆上標好有空，火柴就找得到你。</p>}
      {data.shifts.map((x) => <ShiftCard x={x} onCancel={() => setCancel(x)} />)}
      {cancel && <CancelSheet x={cancel} today={today} onClose={() => setCancel(null)} />}
    </div>
  );
}

function InviteCard({ x }) {
  const { now } = useApp();
  const [run, busy] = useAction();
  const left = remaining(x.deadline, now);
  const evening = twDay(x.deadline) === twDay(now) && twTime(x.deadline) >= '18:00' && twTime(now) < '18:00';
  let status;
  if (!left || x.overdue) status = '已過回覆時間，但還沒額滿，現在確認仍然有效';
  else if (evening) status = `你今天在忙（出班中或野放），倒數到 18:00 才開始・${twTime(x.deadline)} 前回覆`;
  else status = `請在 ${left} 內回覆`;
  return (
    <article class="card">
      <div class="card-head"><Flame size={18} />{x.owner_name} 想邀你出班</div>
      <div class="card-body">
        <dl class="facts">
          <dt>日期</dt><dd><b>{mdw(x.day)}</b></dd>
          <dt>時間</dt><dd>{x.start_time}–{x.end_time}</dd>
          <dt>區域</dt><dd>{x.area}</dd>
          <dt>類型</dt><dd>{x.job_type}</dd>
          <dt>時薪</dt><dd><b>NT$ {x.wage}</b><div class="small muted">其他夥伴看不到</div></dd>
          <dt>人數</dt><dd>已確認 {x.confirmed} / {x.need}</dd>
        </dl>
        <div class="box ember" style="padding:8px 12px;font-size:12px">{status}</div>
        <div class="row">
          <button class="btn" style="flex:1;height:48px;border-radius:12px" disabled={busy}
            onClick={() => run('respond_invite', { p_assignment: x.assignment_id, p_accept: false }, '已婉拒')}>婉拒</button>
          <button class="btn primary" style="flex:2;height:48px;border-radius:12px" disabled={busy}
            onClick={() => run('respond_invite', { p_assignment: x.assignment_id, p_accept: true }, `已確認 ${mdw(x.day)}的班`)}>確認出班</button>
        </div>
      </div>
    </article>
  );
}

function ShiftCard({ x, onCancel }) {
  const [run, busy] = useAction();
  const owner = x.role === 'owner';
  return (
    <article class="card">
      <div class="card-head calm">
        <b style="flex:1">{mdw(x.day)}　{x.start_time}–{x.end_time}</b>
        <span class="chip dark">{owner ? '我是主整' : `${x.owner_name} 的班`}</span>
      </div>
      <div class="card-body">
        <dl class="facts">
          <dt>地點</dt><dd>{x.area}{x.address ? `・${x.address}` : ''}</dd>
          <dt>類型</dt><dd>{x.job_type}</dd>
          {!owner && <><dt>時薪</dt><dd>NT$ {x.wage}</dd></>}
          <dt>同組</dt><dd>{[...(owner ? [] : [x.owner_name]), ...(x.teammates || [])].join('、') || '還在找人'}</dd>
        </dl>
        {x.time_change_pending && (
          <div class="box ember stack" style="gap:8px">
            <b>時間改成 {x.start_time}–{x.end_time}，你可以配合嗎？</b>
            <div class="row">
              <button class="btn" style="flex:1" disabled={busy}
                onClick={() => run('respond_time_change', { p_assignment: x.assignment_id, p_ok: false }, '已回覆無法配合，這個班已釋出')}>沒辦法</button>
              <button class="btn primary" style="flex:1" disabled={busy}
                onClick={() => run('respond_time_change', { p_assignment: x.assignment_id, p_ok: true }, '已回覆可以配合')}>沒問題</button>
            </div>
            <span class="small">不回覆就維持原班。</span>
          </div>
        )}
        {!owner && <button class="link" style="align-self:flex-start" onClick={onCancel}>取消這個班</button>}
      </div>
    </article>
  );
}

function CancelSheet({ x, today, onClose }) {
  const [run, busy] = useAction();
  const soon = (parseDay(x.day) - parseDay(today)) / 86400000 < 3;
  return (
    <Sheet title={`取消 ${mdw(x.day)}的班`} onClose={onClose}>
      <p class="note">{x.owner_name} 會立刻收到通知，系統同時開始補位。如果你已經找到人代班，請直接跟 {x.owner_name} 說，讓火柴用「替換」處理。</p>
      {soon && <div class="box ember">出班前 3 天內取消，建議也直接打給 {x.owner_name} 說一聲。</div>}
      {Object.entries(REASONS).map(([k, v]) => (
        <button class="option" disabled={busy} onClick={async () => {
          if (await run('cancel_shift', { p_assignment: x.assignment_id, p_reason: k }, '已取消，已通知火柴')) onClose();
        }}><b>{v}</b></button>
      ))}
      <button class="btn" onClick={onClose}>先不要</button>
    </Sheet>
  );
}
