import { useState, useEffect } from 'preact/hooks';
import { useApp, useAction, Switch, Stepper, Sheet, Back, Icon, ICONS, Leaf, Flame } from '../ui.jsx';
import { TYPES, REASONS, mdw, md, monthStart, addMonths, monthTitle, parseDay, daysInMonth, errorText } from '../lib/text.js';

const blankDay = (base) => ({ need: base?.need ?? 3, self_on: base?.self_on ?? true, urgent: false, people: [] });

export function Ignite() {
  const { route, go, today, api, toast } = useApp();
  const [days, setDays] = useState(route.day ? [route.day] : []);
  const [spec, setSpec] = useState(route.day ? { [route.day]: blankDay() } : {});
  const [active, setActive] = useState(route.day || null);
  const [form, setForm] = useState({ area: '', address: '', job_type: '', start_time: '09:00', end_time: '16:00' });
  const [picker, setPicker] = useState(false);
  const [conflict, setConflict] = useState(null);
  const [run, busy] = useAction();

  const setDaySpec = (day, patch) => setSpec((s) => ({ ...s, [day]: { ...s[day], ...patch } }));

  const applyDays = (list) => {
    const sorted = [...list].sort();
    const next = {};
    const base = spec[days[0]];
    for (const d of sorted) next[d] = spec[d] || blankDay(base);
    setSpec(next);
    setDays(sorted);
    if (!sorted.includes(active)) setActive(sorted[0] || null);
  };

  const renameDay = (from, to) => {
    const list = days.filter((d) => d !== from).concat(to).sort();
    const next = { ...spec, [to]: { ...spec[from], cancel_conflict: undefined } };
    delete next[from];
    setSpec(next);
    setDays(list);
    setActive(to);
  };

  const invitesFor = (s) => {
    const direct = s.people.filter((p) => p.direct).length;
    const inviteable = s.people.length - direct;
    if (s.urgent) return inviteable;
    return Math.max(0, Math.min(inviteable, s.need - (s.self_on ? 1 : 0) - direct));
  };
  const totalInvites = days.reduce((n, d) => n + invitesFor(spec[d]), 0);

  const problems = () => {
    if (!days.length) return '請選出班日期。';
    if (!form.area.trim()) return '請填區域。';
    if (!form.job_type) return '請選案件類型。';
    for (const d of days) {
      const s = spec[d];
      const direct = s.people.filter((p) => p.direct).length;
      if (direct + (s.self_on ? 1 : 0) > s.need) return `${mdw(d)}直接加入的人數超過需要的人數了。`;
      const noWage = s.people.find((p) => !p.guest && !p.wage);
      if (noWage) return `請填 ${noWage.name} 在 ${md(d)} 的時薪。`;
    }
    return null;
  };

  const submit = async (override) => {
    const cur = override || spec;
    const p = problems();
    if (p) return toast(p, true);
    // 撞期檢查：我也出班的日子，我是否已答應別人的班
    for (const d of days) {
      const s = cur[d];
      if (s.self_on && !s.cancel_conflict) {
        const c = await api.rpc('get_conflict', { p_day: d });
        if (c) {
          setConflict({ day: d, info: c });
          return null;
        }
      }
    }
    const payload = {
      ...form,
      area: form.area.trim(),
      days: days.map((d) => ({
        day: d, need: cur[d].need, self_on: cur[d].self_on, urgent: cur[d].urgent,
        cancel_conflict: cur[d].cancel_conflict,
        people: cur[d].people.map((x) => (x.guest
          ? { guest_name: x.name, wage: x.wage ? Number(x.wage) : null }
          : { member_id: x.id, wage: Number(x.wage), direct: x.direct })),
      })),
    };
    const id = await run('ignite', { p: payload });
    if (id) {
      toast(totalInvites > 0 ? `火柴點燃了，已邀請 ${totalInvites} 位` : '火柴點燃了');
      go('cases', { caseId: id });
    }
    return id;
  };

  const s = active ? spec[active] : null;

  return (
    <div>
      <Back title="點燃火柴" onClick={() => go('calendar')} />
      <div class="pad stack" style="gap:18px">
        <div class="field">出班日期
          <div class="row" style="flex-wrap:wrap;gap:8px">
            {days.map((d) => (
              <button type="button" class="date-chip" aria-label={`移除 ${mdw(d)}`}
                onClick={() => applyDays(days.filter((x) => x !== d))}>{mdw(d)}<span aria-hidden="true">×</span></button>
            ))}
            <button type="button" class="btn" style="border-style:dashed" onClick={() => setPicker(true)}>＋ 選日期</button>
          </div>
        </div>
        <div class="row" style="gap:12px">
          <label class="field" style="flex:1">開始時間
            <input class="input" type="time" value={form.start_time} onInput={(e) => setForm({ ...form, start_time: e.currentTarget.value })} />
          </label>
          <label class="field" style="flex:1">結束時間
            <input class="input" type="time" value={form.end_time} onInput={(e) => setForm({ ...form, end_time: e.currentTarget.value })} />
          </label>
        </div>
        <label class="field">區域（必填）
          <input class="input" placeholder="例：中山區" value={form.area} onInput={(e) => setForm({ ...form, area: e.currentTarget.value })} />
        </label>
        <label class="field">詳細地址（選填）
          <input class="input" placeholder="填了會自動帶入布達訊息" value={form.address} onInput={(e) => setForm({ ...form, address: e.currentTarget.value })} />
          <span class="small" style="font-weight:400">只有確認出班的人看得到。</span>
        </label>
        <div class="field">案件類型
          <div class="seg">
            {TYPES.map((t) => (
              <button type="button" aria-pressed={form.job_type === t ? 'true' : 'false'} onClick={() => setForm({ ...form, job_type: t })}>{t}</button>
            ))}
          </div>
        </div>
      </div>

      {days.length > 0 && (
        <section class="section stack" style="margin-top:20px">
          <h2>每天的人手</h2>
          <div class="tabs" role="tablist" aria-label="出班日期">
            {days.map((d) => (
              <button role="tab" aria-selected={d === active ? 'true' : 'false'} onClick={() => setActive(d)}>
                {mdw(d)}{spec[d].people.length ? ` ・${spec[d].people.length}` : ''}
              </button>
            ))}
          </div>
          {s && <DayEditor day={active} s={s} set={(patch) => setDaySpec(active, patch)}
            otherDays={days.filter((d) => d !== active)}
            copyTo={() => {
              const next = { ...spec };
              for (const d of days) if (d !== active) next[d] = { ...next[d], people: s.people.map((x) => ({ ...x })) };
              setSpec(next);
              toast('已把順位複製到其他天（有班的人送出時會被擋下）');
            }} />}
        </section>
      )}

      <div class="pad" style="margin-top:16px">
        <button class="btn primary block" disabled={busy} onClick={() => submit()}>
          {busy ? '送出中…' : totalInvites > 0 ? `送出（邀請 ${totalInvites} 位）` : '點燃火柴'}
        </button>
      </div>

      {picker && (
        <DatePicker selected={days} onClose={() => setPicker(false)} onDone={(list) => { applyDays(list); setPicker(false); }} />
      )}
      {conflict && (
        <ConflictSheet c={conflict} s={spec[conflict.day]} onClose={() => setConflict(null)}
          onMove={(to) => { renameDay(conflict.day, to); setConflict(null); toast(`已改成 ${mdw(to)}，確認後再送出`); }}
          onContactOnly={(keepTotal) => {
            const cur = spec[conflict.day];
            const next = { ...spec, [conflict.day]: { ...cur, self_on: false, need: keepTotal ? cur.need : Math.max(1, cur.need - 1) } };
            setSpec(next);
            setConflict(null);
            submit(next);
          }}
          onCancel={(reason) => {
            const next = { ...spec, [conflict.day]: { ...spec[conflict.day], cancel_conflict: { assignment_id: conflict.info.assignment_id, reason } } };
            setSpec(next);
            setConflict(null);
            submit(next);
          }} />
      )}
    </div>
  );
}

function DayEditor({ day, s, set, otherDays, copyTo }) {
  const { api, version } = useApp();
  const [cands, setCands] = useState([]);
  useEffect(() => {
    api.rpc('get_candidates', { p_day: day }).then(setCands).catch(() => setCands([]));
  }, [day, version]);

  const inList = new Set(s.people.map((p) => p.id));
  const [guestName, setGuestName] = useState('');
  const addGuest = () => {
    const n = guestName.trim();
    if (!n) return;
    set({ people: [...s.people, { id: 'guest-' + Date.now(), guest: true, name: n, wage: '', direct: true }] });
    setGuestName('');
  };
  const add = (c) => set({ people: [...s.people, { id: c.id, name: c.name, wage: c.last_wage ? String(c.last_wage) : '', direct: false, availability: c.availability }] });
  const move = (i, dir) => {
    const j = i + dir;
    if (j < 0 || j >= s.people.length) return;
    const next = s.people.slice();
    [next[i], next[j]] = [next[j], next[i]];
    set({ people: next });
  };
  const patch = (i, p) => set({ people: s.people.map((x, k) => (k === i ? { ...x, ...p } : x)) });
  const remove = (i) => set({ people: s.people.filter((_, k) => k !== i) });

  const direct = s.people.filter((p) => p.direct).length;
  const toInvite = s.urgent ? s.people.length - direct : Math.max(0, s.need - (s.self_on ? 1 : 0) - direct);
  let seen = 0;

  const groups = [
    ['有空', cands.filter((c) => !inList.has(c.id) && !c.busy_with && c.availability === 'free')],
    ['野放（回覆可能比較慢）', cands.filter((c) => !inList.has(c.id) && !c.busy_with && c.availability === 'wild')],
    ['沒標有空（仍然可以邀請）', cands.filter((c) => !inList.has(c.id) && !c.busy_with && c.availability === 'none')],
    ['這天已有班（不能選）', cands.filter((c) => c.busy_with)],
  ];

  return (
    <div class="stack" style="gap:14px">
      <div class="spread">
        <div>
          <h3>我這天也出班</h3>
          <p class="note small">{s.self_on ? '你算在人數裡，自動確認' : '你只負責接洽，這天仍可當別人的女孩'}</p>
        </div>
        <Switch on={s.self_on} label="我這天也出班" onChange={(v) => set({ self_on: v })} />
      </div>
      <div class="spread">
        <h3>{s.self_on ? '這天總共幾人（含我）' : '這天需要幾位女孩'}</h3>
        <Stepper value={s.need} label="人數" min={1} onChange={(v) => set({ need: v })} />
      </div>
      <div class="spread">
        <div>
          <h3>急件：同時邀請全部候補</h3>
          <p class="note small">一次全部送出，先確認的人先拿到</p>
        </div>
        <Switch on={s.urgent} label="急件" onChange={(v) => set({ urgent: v })} />
      </div>

      <div>
        <div class="spread">
          <h3>依順位挑女孩</h3>
          {otherDays.length > 0 && s.people.length > 0 && <button class="link" onClick={copyTo}>複製到其他天</button>}
        </div>
        <p class="note small">談好的人按「直接加入」就算確認。時薪會帶入你上次和她合作的金額，其他夥伴看不到。</p>
      </div>

      {s.people.length === 0 ? (
        <p class="note">從下面的名單點「＋」把人排進來。</p>
      ) : (
        <ol class="list">
          {s.self_on && (
            <li>
              <span class="rank ok"><Flame size={14} color="#fff" stroke={2.4} /></span>
              <div style="flex:1"><b style="font-weight:500">我（火柴）</b><div class="small muted">自動確認</div></div>
              <span class="chip dark">已確認</span>
            </li>
          )}
          {s.people.map((p, i) => {
            let tag; let cls;
            if (p.guest) { tag = '鄰家女孩・直接算確認'; cls = 'ok'; } else if (p.direct) { tag = '直接加入・已確認'; cls = 'ok'; } else {
              seen += 1;
              if (s.urgent || seen <= toInvite) { tag = s.urgent ? '同時邀請' : '先邀'; cls = 'go'; } else { tag = '候補'; cls = ''; }
            }
            if (p.availability === 'wild') tag += '・野放中';
            if (p.availability === 'none') tag += '・沒標有空';
            return (
              <li style="align-items:center">
                <span class={`rank ${cls}`}>{p.guest ? '鄰' : i + 1}</span>
                <div style="flex:1;min-width:0">
                  <div class="row" style="gap:6px"><b style="font-weight:500">{p.name}</b>
                    {p.availability === 'wild' && <span class="chip wild" style="padding:1px 6px"><Leaf /></span>}</div>
                  <div class="small" style={`color:${cls === 'go' ? 'var(--match-deep)' : 'var(--muted)'}`}>{tag}</div>
                  {!p.guest && <button class="link" style="padding:2px 0" onClick={() => patch(i, { direct: !p.direct })}>{p.direct ? '改回邀請' : '直接加入'}</button>}
                </div>
                <label class="small muted row" style="gap:4px">時薪
                  <input class="input sm" style="width:68px" inputMode="numeric" placeholder={p.guest ? '選填' : '必填'} value={p.wage}
                    aria-label={`${p.name} 的時薪`} onInput={(e) => patch(i, { wage: e.currentTarget.value.replace(/\D/g, '') })} />
                </label>
                <div style="display:flex;flex-direction:column">
                  <button class="icon-btn" style="height:30px" aria-label={`把 ${p.name} 往前移`} onClick={() => move(i, -1)}><Icon d={ICONS.up} size={16} /></button>
                  <button class="icon-btn" style="height:30px" aria-label={`把 ${p.name} 往後移`} onClick={() => move(i, 1)}><Icon d={ICONS.down} size={16} /></button>
                </div>
                <button class="icon-btn" style="width:32px" aria-label={`移除 ${p.name}`} onClick={() => remove(i)}><Icon d={ICONS.x} size={16} /></button>
              </li>
            );
          })}
        </ol>
      )}

      <div class="row">
        <input class="input" id={`guest-${day}`} style="flex:1" placeholder="團隊以外的人，例：小美" value={guestName}
          aria-label="鄰家女孩的名字" onInput={(e) => setGuestName(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && addGuest()} />
        <button class="btn" disabled={!guestName.trim()} onClick={addGuest}>＋ 鄰家女孩</button>
      </div>
      <p class="note small" style="margin-top:-8px">鄰家女孩是你自己找來、團隊以外的人：直接算進人數，不需要帳號，也不會收到通知。</p>

      <div class="box">
        {s.urgent
          ? `急件：一次邀請全部 ${s.people.length - direct} 位，先確認的人先拿到，滿了其他人會收到「已額滿」。`
          : toInvite === 0 && s.people.length
            ? '人數已滿，不用再邀請。'
            : `系統先邀 ${Math.min(toInvite, s.people.length - direct)} 位。有人婉拒或超時，會自動照順位再邀下一位；超時的人還是可以確認，先確認的人先拿到。`}
        <br /><span class="muted">回覆時間：一週以上 12 小時・3–7 天 4 小時・3 天內 2 小時。對方出班中或野放時，等到 18:00 才開始倒數。</span>
      </div>

      {groups.map(([title, list]) => list.length > 0 && (
        <div>
          <h3 class="muted" style="font-size:14px;margin-top:4px">{title}</h3>
          <ul class="list">
            {list.map((c) => (
              <li style={c.busy_with ? 'opacity:.5' : ''}>
                <span style="flex:1">{c.name}
                  {c.busy_with && <span class="small muted">　已有 {c.busy_with} 的班</span>}
                  {!c.busy_with && c.last_wage && <span class="small muted">　上次 {c.last_wage}</span>}
                </span>
                {c.busy_with
                  ? <span class="chip line">不能選</span>
                  : <button class="btn sm" aria-label={`把 ${c.name} 加入順位`} onClick={() => add(c)}>＋ 加入順位</button>}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

export function DatePicker({ selected, onClose, onDone, single = false, title = '選出班日期' }) {
  const { today } = useApp();
  const [month, setMonth] = useState(monthStart(selected[0] || today));
  const [list, setList] = useState(selected);
  const { api, version } = useApp();
  const [heat, setHeat] = useState({});
  useEffect(() => {
    api.rpc('get_month', { p_month: month }).then((m) => setHeat(Object.fromEntries(m.days.map((d) => [d.day, d.free])))).catch(() => {});
  }, [month, version]);
  const n = daysInMonth(month);
  const lead = parseDay(month).getUTCDay();
  const days = Array.from({ length: n }, (_, i) => month.slice(0, 8) + String(i + 1).padStart(2, '0'));
  const toggle = (d) => {
    if (single) return onDone([d]);
    setList(list.includes(d) ? list.filter((x) => x !== d) : [...list, d]);
  };
  return (
    <Sheet title={title} onClose={onClose}>
      <div class="month-nav">
        <button class="icon-btn" aria-label="上個月" disabled={month <= monthStart(today)} onClick={() => setMonth(addMonths(month, -1))}><Icon d={ICONS.back} /></button>
        <h3>{monthTitle(month)}</h3>
        <button class="icon-btn" aria-label="下個月" onClick={() => setMonth(addMonths(month, 1))}><Icon d={ICONS.next} /></button>
      </div>
      <p class="note small" style="text-align:center">數字是那天還能約的人數</p>
      <div class="week" style="padding:0" aria-hidden="true">{['日', '一', '二', '三', '四', '五', '六'].map((w) => <span>{w}</span>)}</div>
      <div class="grid" style="padding:0">
        {Array.from({ length: lead }).map(() => <div />)}
        {days.map((d) => {
          const on = list.includes(d);
          return (
            <button class="avail-cell" disabled={d < today} aria-pressed={on ? 'true' : 'false'}
              aria-label={`${mdw(d)}，還能約 ${heat[d] ?? 0} 人`}
              style={`${d < today ? 'opacity:.35;' : ''}${on ? 'background:var(--ink);color:#fff;border-color:var(--ink)' : ''}`}
              onClick={() => toggle(d)}>
              <span class="n">{Number(d.slice(8))}</span>
              <span class="s">{heat[d] ?? ''}</span>
            </button>
          );
        })}
      </div>
      {!single && <button class="btn primary block" onClick={() => onDone(list)}>完成（{list.length} 天）</button>}
    </Sheet>
  );
}

function ConflictSheet({ c, s, onClose, onMove, onContactOnly, onCancel }) {
  const { api } = useApp();
  const [step, setStep] = useState('choose');
  const [suggest, setSuggest] = useState(null);
  const [pick, setPick] = useState(false);
  const info = c.info;
  const others = s.need - 1;
  useEffect(() => {
    if (step === 'move' && !suggest) {
      api.rpc('suggest_days', { p_day: c.day, p_people: Math.max(0, others) }).then(setSuggest).catch(() => setSuggest([]));
    }
  }, [step]);

  if (step === 'move') {
    return (
      <Sheet title="跟客戶改日期" onClose={onClose}>
        <p class="note">這些日子你沒班，而且還能約到 {others} 位以上：</p>
        {!suggest ? <p class="note">讀取中…</p> : suggest.length === 0 ? <p class="note">附近 10 天內沒有合適的日子。</p> : (
          <div class="row" style="flex-wrap:wrap;gap:8px">
            {suggest.slice(0, 8).map((x) => (
              <button class="btn sm" onClick={() => onMove(x.day)}>{mdw(x.day)}・{x.free} 人</button>
            ))}
          </div>
        )}
        <button class="btn" onClick={() => setPick(true)}>自己選日期</button>
        {pick && <DatePicker selected={[]} single title="改到哪一天" onClose={() => setPick(false)} onDone={([d]) => onMove(d)} />}
      </Sheet>
    );
  }
  if (step === 'contact') {
    return (
      <Sheet title="這天只接洽，不出班" onClose={onClose}>
        <p class="note">你原本設定這天總共 {s.need} 人（含你）。你不出班之後，現場還是 {s.need} 人嗎？</p>
        <button class="option" onClick={() => onContactOnly(true)}><b>是，現場還是 {s.need} 人</b><span>多邀一位補你的位置</span></button>
        <button class="option" onClick={() => onContactOnly(false)}><b>否，{Math.max(1, s.need - 1)} 人就夠</b><span>照原本要邀的人數</span></button>
      </Sheet>
    );
  }
  if (step === 'cancel') {
    return (
      <Sheet title={`取消 ${info.owner_name} 的班`} onClose={onClose}>
        <p class="note">選一個原因。按下後會同時取消原本的班、送出你的邀請；{info.owner_name} 的案子會立刻自動補位。</p>
        {Object.entries(REASONS).map(([k, v]) => (
          <button class="option" onClick={() => onCancel(k)}><b>{v}</b></button>
        ))}
      </Sheet>
    );
  }
  return (
    <Sheet title="這天你已經有班了" onClose={onClose}>
      <p class="note">{mdw(c.day)}你已答應 {info.owner_name} 的班（{info.area}・{info.job_type}）。要怎麼處理？</p>
      <button class="option" onClick={() => setStep('move')}><b>跟客戶改日期</b><span>什麼都不會送出，先幫你找其他日子</span></button>
      <button class="option" onClick={() => setStep('contact')}><b>這天只接洽，不出班</b><span>{info.owner_name} 的班照常</span></button>
      <button class="option" onClick={() => setStep('cancel')}><b>取消原本的班</b><span>送出邀請時才會一起取消</span></button>
      <button class="btn" onClick={onClose}>返回</button>
    </Sheet>
  );
}

export { errorText };
