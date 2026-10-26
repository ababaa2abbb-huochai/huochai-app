import { useState } from 'preact/hooks';
import { useApp, useData, useAction } from '../ui.jsx';
import { twStamp } from '../lib/text.js';

const STATUS = { active: '使用中', pending: '等待核准', paused: '暫停接案' };
const ACTIONS = {
  ignite: '點燃火柴', cancel: '取消班', update_case: '修改案件', set_day_options: '調整人手', add_people: '加人',
  move_day: '改日期', add_day: '加一天', remove_day: '刪除一天', replace: '代班替換', extinguish: '熄滅火柴',
  time_change_declined: '無法配合新時間', add_member: '新增夥伴', set_member: '修改夥伴',
};

export function Admin() {
  const { me } = useApp();
  const [members] = useData('get_members');
  const [log] = useData('get_audit', { p_limit: 40 });
  const [name, setName] = useState('');
  const [run, busy] = useAction();
  if (me.role !== 'admin') return <p class="empty">只有管理者可以看這一頁。</p>;
  return (
    <div class="pad stack">
      <h1 class="page">管理</h1>
      <h2>夥伴</h2>
      <form class="row" onSubmit={async (e) => {
        e.preventDefault();
        if (name.trim() && await run('admin_add_member', { p_name: name.trim() }, `已新增 ${name.trim()}`)) setName('');
      }}>
        <input class="input" style="flex:1" placeholder="新夥伴的名字" value={name} onInput={(e) => setName(e.currentTarget.value)} aria-label="新夥伴的名字" />
        <button class="btn primary" disabled={busy || !name.trim()}>新增</button>
      </form>
      <p class="note small">正式版裡，新夥伴用 LINE 登入後會出現在這裡等你核准。</p>
      <ul class="list">
        {(members || []).map((m) => (
          <li>
            <span style="flex:1">{m.name}{m.role === 'admin' ? '（管理者）' : ''}</span>
            <span class={`chip ${m.status === 'active' ? '' : 'ember'}`}>{STATUS[m.status]}</span>
            {m.id !== me.id && m.status !== 'active' && (
              <button class="btn sm" disabled={busy} onClick={() => run('admin_set_member', { p_member: m.id, p: { status: 'active' } }, `${m.name} 已${m.status === 'pending' ? '核准' : '恢復接案'}`)}>{m.status === 'pending' ? '核准' : '恢復'}</button>
            )}
            {m.id !== me.id && m.status === 'active' && (
              <button class="btn sm" disabled={busy} onClick={() => run('admin_set_member', { p_member: m.id, p: { status: 'paused' } }, `${m.name} 已暫停接案`)}>暫停</button>
            )}
          </li>
        ))}
      </ul>
      <h2 style="margin-top:8px">修改紀錄</h2>
      <ul class="list">
        {(log || []).map((l) => (
          <li style="flex-direction:column;align-items:flex-start;gap:2px">
            <span>{l.actor || '系統'}・{ACTIONS[l.action] || l.action}{l.detail?.reason ? `（${l.detail.reason === 'unwell' ? '身體不適' : '有更重要的安排'}）` : ''}</span>
            <span class="small muted">{twStamp(l.at)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
