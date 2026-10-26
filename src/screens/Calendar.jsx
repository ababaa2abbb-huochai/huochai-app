import { useState } from 'preact/hooks';
import { useApp, useData, Icon, ICONS, Avatar } from '../ui.jsx';
import { monthStart, addMonths, monthTitle, parseDay, mdw } from '../lib/text.js';

const HEAT = [
  [0, 'var(--heat0)', 'var(--muted)'],
  [2, 'var(--heat1)', 'var(--ink)'],
  [4, 'var(--heat2)', 'var(--ink)'],
  [6, 'var(--heat3)', 'var(--ink)'],
  [Infinity, 'var(--heat4)', '#fff'],
];
const heat = (n) => HEAT.find(([max]) => n <= max);

export function Calendar() {
  const { today, me, go } = useApp();
  const [month, setMonth] = useState(monthStart(today));
  const [sel, setSel] = useState(today);
  const [data, error] = useData('get_month', { p_month: month });

  const days = data?.days || [];
  const lead = parseDay(month).getUTCDay();
  const selDay = days.find((d) => d.day === sel) || days[0];

  const changeMonth = (n) => {
    const m = addMonths(month, n);
    setMonth(m);
    setSel(m === monthStart(today) ? today : m);
  };

  return (
    <div>
      <div class="month-nav">
        <button class="icon-btn" aria-label="上個月" onClick={() => changeMonth(-1)}><Icon d={ICONS.back} /></button>
        <h1 class="page">{monthTitle(month)}</h1>
        <button class="icon-btn" aria-label="下個月" onClick={() => changeMonth(1)}><Icon d={ICONS.next} /></button>
      </div>
      <div class="legend">
        <span>每格是還能約的人數</span>
        <span style="margin-left:auto"><i style="background:var(--heat0)" />0</span>
        <span><i style="background:var(--heat1)" />1–2</span>
        <span><i style="background:var(--heat2)" />3–4</span>
        <span><i style="background:var(--heat3)" />5–6</span>
        <span><i style="background:var(--heat4)" />7+</span>
      </div>
      <div class="week" aria-hidden="true">{['日', '一', '二', '三', '四', '五', '六'].map((w) => <span>{w}</span>)}</div>
      {error && <p class="empty">{error}</p>}
      <div class="grid">
        {Array.from({ length: lead }).map(() => <div />)}
        {days.map((d) => {
          const [, bg, fg] = heat(d.free);
          const meThere = d.people.find((p) => p.id === me.id);
          const mineState = meThere && meThere.status !== 'free' && meThere.status !== 'invited' ? 'shift' : data.mine[d.day];
          const n = Number(d.day.slice(8));
          return (
            <button class={`cell ${d.day === selDay?.day ? 'sel' : ''} ${d.day < today ? 'past' : ''}`}
              style={`background:${bg};color:${fg}`}
              aria-label={`${mdw(d.day)}，還能約 ${d.free} 人${mineState === 'shift' ? '，你有班' : ''}`}
              aria-pressed={d.day === selDay?.day ? 'true' : 'false'}
              onClick={() => setSel(d.day)}>
              {mineState && <span class={`mine ${mineState}`} aria-hidden="true" />}
              <span class="d">{n}</span>
              <span class="n">{d.free}</span>
            </button>
          );
        })}
      </div>
      <p class="legend" style="padding-top:8px">
        <span><i style="background:var(--ink);border-radius:4px;width:8px;height:8px" />我有空</span>
        <span><i style="background:var(--wild-line);border-radius:4px;width:8px;height:8px" />我野放</span>
        <span><i style="background:#fff;box-shadow:0 0 0 2px var(--ink);border-radius:4px;width:8px;height:8px" />我有班</span>
      </p>

      {selDay && (
        <section class="section">
          <div class="spread" style="align-items:flex-start">
            <div>
              <h2>{mdw(selDay.day)}還能約 {selDay.free} 人</h2>
              <p class="note small">
                有空 {selDay.people.filter((p) => p.status === 'free').length}・邀請中 {selDay.people.filter((p) => p.status === 'invited').length}・已有班 {selDay.people.filter((p) => p.status === 'confirmed' || p.status === 'owner').length}
              </p>
            </div>
            {selDay.day >= today && (
              <button class="btn outline sm" onClick={() => go('ignite', { day: selDay.day })}>用這天點火柴</button>
            )}
          </div>
          {selDay.people.length === 0 ? (
            <p class="note" style="margin-top:12px">這天還沒有人標有空。</p>
          ) : (
            <ul class="list" style="margin-top:6px">
              {selDay.people.map((p) => (
                <li>
                  <Avatar name={p.name} />
                  <span style="flex:1">{p.name}{p.id === me.id ? '（我）' : ''}</span>
                  {p.status === 'owner' && <span class="chip dark">主整</span>}
                  {p.status === 'confirmed' && <span class="chip dark">{p.with} 的班</span>}
                  {p.status === 'invited' && <span class="chip ember">邀請中</span>}
                  {p.status === 'free' && <span class="chip">有空</span>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
