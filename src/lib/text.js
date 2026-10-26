// 日期、時間與文案

const WD = ['日', '一', '二', '三', '四', '五', '六'];

export function parseDay(s) {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
export function dayStr(date) {
  return date.toISOString().slice(0, 10);
}
export function addDays(s, n) {
  const d = parseDay(s);
  d.setUTCDate(d.getUTCDate() + n);
  return dayStr(d);
}
export function weekday(s) {
  return WD[parseDay(s).getUTCDay()];
}
export function md(s) {
  const d = parseDay(s);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
export function mdw(s) {
  return `${md(s)}（${weekday(s)}）`;
}
export function monthTitle(s) {
  const d = parseDay(s);
  return `${d.getUTCFullYear()} 年 ${d.getUTCMonth() + 1} 月`;
}
export function monthStart(s) {
  return s.slice(0, 8) + '01';
}
export function addMonths(s, n) {
  const d = parseDay(monthStart(s));
  d.setUTCMonth(d.getUTCMonth() + n);
  return dayStr(d);
}
export function daysInMonth(s) {
  const d = parseDay(monthStart(s));
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
}

// 台北時間的 HH:MM
export function twTime(iso) {
  const d = new Date(new Date(iso).getTime() + 8 * 3600 * 1000);
  return d.toISOString().slice(11, 16);
}
export function twDay(iso) {
  return new Date(new Date(iso).getTime() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}
export function twStamp(iso) {
  return `${md(twDay(iso))} ${twTime(iso)}`;
}

export function remaining(deadlineIso, nowIso) {
  const ms = new Date(deadlineIso) - new Date(nowIso);
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? `${h} 小時 ${m} 分` : `${m} 分`;
}

export const TYPES = ['打包', '上架', '整理', '打包＋上架'];

export const REASONS = {
  more_important: '有更重要的安排',
  unwell: '身體不適',
};

const ERRORS = {
  not_authenticated: '請重新登入。',
  not_active: '你的帳號還沒開通，請找管理者核准。',
  not_admin: '只有管理者可以做這件事。',
  not_owner: '只有這根火柴的主整可以修改。',
  not_found: '找不到這筆資料，可能已經被修改了。',
  days_required: '請至少選一天。',
  day_required: '請選日期。',
  day_in_past: '不能選已經過去的日子。',
  day_exists: '這個案子已經有這一天了。',
  bad_need: '人數至少要 1 人。',
  owner_conflict: '你這天已經有 {} 的班了。',
  member_busy: '{} 這天已經有班了，不能選。',
  member_not_active: '這位夥伴目前暫停接案。',
  cannot_invite_self: '不能邀請自己。',
  duplicate_member: '{} 已經在名單裡了。',
  wage_required: '請填 {} 的時薪（第一次合作）。',
  too_many_direct: '直接加入的人數超過這天需要的人數了。',
  invite_closed: '這個邀請已經關閉了。',
  already_busy: '你這天已經有 {} 的班了。',
  bad_reason: '請選擇取消原因。',
  not_confirmed: '這個班不是已確認的狀態。',
  nothing_pending: '沒有需要回覆的時間變更。',
  cannot_make_direct: '這位夥伴目前不能直接加入。',
  case_extinguished: '這根火柴已經熄滅了。',
  day_removed: '這一天已經從案子移除了。',
  bad_state: '填班狀態有誤。',
};

const CLOSED = {
  full: '這天已經額滿了，謝謝你。',
  taken: '你這天已經確認了別的班。',
  withdrawn: '火柴已經撤回這個邀請。',
  declined: '你已經婉拒了。',
  confirmed: '你已經確認了。',
};

export function errorText(e) {
  const raw = String(e?.message || e);
  const msg = raw.split('\n')[0];
  const [code, ...rest] = msg.split(':');
  const arg = rest.join(':');
  if (code === 'invite_closed' && CLOSED[arg]) return CLOSED[arg];
  if (ERRORS[code]) return ERRORS[code].replace('{}', arg);
  if (/check constraint "cases_area_check"/.test(raw)) return '請填區域。';
  return '發生錯誤：' + msg;
}

// 通知文案
export function noteText(n) {
  const p = n.payload || {};
  const when = p.day ? mdw(p.day) : '';
  const who = p.member_name;
  switch (n.kind) {
    case 'invite': return `${p.owner_name} 邀你 ${when}出班（${p.area}・${p.job_type}）`;
    case 'direct_added': return `${p.owner_name} 把你加進 ${when}的班（${p.area}）`;
    case 'closed_full': return `${p.owner_name} ${when}的案子已經額滿`;
    case 'withdrawn': return `${p.owner_name} 撤回了 ${when}的邀請`;
    case 'released': return `${p.owner_name} ${when}的案子減少人手，你的班已釋出`;
    case 'moved': return `${p.owner_name} 的案子改期了（原本 ${when}），新日期會另外邀請`;
    case 'case_cancelled': return `${p.owner_name} ${when}的案子取消了`;
    case 'time_change': return `${p.owner_name} ${when}的時間改成 ${p.start_time}–${p.end_time}，請回覆`;
    case 'case_updated': return `${p.owner_name} ${when}的案子資料更新了`;
    case 'replaced_out': return `${p.owner_name} ${when}的班已由 ${p.new_member_name} 代班`;
    case 'replaced_in': return `你代替 ${p.old_member_name} 出 ${p.owner_name} ${when}的班`;
    case 'day_before': return `明天 ${when}有班：${p.owner_name}・${p.area}・${p.start_time}`;
    case 'fill_reminder': return `${Number(p.month?.slice(5))} 月班表開放填寫，20 號前記得標好有空的日子`;
    case 'confirmed': return `${who} 確認了 ${when}的班`;
    case 'declined': return `${who} 婉拒了 ${when}的邀請`;
    case 'full': return `${when}人數已滿（${p.area}）`;
    case 'taken_elsewhere': return `${who} ${when}已經確認別的班，已自動補位`;
    case 'list_exhausted': return `${when}候補用完了，還差 ${p.missing} 人，請加人`;
    case 'cancelled': return `${who} 取消了 ${when}的班（${REASONS[p.reason] || ''}）${p.urgent ? '・急' : ''}，已自動補位`;
    case 'time_change_ok': return `${who} 可以配合 ${when}的新時間`;
    case 'time_change_declined': return `${who} 無法配合 ${when}的新時間，已自動補位`;
    default: return n.kind;
  }
}

export function noteTarget(kind) {
  if (['invite', 'direct_added', 'closed_full', 'withdrawn', 'released', 'moved', 'case_cancelled',
    'time_change', 'case_updated', 'replaced_out', 'replaced_in', 'day_before'].includes(kind)) return 'shifts';
  if (kind === 'fill_reminder') return 'avail';
  return 'cases';
}
