import { useState, useEffect } from 'preact/hooks';
import { useApp, useData, Icon, ICONS, Leaf } from '../ui.jsx';
import { monthStart, addMonths, monthTitle, parseDay, daysInMonth, mdw, errorText } from '../lib/text.js';

const NEXT = { none: 'free', free: 'wild', wild: 'none' };
const LABEL = { none: '沒空', free: '有空', wild: '野放' };

export function Availability() {
  const { today, api, toast } = useApp();
  const thisMonth = monthStart(today);
  const [month, setMonth] = useState(Number(today.slice(8)) >= 10 ? addMonths(thisMonth, 1) : thisMonth);
  const [data] = useData('get_month', { p_month: month });
  const [marks, setMarks] = useState({});

  useEffect(() => {
    if (data) setMarks(data.mine || {});
  }, [data]);

  const save = async (changes) => {
    try {
      await api.runAction('set_availability', { changes });
    } catch (e) {
      toast(errorText(e), true);
    }
  };

  const toggle = (day) => {
    const cur = marks[day] || 'none';
    const nx = NEXT[cur];
    setMarks({ ...marks, [day]: nx === 'none' ? undefined : nx });
    save([{ day, state: nx === 'none' ? null : nx }]);
  };

  const n = daysInMonth(month);
  const lead = parseDay(month).getUTCDay();
  const days = Array.from({ length: n }, (_, i) => month.slice(0, 8) + String(i + 1).padStart(2, '0'));
  const free = days.filter((d) => marks[d] === 'free').length;
  const wild = days.filter((d) => marks[d] === 'wild').length;
  const isNext = month === addMonths(thisMonth, 1);

  const copyLast = async () => {
    const hasAny = days.some((d) => marks[d] && d >= today);
    if (hasAny && !window.confirm('用上個月的習慣覆蓋這個月（今天以後）的標記？')) return;
    const prev = await api.rpc('get_month', { p_month: addMonths(month, -1) });
    const prevMine = prev.mine || {};
    const prevDays = Object.keys(prevMine);
    // 依「第幾個星期幾」對應，例如上個月第 2 個星期三 → 這個月第 2 個星期三
    const key = (d) => `${parseDay(d).getUTCDay()}-${Math.ceil(Number(d.slice(8)) / 7)}`;
    const map = Object.fromEntries(prevDays.map((d) => [key(d), prevMine[d]]));
    const changes = days.filter((d) => d >= today).map((d) => ({ day: d, state: map[key(d)] || null }));
    const next = { ...marks };
    changes.forEach((c) => { next[c.day] = c.state || undefined; });
    setMarks(next);
    await save(changes);
    toast('已沿用上個月的習慣');
  };

  const clear = async () => {
    if (!window.confirm(`清除 ${monthTitle(month)}（今天以後）的所有標記？`)) return;
    const changes = days.filter((d) => d >= today && marks[d]).map((d) => ({ day: d, state: null }));
    const next = { ...marks };
    changes.forEach((c) => { next[c.day] = undefined; });
    setMarks(next);
    await save(changes);
  };

  return (
    <div>
      {isNext && Number(today.slice(8)) <= 20 && (
        <div class="pad"><div class="box ember">{monthTitle(month)}的班表請在 {Number(today.slice(5, 7))}/20 前標好。</div></div>
      )}
      <div class="month-nav" style="margin-top:6px">
        <button class="icon-btn" aria-label="上個月" disabled={month <= thisMonth} onClick={() => setMonth(addMonths(month, -1))}><Icon d={ICONS.back} /></button>
        <h1 class="page">{monthTitle(month)}</h1>
        <button class="icon-btn" aria-label="下個月" onClick={() => setMonth(addMonths(month, 1))}><Icon d={ICONS.next} /></button>
      </div>
      <div class="pad stack" style="gap:6px">
        <div class="row" style="gap:14px;font-size:12px">
          <span class="row" style="gap:5px"><i class="avail-cell" style="width:14px;height:14px;border-radius:4px;display:inline-block" />沒空</span>
          <span class="row" style="gap:5px"><i class="avail-cell free" style="width:14px;height:14px;border-radius:4px;display:inline-block" />有空</span>
          <span class="row" style="gap:5px"><i class="avail-cell wild" style="width:14px;height:14px;border-radius:4px;display:inline-block" />野放</span>
          <span style="margin-left:auto" class="row">
            <button class="btn sm" onClick={copyLast}>沿用上月習慣</button>
            <button class="btn sm" onClick={clear}>清除</button>
          </span>
        </div>
        <p class="note">點一下切換：沒空 → 有空 → 野放。野放＝這天在別處工作或出去玩，不太能看手機。改了就會存，不用按送出。</p>
      </div>
      <div class="week" style="margin-top:10px" aria-hidden="true">{['日', '一', '二', '三', '四', '五', '六'].map((w) => <span>{w}</span>)}</div>
      <div class="grid">
        {Array.from({ length: lead }).map(() => <div />)}
        {days.map((d) => {
          const st = marks[d] || 'none';
          const past = d < today;
          return (
            <button class={`avail-cell ${st === 'none' ? '' : st}`} disabled={past} style={past ? 'opacity:.35' : ''}
              aria-label={`${mdw(d)}，${LABEL[st]}`} onClick={() => toggle(d)}>
              <span class="n">{Number(d.slice(8))}</span>
              {st === 'free' && <span class="s">有空</span>}
              {st === 'wild' && <span class="s row" style="gap:2px"><Leaf />野放</span>}
            </button>
          );
        })}
      </div>
      <div class="pad" style="margin-top:14px">
        <p class="note">野放的日子，月曆上其他夥伴看到的是「沒空」；邀請你的火柴看得到你在野放，知道你為什麼晚回。這天收到邀請，倒數會等到 18:00 才開始。</p>
        <div class="row" style="gap:16px;margin-top:12px">
          <span>有空 <b style="font-size:22px">{free}</b> 天</span>
          <span style="color:#6B6020">野放 {wild} 天</span>
        </div>
      </div>
    </div>
  );
}
