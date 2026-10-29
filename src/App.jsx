import { useEffect, useState, useCallback } from 'preact/hooks';
import { Ctx, Flame, Icon, ICONS, Sheet } from './ui.jsx';
import { twStamp } from './lib/text.js';
import { Calendar } from './screens/Calendar.jsx';
import { Availability } from './screens/Availability.jsx';
import { Ignite } from './screens/Ignite.jsx';
import { Cases } from './screens/Cases.jsx';
import { Shifts } from './screens/Shifts.jsx';
import { Notes } from './screens/Notes.jsx';
import { Admin } from './screens/Admin.jsx';

export function App({ api }) {
  const [version, setVersion] = useState(0);
  const [me, setMe] = useState(null);
  // LINE 通知裡的連結會帶 ?tab=shifts，直接打開對應的頁面
  const [route, setRoute] = useState(() => {
    const tab = new URLSearchParams(location.search).get('tab');
    return { tab: ['calendar', 'shifts', 'ignite', 'cases', 'avail', 'notes'].includes(tab) ? tab : 'calendar' };
  });
  const [toastMsg, setToast] = useState(null);
  const [askReq, setAsk] = useState(null);
  // 頁面內的確認視窗（不用瀏覽器的 confirm，LINE 和部分環境會擋掉）
  const ask = useCallback((text, okLabel = '確定') => new Promise((resolve) => setAsk({ text, okLabel, resolve })), []);
  const answer = (v) => { askReq?.resolve(v); setAsk(null); };

  const refresh = useCallback(() => setVersion((v) => v + 1), []);
  useEffect(() => api.subscribe(refresh), [api, refresh]);
  useEffect(() => {
    let alive = true;
    api.rpc('get_me').then((m) => alive && setMe(m)).catch(() => alive && setMe(null));
    return () => { alive = false; };
  }, [api, version]);

  const toast = useCallback((text, err = false) => {
    setToast({ text, err, id: Math.random() });
  }, []);
  useEffect(() => {
    if (!toastMsg) return undefined;
    const t = setTimeout(() => setToast(null), toastMsg.err ? 4200 : 2400);
    return () => clearTimeout(t);
  }, [toastMsg]);

  const go = useCallback((tab, params = {}) => {
    setRoute({ tab, ...params });
    window.scrollTo(0, 0);
  }, []);

  if (!me) {
    return <div class="loading"><Flame size={36} color="#C2410C" />正在載入…</div>;
  }
  if (me.status !== 'active') {
    return (
      <div class="loading">
        <Flame size={36} color="#C2410C" />
        <p class="empty">你的帳號（{me.name}）還沒開通。<br />請管理者在「管理」裡核准你。</p>
      </div>
    );
  }

  const ctx = { api, version, refresh, me, toast, go, route, ask, now: me.now, today: me.today };
  const tab = route.tab;
  const Screen = {
    calendar: Calendar, avail: Availability, ignite: Ignite, cases: Cases,
    shifts: Shifts, notes: Notes, admin: Admin,
  }[tab] || Calendar;

  return (
    <Ctx.Provider value={ctx}>
      <div class="app">
        {api.isDemo && <DemoBar api={api} me={me} toast={toast} ask={ask} />}
        {!['ignite'].includes(tab) && !route.caseId && (
          <header class="top">
            <div class="brand"><Flame color="#C2410C" />賣女孩的小火柴</div>
            <div class="row" style="gap:0">
              {me.role === 'admin' && (
                <button class="icon-btn" aria-label="管理" onClick={() => go('admin')}><Icon d={ICONS.gear} /></button>
              )}
              <button class="icon-btn" aria-label={`通知，${me.unread} 則未讀`} onClick={() => go('notes')}>
                <Icon d={ICONS.bell} />
                {me.unread > 0 && <span class="badge">{me.unread > 99 ? '99+' : me.unread}</span>}
              </button>
            </div>
          </header>
        )}
        <main class="main"><Screen key={tab} /></main>
        <Nav tab={tab} go={go} />
        {askReq && (
          <Sheet title="請確認" onClose={() => answer(false)}>
            <p class="note" style="font-size:15px;color:var(--ink)">{askReq.text}</p>
            <button class="btn primary block" onClick={() => answer(true)}>{askReq.okLabel}</button>
            <button class="btn" onClick={() => answer(false)}>先不要</button>
          </Sheet>
        )}
        {toastMsg && <div class={`toast ${toastMsg.err ? 'err' : ''}`} role="status">{toastMsg.text}</div>}
      </div>
    </Ctx.Provider>
  );
}

function Nav({ tab, go }) {
  const item = (key, label, icon) => (
    <button aria-current={tab === key ? 'page' : undefined} onClick={() => go(key)}>
      <Icon d={icon} />{label}
    </button>
  );
  return (
    <nav class="nav" aria-label="主選單">
      {item('calendar', '月曆', ICONS.cal)}
      {item('shifts', '我的班', ICONS.check)}
      <button class="fab" aria-current={tab === 'ignite' ? 'page' : undefined} onClick={() => go('ignite')}>
        <span class="dot"><Flame size={26} color="#fff" /></span>點火柴
      </button>
      {item('cases', '我的火柴', ICONS.list)}
      {item('avail', '填班', ICONS.pen)}
    </nav>
  );
}

function DemoBar({ api, me, toast, ask }) {
  const [people, setPeople] = useState([]);
  useEffect(() => {
    api.listIdentities().then(setPeople);
  }, [api, me.id]);
  const advance = async (h) => {
    await api.advance(h);
    toast(`時間快轉 ${h >= 24 ? h / 24 + ' 天' : h + ' 小時'}`);
  };
  return (
    <div class="demo-bar" role="region" aria-label="試玩控制">
      <span class="tag">試玩</span>
      <label class="row" style="gap:6px">我是
        <select value={me.id} onChange={(e) => api.switchTo(e.currentTarget.value)}>
          {people.map((p) => <option value={p.id}>{p.name}{p.role === 'admin' ? '（管理者）' : ''}</option>)}
        </select>
      </label>
      <span class="clock">現在 {twStamp(me.now)}</span>
      <button onClick={() => advance(1)}>＋1 小時</button>
      <button onClick={() => advance(24)}>＋1 天</button>
      <button onClick={async () => {
        if (await ask('清除所有試玩資料，回到一開始的狀態？', '重設試玩資料')) { await api.reset(); toast('已重設試玩資料'); }
      }}>重設</button>
    </div>
  );
}
