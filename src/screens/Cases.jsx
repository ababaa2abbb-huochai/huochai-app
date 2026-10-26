import { useState, useEffect } from 'preact/hooks';
import { useApp, useData, useAction, Sheet, Back, Switch, Stepper, Icon, ICONS, Leaf, Flame } from '../ui.jsx';
import { TYPES, REASONS, mdw, md, remaining, twTime, twDay } from '../lib/text.js';
import { DatePicker } from './Ignite.jsx';

const CLOSED_TEXT = {
  declined: '婉拒', full: '已額滿', taken: '確認了別的班', withdrawn: '已撤回', skipped: '輪到時已有班',
  cancelled: '取消', released: '已釋出', replaced: '已代班',
};
const RELEASE_TEXT = {
  need_reduced: '減少人數', moved: '改期', day_removed: '刪除這天', extinguished: '熄滅', time_change: '無法配合新時間', replaced: '代班',
};

export function Cases() {
  const { route, go } = useApp();
  const [cases, error] = useData('get_my_cases');
  if (route.caseId) {
    const c = cases?.find((x) => x.id === route.caseId);
    if (!cases) return <p class="empty">讀取中…</p>;
    if (!c) return <div><Back title="我的火柴" onClick={() => go('cases')} /><p class="empty">找不到這根火柴。</p></div>;
    return <CaseDetail c={c} />;
  }
  return (
    <div class="pad stack">
      <h1 class="page">我的火柴</h1>
      {error && <p class="empty">{error}</p>}
      {cases && cases.length === 0 && (
        <div class="empty">你還沒有點燃任何火柴。<br />接到案子後按下方的「點火柴」開始約人。</div>
      )}
      {cases?.map((c) => {
        const allFull = c.days.length > 0 && c.days.every((d) => d.confirmed >= d.need);
        return (
          <button class="case-card" onClick={() => go('cases', { caseId: c.id })}>
            <div class="spread">
              <b style="font-size:16px">{c.area}・{c.job_type}</b>
              {c.status === 'extinguished' ? <span class="chip line">已熄滅</span>
                : allFull ? <span class="chip dark">已滿</span> : <span class="chip ember">找人中</span>}
            </div>
            <span class="small muted">{c.start_time}–{c.end_time}{c.owner_name && c.owner_id ? '' : ''}</span>
            {c.days.map((d) => (
              <div class="row" style="gap:10px">
                <span style="width:84px;font-size:14px">{mdw(d.day)}</span>
                <div class="progress"><div style={`width:${Math.min(100, (d.confirmed / d.need) * 100)}%`} /></div>
                <span class="small" style="width:44px;text-align:right">{d.confirmed}/{d.need}</span>
              </div>
            ))}
          </button>
        );
      })}
    </div>
  );
}

function CaseDetail({ c }) {
  const { go, me, now, toast, api } = useApp();
  const [active, setActive] = useState(c.days[0]?.id);
  const [sheet, setSheet] = useState(null);
  const [run, busy] = useAction();
  const d = c.days.find((x) => x.id === active) || c.days[0];

  useEffect(() => {
    if (!c.days.find((x) => x.id === active) && c.days[0]) setActive(c.days[0].id);
  }, [c]);

  const extinct = c.status === 'extinguished';

  const share = async () => {
    const lines = [`【${c.area}・${c.job_type}】`];
    for (const day of c.days) {
      const names = [...(day.self_on ? [c.owner_name] : []),
        ...day.assignments.filter((a) => a.state === 'confirmed').map((a) => a.name)];
      lines.push(`${mdw(day.day)} ${c.start_time}–${c.end_time}：${names.join('、') || '還在找人'}`);
    }
    if (c.address) lines.push(`地址：${c.address}`);
    lines.push(`主整：${c.owner_name}`);
    const text = lines.join('\n');
    try {
      if (api.liff?.isApiAvailable?.('shareTargetPicker')) {
        await api.liff.shareTargetPicker([{ type: 'text', text }]);
      } else if (navigator.share) {
        await navigator.share({ text });
      } else {
        await navigator.clipboard.writeText(text);
        toast('布達訊息已複製，貼到 LINE 群組就好');
      }
    } catch {
      try {
        await navigator.clipboard.writeText(text);
        toast('布達訊息已複製，貼到 LINE 群組就好');
      } catch {
        setSheet({ kind: 'text', text });
      }
    }
  };

  return (
    <div>
      <Back title="我的火柴" onClick={() => go('cases')} />
      <div class="pad stack" style="gap:6px">
        <div class="spread">
          <h2>{c.area}・{c.job_type}</h2>
          {extinct && <span class="chip line">已熄滅</span>}
        </div>
        <p class="note">{c.start_time}–{c.end_time}{c.address ? `・${c.address}` : '・詳細地址未填'}</p>
      </div>
      {c.days.length === 0 ? <p class="empty">這根火柴沒有出班日了。</p> : (
        <>
          <div class="tabs pad" role="tablist" aria-label="出班日期" style="margin-top:8px">
            {c.days.map((x) => (
              <button role="tab" aria-selected={x.id === d.id ? 'true' : 'false'} onClick={() => setActive(x.id)}>
                {mdw(x.day)} {x.confirmed}/{x.need}
              </button>
            ))}
          </div>
          <div class="pad">
            <div class="box" style="margin-top:14px;display:flex;flex-direction:column;gap:8px">
              <div class="spread">
                <b>{d.confirmed >= d.need ? '人數已滿' : `還差 ${d.need - d.confirmed} 人`}</b>
                <span class="small muted">{d.self_on ? '含你自己' : '你只接洽'}{d.urgent ? '・急件' : ''}</span>
              </div>
              <div class="row"><div class="progress"><div style={`width:${Math.min(100, (d.confirmed / d.need) * 100)}%`} /></div>
                <b class="small">{d.confirmed} / {d.need}</b></div>
            </div>
            <ol class="list" style="margin-top:8px">
              {d.self_on && (
                <li>
                  <span class="rank ok"><Flame size={14} color="#fff" stroke={2.4} /></span>
                  <span style="flex:1">{c.owner_id === me.id ? '我' : c.owner_name}（火柴）</span>
                  <span class="chip dark">已確認</span>
                </li>
              )}
              {d.assignments.map((a, i) => (
                <PersonRow a={a} d={d} now={now} extinct={extinct} busy={busy}
                  onDirect={() => run('make_direct', { p_assignment: a.id }, `${a.name} 已直接加入`)}
                  onReplace={() => setSheet({ kind: 'replace', a })}
                  onMove={(dir) => {
                    const queued = d.assignments.filter((x) => x.state === 'queued');
                    const qi = queued.findIndex((x) => x.id === a.id);
                    const j = qi + dir;
                    if (j < 0 || j >= queued.length) return;
                    const order = d.assignments.map((x) => x.id);
                    const ai = order.indexOf(a.id);
                    const bi = order.indexOf(queued[j].id);
                    [order[ai], order[bi]] = [order[bi], order[ai]];
                    run('reorder', { p_case_day: d.id, ids: order });
                  }} canUp={i > 0} />
              ))}
            </ol>
            {!extinct && (
              <div class="stack" style="margin-top:14px">
                <button class="btn" style="border-style:dashed" onClick={() => setSheet({ kind: 'add' })}>＋ 加人到順位</button>
                <button class="btn primary block" onClick={share}>分享布達訊息到 LINE 群組</button>
                <p class="note small" style="margin-top:-6px">先自己建好 LINE 群組，再把整理好的訊息傳進去。</p>
                <div class="row">
                  <button class="btn" style="flex:1" onClick={() => setSheet({ kind: 'edit' })}>修改案件</button>
                  <button class="btn danger" style="flex:1" onClick={() => setSheet({ kind: 'extinguish' })}>熄滅這根火柴</button>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {sheet?.kind === 'add' && <AddPeopleSheet d={d} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'replace' && <ReplaceSheet a={sheet.a} d={d} onClose={() => setSheet(null)} />}
      {sheet?.kind === 'edit' && <EditSheet c={c} d={d} onClose={() => setSheet(null)} onDay={setActive} />}
      {sheet?.kind === 'text' && (
        <Sheet title="布達訊息" onClose={() => setSheet(null)}>
          <p class="note">長按下面的文字複製，貼到 LINE 群組。</p>
          <textarea class="input" style="height:180px;padding:12px" readOnly value={sheet.text} />
        </Sheet>
      )}
      {sheet?.kind === 'extinguish' && (
        <Sheet title="熄滅這根火柴？" onClose={() => setSheet(null)}>
          <p class="note">所有邀請會撤回，已確認的人全部釋出並收到「案子取消」的通知。這個動作不能復原。</p>
          <button class="btn primary block" disabled={busy} onClick={async () => {
            if (await run('extinguish', { p_case: c.id }, '火柴已熄滅')) { setSheet(null); go('cases'); }
          }}>熄滅並通知大家</button>
          <button class="btn" onClick={() => setSheet(null)}>先不要</button>
        </Sheet>
      )}
    </div>
  );
}

function PersonRow({ a, now, extinct, busy, onDirect, onReplace, onMove }) {
  const closed = !['confirmed', 'invited', 'queued'].includes(a.state);
  let sub = '';
  if (a.state === 'invited') {
    const left = remaining(a.deadline, now);
    if (a.overdue || !left) sub = '已過回覆時間，也已邀下一位；仍可確認';
    else if (a.paused_now && twDay(a.deadline) === twDay(now) && twTime(a.deadline) >= '18:00') sub = `${a.availability === 'wild' ? '野放中' : '出班中'}・18:00 後開始倒數`;
    else sub = `剩 ${left} 回覆`;
  }
  if (a.state === 'confirmed') sub = a.time_change_pending ? '等她回覆新時間' : (a.direct ? '直接加入' : '');
  if (a.state === 'cancelled') sub = REASONS[a.cancel_reason] || '';
  if (a.state === 'released') sub = RELEASE_TEXT[a.release_reason] || '';
  const rankCls = a.state === 'confirmed' ? 'ok' : a.state === 'invited' ? 'go' : '';
  return (
    <li style={closed ? 'opacity:.6' : ''}>
      <span class={`rank ${rankCls}`}>{a.rank}</span>
      <div style="flex:1;min-width:0">
        <div class="row" style="gap:6px">
          <span style={closed ? 'text-decoration:line-through' : ''}>{a.name}</span>
          {a.availability === 'wild' && !closed && <span class="chip wild" style="padding:1px 6px"><Leaf />野放</span>}
          <span class="small muted">{a.wage ? `時薪 ${a.wage}` : ''}</span>
        </div>
        {sub && <div class="small" style={`color:${a.state === 'invited' ? 'var(--match-deep)' : 'var(--muted)'}`}>{sub}</div>}
        {!extinct && (a.state === 'invited' || a.state === 'queued') && (
          <button class="link" style="padding:2px 0" disabled={busy} onClick={onDirect}>直接加入</button>
        )}
      </div>
      {a.state === 'queued' && !extinct && (
        <div style="display:flex;flex-direction:column">
          <button class="icon-btn" style="height:28px" aria-label={`把 ${a.name} 往前移`} onClick={() => onMove(-1)}><Icon d={ICONS.up} size={16} /></button>
          <button class="icon-btn" style="height:28px" aria-label={`把 ${a.name} 往後移`} onClick={() => onMove(1)}><Icon d={ICONS.down} size={16} /></button>
        </div>
      )}
      {a.state === 'confirmed' && !extinct && <button class="btn sm" onClick={onReplace}>替換</button>}
      {a.state === 'confirmed' && <span class="chip dark">已確認</span>}
      {a.state === 'invited' && <span class="chip ember">邀請中</span>}
      {a.state === 'queued' && <span class="chip line">候補</span>}
      {closed && <span class="chip">{CLOSED_TEXT[a.state]}</span>}
    </li>
  );
}

function usePeople(d) {
  const { api, version } = useApp();
  const [cands, setCands] = useState(null);
  useEffect(() => {
    api.rpc('get_candidates', { p_day: d.day, p_case_day: d.id }).then(setCands).catch(() => setCands([]));
  }, [d.id, version]);
  return cands;
}

function AddPeopleSheet({ d, onClose }) {
  const cands = usePeople(d);
  const [picked, setPicked] = useState([]);
  const [run, busy] = useAction();
  const open = (cands || []).filter((c) => !c.busy_with && !['queued', 'invited', 'confirmed'].includes(c.in_case));
  const toggle = (c) => setPicked(picked.find((p) => p.id === c.id) ? picked.filter((p) => p.id !== c.id)
    : [...picked, { id: c.id, name: c.name, wage: c.last_wage ? String(c.last_wage) : '', direct: false }]);
  const set = (id, patch) => setPicked(picked.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const missing = picked.find((p) => !p.wage);
  return (
    <Sheet title={`加人到 ${mdw(d.day)}的順位`} onClose={onClose}>
      <p class="note">勾選的人會依勾選順序排到順位最後。人數不夠時，系統會照順位邀請。</p>
      {!cands ? <p class="note">讀取中…</p> : (
        <ul class="list">
          {open.map((c) => {
            const p = picked.find((x) => x.id === c.id);
            return (
              <li>
                <label class="row" style="flex:1;gap:10px">
                  <input type="checkbox" checked={!!p} onChange={() => toggle(c)} style="width:20px;height:20px" />
                  <span>{c.name}</span>
                  {c.availability === 'wild' && <span class="chip wild" style="padding:1px 6px"><Leaf />野放</span>}
                  {c.availability === 'none' && <span class="small muted">沒標有空</span>}
                  {c.in_case && <span class="small muted">之前{CLOSED_TEXT[c.in_case] || ''}</span>}
                </label>
                {p && (
                  <>
                    <input class="input sm" style="width:68px" inputMode="numeric" placeholder="時薪" aria-label={`${c.name} 的時薪`}
                      value={p.wage} onInput={(e) => set(c.id, { wage: e.currentTarget.value.replace(/\D/g, '') })} />
                    <label class="small row" style="gap:4px"><input type="checkbox" checked={p.direct} onChange={() => set(c.id, { direct: !p.direct })} />直接加入</label>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button class="btn primary block" disabled={busy || picked.length === 0 || !!missing} onClick={async () => {
        const ok = await run('add_people', { p_case_day: d.id, people: picked.map((p) => ({ member_id: p.id, wage: Number(p.wage), direct: p.direct })) }, `已加入 ${picked.length} 位`);
        if (ok) onClose();
      }}>{missing ? `請填 ${missing.name} 的時薪` : `加入 ${picked.length} 位`}</button>
    </Sheet>
  );
}

function ReplaceSheet({ a, d, onClose }) {
  const cands = usePeople(d);
  const [pick, setPick] = useState(null);
  const [wage, setWage] = useState('');
  const [run, busy] = useAction();
  const open = (cands || []).filter((c) => !c.busy_with && c.in_case !== 'confirmed' && c.id !== a.member_id);
  return (
    <Sheet title={`誰幫 ${a.name} 代班？`} onClose={onClose}>
      <p class="note">位子直接交接給代班的人，不會觸發補位，{a.name} 也不會留下取消紀錄。兩人都會收到通知。</p>
      {!cands ? <p class="note">讀取中…</p> : (
        <div class="row" style="flex-wrap:wrap;gap:8px">
          {open.map((c) => (
            <button class="btn sm" aria-pressed={pick?.id === c.id ? 'true' : 'false'}
              style={pick?.id === c.id ? 'background:var(--ink);color:#fff;border-color:var(--ink)' : ''}
              onClick={() => { setPick(c); setWage(String(c.last_wage || a.wage || '')); }}>{c.name}</button>
          ))}
        </div>
      )}
      {pick && (
        <label class="field">{pick.name} 的時薪
          <input class="input" inputMode="numeric" value={wage} onInput={(e) => setWage(e.currentTarget.value.replace(/\D/g, ''))} />
        </label>
      )}
      <button class="btn primary block" disabled={!pick || !wage || busy} onClick={async () => {
        if (await run('replace_member', { p_assignment: a.id, p_new_member: pick.id, p_wage: Number(wage) }, `已由 ${pick.name} 代班`)) onClose();
      }}>{pick ? `換成 ${pick.name}` : '選一位代班的人'}</button>
    </Sheet>
  );
}

function EditSheet({ c, d, onClose, onDay }) {
  const [run, busy] = useAction();
  const { ask } = useApp();
  const [base, setBase] = useState({ area: c.area, address: c.address || '', job_type: c.job_type, start_time: c.start_time, end_time: c.end_time });
  const [day, setDay] = useState({ need: d.need, self_on: d.self_on, urgent: d.urgent });
  const confirmedRows = d.assignments.filter((a) => a.state === 'confirmed');
  const confirmedTotal = confirmedRows.length + (day.self_on ? 1 : 0);
  const over = Math.max(0, confirmedTotal - day.need);
  const [release, setRelease] = useState([]);
  const [picker, setPicker] = useState(null);

  useEffect(() => {
    // 預設釋出順位最後的人
    setRelease(confirmedRows.slice().sort((x, y) => y.rank - x.rank).slice(0, over).map((a) => a.id));
  }, [over]);

  const timeChanged = base.start_time !== c.start_time || base.end_time !== c.end_time;

  return (
    <Sheet title="修改案件" onClose={onClose}>
      <h3>基本資料</h3>
      <div class="row" style="gap:12px">
        <label class="field" style="flex:1">開始時間
          <input class="input" type="time" value={base.start_time} onInput={(e) => setBase({ ...base, start_time: e.currentTarget.value })} />
        </label>
        <label class="field" style="flex:1">結束時間
          <input class="input" type="time" value={base.end_time} onInput={(e) => setBase({ ...base, end_time: e.currentTarget.value })} />
        </label>
      </div>
      <label class="field">區域<input class="input" value={base.area} onInput={(e) => setBase({ ...base, area: e.currentTarget.value })} /></label>
      <label class="field">詳細地址（選填）<input class="input" value={base.address} onInput={(e) => setBase({ ...base, address: e.currentTarget.value })} /></label>
      <div class="seg">
        {TYPES.map((t) => <button type="button" aria-pressed={base.job_type === t ? 'true' : 'false'} onClick={() => setBase({ ...base, job_type: t })}>{t}</button>)}
      </div>
      {timeChanged && <p class="note">已確認的人會收到「時間變更」，可以回「沒問題」或「沒辦法」；不回覆就維持原班。</p>}
      <button class="btn primary" disabled={busy} onClick={async () => {
        if (await run('update_case', { p_case: c.id, p: base }, '基本資料已更新')) onClose();
      }}>儲存基本資料</button>

      <h3 style="margin-top:10px">{mdw(d.day)}的人手</h3>
      <div class="spread"><span>我這天也出班</span><Switch on={day.self_on} label="我這天也出班" onChange={(v) => setDay({ ...day, self_on: v })} /></div>
      <div class="spread"><span>{day.self_on ? '總共幾人（含我）' : '需要幾位女孩'}</span>
        <Stepper value={day.need} label="人數" onChange={(v) => setDay({ ...day, need: v })} /></div>
      <div class="spread"><span>急件：同時邀請全部候補</span><Switch on={day.urgent} label="急件" onChange={(v) => setDay({ ...day, urgent: v })} /></div>
      {over > 0 && (
        <div class="box ember">
          已確認的人比需要的多 {over} 位，要釋出誰？（預設是順位最後的人）
          {confirmedRows.map((a) => (
            <label class="row" style="gap:8px;margin-top:6px">
              <input type="checkbox" checked={release.includes(a.id)}
                onChange={() => setRelease(release.includes(a.id) ? release.filter((x) => x !== a.id) : [...release, a.id])} />
              {a.rank}. {a.name}
            </label>
          ))}
        </div>
      )}
      <p class="note small">人數變少時，會先撤回還在等回覆的邀請；人數變多時，會照順位邀請候補。</p>
      <button class="btn primary" disabled={busy || (over > 0 && release.length !== over)} onClick={async () => {
        if (await run('set_day_options', { p_case_day: d.id, p: { ...day, release } }, '人手已更新')) onClose();
      }}>{over > 0 && release.length !== over ? `請勾選 ${over} 位` : '儲存這天的人手'}</button>

      <h3 style="margin-top:10px">日期</h3>
      <div class="row" style="flex-wrap:wrap">
        <button class="btn" onClick={() => setPicker('move')}>把 {md(d.day)} 改到別天</button>
        <button class="btn" onClick={() => setPicker('add')}>＋ 加一天</button>
        <button class="btn danger" disabled={busy} onClick={async () => {
          if (!(await ask(`刪除 ${mdw(d.day)}？這天的邀請會撤回、已確認的人會釋出。`, '刪除這天'))) return;
          if (await run('remove_day', { p_case_day: d.id }, `已刪除 ${mdw(d.day)}`)) onClose();
        }}>刪除這天</button>
      </div>
      <p class="note small">改到別天：原本確認的人依原順位優先收到新日期的邀請（新的一天要重新確認）。</p>

      {picker && (
        <DatePicker selected={[]} single title={picker === 'move' ? `${mdw(d.day)}改到哪一天` : '加哪一天'}
          onClose={() => setPicker(null)}
          onDone={async ([to]) => {
            setPicker(null);
            if (picker === 'move') {
              const nd = await run('move_day', { p_case_day: d.id, p_new_day: to }, `已改到 ${mdw(to)}，原班人馬優先邀請`);
              if (nd) { onDay(nd); onClose(); }
            } else {
              const nd = await run('add_day', { p_case: c.id, spec: { day: to, need: d.need, self_on: d.self_on, people: [] } }, `已加入 ${mdw(to)}，請加人到順位`);
              if (nd) { onDay(nd); onClose(); }
            }
          }} />
      )}
    </Sheet>
  );
}
