import { useEffect } from 'preact/hooks';
import { useApp, useData } from '../ui.jsx';
import { noteText, noteTarget, twStamp } from '../lib/text.js';

export function Notes() {
  const { api, go, me } = useApp();
  const [list, error] = useData('get_notifications', { p_limit: 60 });
  useEffect(() => {
    if (me.unread > 0) api.runAction('mark_notifications_read', {}).catch(() => {});
  }, []);
  if (error) return <p class="empty">{error}</p>;
  if (!list) return <p class="empty">讀取中…</p>;
  return (
    <div class="pad stack">
      <h1 class="page">通知</h1>
      {list.length === 0 && <p class="empty">還沒有通知。</p>}
      <ul class="list">
        {list.map((n) => (
          <li>
            <button style="all:unset;cursor:pointer;flex:1;display:flex;flex-direction:column;gap:2px;padding:4px 0"
              onClick={() => go(noteTarget(n.kind), n.payload?.case_id && noteTarget(n.kind) === 'cases' ? { caseId: n.payload.case_id } : {})}>
              <span style={n.read ? '' : 'font-weight:700'}>{noteText(n)}</span>
              <span class="small muted">{twStamp(n.created_at)}{n.kind === 'invite' ? '・LINE 通知' : ''}</span>
            </button>
            {!n.read && <span class="badge" style="position:static" aria-label="未讀" />}
          </li>
        ))}
      </ul>
    </div>
  );
}
