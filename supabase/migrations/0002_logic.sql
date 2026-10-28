-- 賣女孩的小火柴：排班規則
-- 錯誤訊息格式為「代碼」或「代碼:參數」，前端負責翻成中文。

------------------------------------------------------------
-- 基本工具
------------------------------------------------------------

-- 現在時間（測試與試玩模式可用 app.now 快轉）
create or replace function app_now() returns timestamptz
language sql stable as $$
  select coalesce(nullif(current_setting('app.now', true), '')::timestamptz, now())
$$;

-- 目前登入的成員：正式版用 Supabase 登入帳號（JWT 的 sub）對應到成員；試玩／測試用 app.member_id
create or replace function app_member_id() returns uuid
language sql stable security definer as $$
  select coalesce(
    nullif(current_setting('app.member_id', true), '')::uuid,
    (select id from members
      where auth_user_id = nullif(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub', '')::uuid)
  )
$$;

create or replace function tw(ts timestamptz) returns timestamp
language sql immutable as $$ select ts at time zone 'Asia/Taipei' $$;

create or replace function tw_ts(local timestamp) returns timestamptz
language sql immutable as $$ select local at time zone 'Asia/Taipei' $$;

create or replace function tw_today() returns date
language sql stable as $$ select tw(app_now())::date $$;

create or replace function require_member() returns members
language plpgsql stable as $$
declare m members;
begin
  select * into m from members where id = app_member_id();
  if m.id is null then raise exception 'not_authenticated'; end if;
  if m.status <> 'active' then raise exception 'not_active'; end if;
  return m;
end $$;

create or replace function require_admin() returns members
language plpgsql stable as $$
declare m members;
begin
  m := require_member();
  if m.role <> 'admin' then raise exception 'not_admin'; end if;
  return m;
end $$;

create or replace function notify(p_member uuid, p_kind text, p_payload jsonb default '{}'::jsonb) returns void
language sql as $$
  insert into notifications (member_id, kind, payload, created_at)
  select p_member, p_kind, p_payload, app_now() where p_member is not null   -- 鄰家女孩沒有帳號，不發通知
$$;

create or replace function audit(p_action text, p_detail jsonb default '{}'::jsonb) returns void
language sql as $$
  insert into audit_log (actor_id, action, detail, created_at) values (app_member_id(), p_action, p_detail, app_now())
$$;

create or replace function member_name(p_member uuid) returns text
language sql stable as $$ select name from members where id = p_member $$;

------------------------------------------------------------
-- 是否已有班：已確認別的案子，或自己是火柴且那天「我也出班」
-- 回傳那天的火柴名字（自己當火柴時回傳自己的名字），沒班回傳 null
------------------------------------------------------------
create or replace function member_busy(p_member uuid, p_day date, p_except_case_day uuid default null) returns text
language sql stable as $$
  select owner_name from (
    select m.name as owner_name
      from assignments a
      join case_days d on d.id = a.case_day_id
      join cases c on c.id = d.case_id
      join members m on m.id = c.owner_id
     where a.member_id = p_member and a.state = 'confirmed'
       and d.day = p_day and d.status = 'active' and c.status = 'active'
       and d.id is distinct from p_except_case_day
    union all
    select m.name
      from case_days d
      join cases c on c.id = d.case_id
      join members m on m.id = c.owner_id
     where c.owner_id = p_member and d.self_on
       and d.day = p_day and d.status = 'active' and c.status = 'active'
       and d.id is distinct from p_except_case_day
  ) x limit 1
$$;

------------------------------------------------------------
-- 回覆期限
--   距出班日超過 7 天：12 小時；3–7 天：4 小時；3 天內：2 小時
--   22:00–08:00 不倒數
--   收到邀請當天她出班中或野放：等到 18:00 才開始倒數
------------------------------------------------------------
create or replace function add_active_hours(p_start timestamptz, p_hours numeric) returns timestamptz
language plpgsql immutable as $$
declare
  cur timestamp := tw(p_start);
  remaining interval := make_interval(secs => p_hours * 3600);
  window_end timestamp;
begin
  loop
    if cur::time >= time '22:00' then
      cur := (cur::date + 1) + time '08:00';
    elsif cur::time < time '08:00' then
      cur := cur::date + time '08:00';
    end if;
    window_end := cur::date + time '22:00';
    if cur + remaining <= window_end then
      return tw_ts(cur + remaining);
    end if;
    remaining := remaining - (window_end - cur);
    cur := window_end;
  end loop;
end $$;

create or replace function reply_hours(p_invited_at timestamptz, p_day date) returns int
language sql immutable as $$
  select case
    when p_day - tw(p_invited_at)::date > 7 then 12
    when p_day - tw(p_invited_at)::date >= 3 then 4
    else 2
  end
$$;

create or replace function busy_today(p_member uuid, p_at timestamptz) returns boolean
language sql stable as $$
  select member_busy(p_member, tw(p_at)::date) is not null
      or exists (select 1 from availability
                  where member_id = p_member and day = tw(p_at)::date and state = 'wild')
$$;

create or replace function compute_deadline(p_member uuid, p_invited_at timestamptz, p_day date) returns timestamptz
language plpgsql stable as $$
declare
  start_at timestamptz := p_invited_at;
  evening timestamptz := tw_ts(tw(p_invited_at)::date + time '18:00');
begin
  if busy_today(p_member, p_invited_at) and start_at < evening then
    start_at := evening;
  end if;
  return add_active_hours(start_at, reply_hours(p_invited_at, p_day));
end $$;

------------------------------------------------------------
-- 時薪：自動帶入這位火柴上次和她合作的金額
------------------------------------------------------------
create or replace function last_wage(p_owner uuid, p_member uuid) returns int
language sql stable as $$
  select w.wage
    from assignments a
    join assignment_wages w on w.assignment_id = a.id
    join case_days d on d.id = a.case_day_id
    join cases c on c.id = d.case_id
   where c.owner_id = p_owner and a.member_id = p_member
   order by a.created_at desc
   limit 1
$$;

create or replace function confirmed_count(p_case_day uuid) returns int
language sql stable as $$
  select (select count(*)::int from assignments where case_day_id = p_case_day and state = 'confirmed')
       + (select case when self_on then 1 else 0 end from case_days where id = p_case_day)
$$;

-- 通知內容用的案件摘要
create or replace function day_summary(p_case_day uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'case_id', c.id, 'case_day_id', d.id, 'day', d.day,
    'area', c.area, 'job_type', c.job_type,
    'start_time', to_char(c.start_time, 'HH24:MI'), 'end_time', to_char(c.end_time, 'HH24:MI'),
    'owner_id', c.owner_id, 'owner_name', m.name)
    from case_days d join cases c on c.id = d.case_id join members m on m.id = c.owner_id
   where d.id = p_case_day
$$;

------------------------------------------------------------
-- 核心：依人數與順位發出邀請、處理額滿
------------------------------------------------------------
create or replace function dispatch(p_case_day uuid) returns void
language plpgsql as $$
declare
  d case_days;
  c cases;
  remaining int;
  outstanding int;
  to_invite int;
  r record;
  dl timestamptz;
  now_ts timestamptz := app_now();
begin
  select * into d from case_days where id = p_case_day for update;
  if d.id is null or d.status <> 'active' or d.started then return; end if;
  select * into c from cases where id = d.case_id;
  if c.status <> 'active' then return; end if;

  remaining := d.need - confirmed_count(d.id);

  if remaining <= 0 then
    -- 額滿：還沒回覆的邀請全部關閉
    for r in select a.id, a.member_id from assignments a where a.case_day_id = d.id and a.state = 'invited' loop
      update assignments set state = 'full' where id = r.id;
      perform notify(r.member_id, 'closed_full', day_summary(d.id));
    end loop;
    if not d.full_notified then
      update case_days set full_notified = true where id = d.id;
      perform notify(c.owner_id, 'full', day_summary(d.id));
    end if;
    return;
  end if;

  if d.full_notified then
    update case_days set full_notified = false where id = d.id;
  end if;

  select count(*) into outstanding from assignments
   where case_day_id = d.id and state = 'invited' and not overdue;

  if d.urgent then
    to_invite := 1000000;   -- 急件：候補全部同時邀請
  else
    to_invite := remaining - outstanding;
  end if;

  for r in
    select a.id, a.member_id, mb.status as member_status
      from assignments a join members mb on mb.id = a.member_id
     where a.case_day_id = d.id and a.state = 'queued'
     order by a.rank
  loop
    exit when to_invite <= 0;
    if r.member_status <> 'active' or member_busy(r.member_id, d.day, d.id) is not null then
      update assignments set state = 'skipped' where id = r.id;
      continue;
    end if;
    dl := compute_deadline(r.member_id, now_ts, d.day);
    update assignments
       set state = 'invited', invited_at = now_ts, deadline = dl, overdue = false
     where id = r.id;
    perform notify(r.member_id, 'invite',
      day_summary(d.id) || jsonb_build_object(
        'assignment_id', r.id,
        'deadline', dl,
        'wage', (select wage from assignment_wages where assignment_id = r.id)));
    to_invite := to_invite - 1;
  end loop;

  -- 候補用完：就算還在等回覆的人全部答應，人數也不夠，提醒火柴加人
  select count(*) into outstanding from assignments
   where case_day_id = d.id and state = 'invited' and not overdue;
  if not exists (select 1 from assignments where case_day_id = d.id and state = 'queued')
     and outstanding < remaining then
    if not d.exhausted_notified then
      update case_days set exhausted_notified = true where id = d.id;
      perform notify(c.owner_id, 'list_exhausted',
        day_summary(d.id) || jsonb_build_object('missing', remaining - outstanding));
    end if;
  else
    if d.exhausted_notified then
      update case_days set exhausted_notified = false where id = d.id;
    end if;
  end if;
end $$;

-- 她這天有班了：關閉她同一天其他還在等的邀請，並幫那些火柴補位
create or replace function close_other_invites(p_member uuid, p_day date, p_except_case_day uuid) returns void
language plpgsql as $$
declare r record;
begin
  for r in
    select a.id, a.case_day_id, c.owner_id
      from assignments a
      join case_days d on d.id = a.case_day_id
      join cases c on c.id = d.case_id
     where a.member_id = p_member and a.state = 'invited'
       and d.day = p_day and d.id is distinct from p_except_case_day
  loop
    update assignments set state = 'taken' where id = r.id;
    perform notify(r.owner_id, 'taken_elsewhere',
      day_summary(r.case_day_id) || jsonb_build_object('member_id', p_member, 'member_name', member_name(p_member)));
    perform dispatch(r.case_day_id);
  end loop;
end $$;

-- 女孩取消（內部共用，撞期取消也走這裡）
create or replace function cancel_assignment(p_assignment uuid, p_reason text) returns void
language plpgsql as $$
declare
  a assignments;
  d case_days;
  c cases;
begin
  if p_reason not in ('more_important', 'unwell') then raise exception 'bad_reason'; end if;
  select * into a from assignments where id = p_assignment for update;
  if a.id is null or a.state <> 'confirmed' then raise exception 'not_confirmed'; end if;
  select * into d from case_days where id = a.case_day_id;
  select * into c from cases where id = d.case_id;
  update assignments set state = 'cancelled', cancel_reason = p_reason, responded_at = app_now() where id = a.id;
  perform notify(c.owner_id, 'cancelled',
    day_summary(d.id) || jsonb_build_object(
      'member_id', a.member_id, 'member_name', member_name(a.member_id),
      'reason', p_reason, 'urgent', (d.day - tw_today()) < 3));
  perform audit('cancel', jsonb_build_object('assignment_id', a.id, 'reason', p_reason));
  perform dispatch(d.id);
end $$;

-- 釋出已確認的人（火柴減人、改期、少一天、熄滅、時間變更沒辦法）
create or replace function release_assignment(p_assignment uuid, p_reason text, p_kind text default 'released') returns void
language plpgsql as $$
declare a assignments;
begin
  select * into a from assignments where id = p_assignment for update;
  if a.state = 'confirmed' then
    update assignments set state = 'released', release_reason = p_reason where id = a.id;
    perform notify(a.member_id, p_kind, day_summary(a.case_day_id) || jsonb_build_object('reason', p_reason));
  elsif a.state = 'invited' then
    update assignments set state = 'withdrawn', release_reason = p_reason where id = a.id;
    perform notify(a.member_id, case when p_kind = 'released' then 'withdrawn' else p_kind end,
      day_summary(a.case_day_id) || jsonb_build_object('reason', p_reason));
  elsif a.state = 'queued' then
    update assignments set state = 'withdrawn', release_reason = p_reason where id = a.id;
  end if;
end $$;

------------------------------------------------------------
-- 建立一天的人手（點燃與加一天共用）
-- spec: {day, need, self_on, urgent, people:[{member_id, wage, direct}]}
------------------------------------------------------------
create or replace function create_case_day(p_case uuid, spec jsonb, p_cancel jsonb default null) returns uuid
language plpgsql as $$
declare
  c cases;
  v_day date := (spec ->> 'day')::date;
  v_need int := coalesce((spec ->> 'need')::int, 2);
  v_self boolean := coalesce((spec ->> 'self_on')::boolean, true);
  v_urgent boolean := coalesce((spec ->> 'urgent')::boolean, false);
  cd uuid;
  busy text;
  conflict assignments;
  person jsonb;
  pm members;
  v_rank int := 0;
  v_wage int;
  v_direct boolean;
  direct_total int := 0;
  aid uuid;
begin
  select * into c from cases where id = p_case;
  if v_day is null then raise exception 'day_required'; end if;
  if v_day < tw_today() then raise exception 'day_in_past'; end if;
  if v_need < 1 then raise exception 'bad_need'; end if;
  if exists (select 1 from case_days where case_id = p_case and day = v_day and status = 'active') then
    raise exception 'day_exists';
  end if;

  -- 撞期：火柴自己這天已有班
  if v_self then
    busy := member_busy(c.owner_id, v_day);
    if busy is not null then
      select a.* into conflict
        from assignments a join case_days d on d.id = a.case_day_id join cases cc on cc.id = d.case_id
       where a.member_id = c.owner_id and a.state = 'confirmed' and d.day = v_day
         and d.status = 'active' and cc.status = 'active'
       limit 1;
      if conflict.id is not null and p_cancel is not null
         and (p_cancel ->> 'assignment_id')::uuid = conflict.id then
        perform cancel_assignment(conflict.id, p_cancel ->> 'reason');
      else
        raise exception 'owner_conflict:%', busy;
      end if;
    end if;
  end if;

  -- 舊的同日已移除資料列，避免 unique 衝突
  delete from case_days where case_id = p_case and day = v_day and status = 'removed';

  insert into case_days (case_id, day, need, self_on, urgent)
  values (p_case, v_day, v_need, v_self, v_urgent) returning id into cd;

  if v_self then
    perform close_other_invites(c.owner_id, v_day, cd);
  end if;

  for person in select * from jsonb_array_elements(coalesce(spec -> 'people', '[]'::jsonb)) loop
    if nullif(trim(coalesce(person ->> 'guest_name', '')), '') is not null then
      -- 鄰家女孩：直接算已確認，時薪可不填
      v_rank := v_rank + 1;
      insert into assignments (case_day_id, guest_name, rank, state, direct, responded_at, created_at)
      values (cd, trim(person ->> 'guest_name'), v_rank, 'confirmed', true, app_now(), app_now()) returning id into aid;
      if nullif(person ->> 'wage', '') is not null then
        insert into assignment_wages (assignment_id, wage) values (aid, (person ->> 'wage')::int);
      end if;
      direct_total := direct_total + 1;
      continue;
    end if;
    select * into pm from members where id = (person ->> 'member_id')::uuid;
    if pm.id is null or pm.status <> 'active' then raise exception 'member_not_active'; end if;
    if pm.id = c.owner_id then raise exception 'cannot_invite_self'; end if;
    if exists (select 1 from assignments where case_day_id = cd and member_id = pm.id) then
      raise exception 'duplicate_member:%', pm.name;
    end if;
    busy := member_busy(pm.id, v_day, cd);
    if busy is not null then raise exception 'member_busy:%', pm.name; end if;
    v_wage := coalesce(nullif(person ->> 'wage', '')::int, last_wage(c.owner_id, pm.id));
    if v_wage is null then raise exception 'wage_required:%', pm.name; end if;
    v_direct := coalesce((person ->> 'direct')::boolean, false);
    v_rank := v_rank + 1;
    insert into assignments (case_day_id, member_id, rank, state, direct, responded_at, created_at)
    values (cd, pm.id, v_rank, case when v_direct then 'confirmed' else 'queued' end, v_direct,
            case when v_direct then app_now() end, app_now())
    returning id into aid;
    insert into assignment_wages (assignment_id, wage) values (aid, v_wage);
    if v_direct then
      direct_total := direct_total + 1;
      perform notify(pm.id, 'direct_added', day_summary(cd) || jsonb_build_object('assignment_id', aid, 'wage', v_wage));
      perform close_other_invites(pm.id, v_day, cd);
    end if;
  end loop;

  if direct_total + (case when v_self then 1 else 0 end) > v_need then
    raise exception 'too_many_direct';
  end if;

  perform dispatch(cd);
  return cd;
end $$;

------------------------------------------------------------
-- 點燃火柴
------------------------------------------------------------
create or replace function ignite(p jsonb) returns uuid
language plpgsql security definer as $$
declare
  me members := require_member();
  cid uuid;
  spec jsonb;
begin
  if jsonb_array_length(coalesce(p -> 'days', '[]'::jsonb)) = 0 then raise exception 'days_required'; end if;
  insert into cases (owner_id, area, job_type, start_time, end_time, created_at, updated_at)
  values (me.id, trim(coalesce(p ->> 'area', '')), p ->> 'job_type',
          coalesce((p ->> 'start_time')::time, '09:00'), coalesce((p ->> 'end_time')::time, '16:00'),
          app_now(), app_now())
  returning id into cid;
  if nullif(trim(coalesce(p ->> 'address', '')), '') is not null then
    insert into case_addresses (case_id, address) values (cid, trim(p ->> 'address'));
  end if;
  for spec in select * from jsonb_array_elements(p -> 'days') order by (value ->> 'day') loop
    perform create_case_day(cid, spec, coalesce(spec -> 'cancel_conflict', p -> 'cancel_conflict'));
  end loop;
  perform audit('ignite', jsonb_build_object('case_id', cid));
  return cid;
end $$;

------------------------------------------------------------
-- 女孩的動作
------------------------------------------------------------
create or replace function respond_invite(p_assignment uuid, p_accept boolean) returns text
language plpgsql security definer as $$
declare
  me members := require_member();
  a assignments;
  d case_days;
  c cases;
  busy text;
begin
  select * into a from assignments where id = p_assignment for update;
  if a.id is null or a.member_id <> me.id then raise exception 'not_found'; end if;
  if a.state <> 'invited' then raise exception 'invite_closed:%', a.state; end if;
  select * into d from case_days where id = a.case_day_id;
  select * into c from cases where id = d.case_id;
  if d.status <> 'active' or c.status <> 'active' then raise exception 'invite_closed:withdrawn'; end if;

  if p_accept then
    busy := member_busy(me.id, d.day, d.id);
    if busy is not null then raise exception 'already_busy:%', busy; end if;
    if confirmed_count(d.id) >= d.need then
      update assignments set state = 'full' where id = a.id;
      raise exception 'invite_closed:full';
    end if;
    update assignments set state = 'confirmed', responded_at = app_now(), time_change_pending = false where id = a.id;
    perform notify(c.owner_id, 'confirmed',
      day_summary(d.id) || jsonb_build_object('member_id', me.id, 'member_name', me.name));
    perform close_other_invites(me.id, d.day, d.id);
    perform dispatch(d.id);
    return 'confirmed';
  else
    update assignments set state = 'declined', responded_at = app_now() where id = a.id;
    perform notify(c.owner_id, 'declined',
      day_summary(d.id) || jsonb_build_object('member_id', me.id, 'member_name', me.name));
    perform dispatch(d.id);
    return 'declined';
  end if;
end $$;

create or replace function cancel_shift(p_assignment uuid, p_reason text) returns void
language plpgsql security definer as $$
declare
  me members := require_member();
  a assignments;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or a.member_id <> me.id then raise exception 'not_found'; end if;
  perform cancel_assignment(p_assignment, p_reason);
end $$;

create or replace function respond_time_change(p_assignment uuid, p_ok boolean) returns void
language plpgsql security definer as $$
declare
  me members := require_member();
  a assignments;
  owner uuid;
begin
  select * into a from assignments where id = p_assignment for update;
  if a.id is null or a.member_id <> me.id then raise exception 'not_found'; end if;
  if not a.time_change_pending or a.state <> 'confirmed' then raise exception 'nothing_pending'; end if;
  select c.owner_id into owner from case_days d join cases c on c.id = d.case_id where d.id = a.case_day_id;
  if p_ok then
    update assignments set time_change_pending = false where id = a.id;
    perform notify(owner, 'time_change_ok',
      day_summary(a.case_day_id) || jsonb_build_object('member_id', me.id, 'member_name', me.name));
  else
    update assignments set state = 'released', release_reason = 'time_change', time_change_pending = false where id = a.id;
    perform notify(owner, 'time_change_declined',
      day_summary(a.case_day_id) || jsonb_build_object('member_id', me.id, 'member_name', me.name));
    perform audit('time_change_declined', jsonb_build_object('assignment_id', a.id));
    perform dispatch(a.case_day_id);
  end if;
end $$;

-- 填班：changes = [{day, state}]，state 為 'free'、'wild' 或 null（沒空）
create or replace function set_availability(changes jsonb) returns void
language plpgsql security definer as $$
declare
  me members := require_member();
  ch jsonb;
begin
  for ch in select * from jsonb_array_elements(changes) loop
    if nullif(ch ->> 'state', '') is null then
      delete from availability where member_id = me.id and day = (ch ->> 'day')::date;
    else
      if ch ->> 'state' not in ('free', 'wild') then raise exception 'bad_state'; end if;
      insert into availability (member_id, day, state) values (me.id, (ch ->> 'day')::date, ch ->> 'state')
      on conflict (member_id, day) do update set state = excluded.state;
    end if;
  end loop;
end $$;

create or replace function mark_notifications_read() returns void
language sql security definer as $$
  update notifications set read_at = app_now() where member_id = app_member_id() and read_at is null
$$;

------------------------------------------------------------
-- 火柴的動作
------------------------------------------------------------
create or replace function require_owner_of_case(p_case uuid) returns cases
language plpgsql stable as $$
declare
  me members := require_member();
  c cases;
begin
  select * into c from cases where id = p_case;
  if c.id is null then raise exception 'not_found'; end if;
  if c.owner_id <> me.id and me.role <> 'admin' then raise exception 'not_owner'; end if;
  if c.status <> 'active' then raise exception 'case_extinguished'; end if;
  return c;
end $$;

create or replace function require_owner_of_day(p_case_day uuid) returns case_days
language plpgsql stable as $$
declare d case_days;
begin
  select * into d from case_days where id = p_case_day;
  if d.id is null then raise exception 'not_found'; end if;
  perform require_owner_of_case(d.case_id);
  if d.status <> 'active' then raise exception 'day_removed'; end if;
  return d;
end $$;

-- 修改案件基本資料；改時間會請已確認的人回覆「沒問題／沒辦法」
create or replace function update_case(p_case uuid, p jsonb) returns void
language plpgsql security definer as $$
declare
  c cases := require_owner_of_case(p_case);
  new_start time := coalesce((p ->> 'start_time')::time, c.start_time);
  new_end time := coalesce((p ->> 'end_time')::time, c.end_time);
  r record;
begin
  update cases set
    area = coalesce(nullif(trim(p ->> 'area'), ''), area),
    job_type = coalesce(p ->> 'job_type', job_type),
    start_time = new_start, end_time = new_end,
    updated_at = app_now()
  where id = c.id;

  if p ? 'address' then
    if nullif(trim(coalesce(p ->> 'address', '')), '') is null then
      delete from case_addresses where case_id = c.id;
    else
      insert into case_addresses (case_id, address) values (c.id, trim(p ->> 'address'))
      on conflict (case_id) do update set address = excluded.address;
    end if;
  end if;

  if new_start <> c.start_time or new_end <> c.end_time then
    for r in
      select a.id, a.member_id, a.case_day_id from assignments a join case_days d on d.id = a.case_day_id
       where d.case_id = c.id and d.status = 'active' and a.state = 'confirmed'
    loop
      update assignments set time_change_pending = true where id = r.id;
      perform notify(r.member_id, 'time_change', day_summary(r.case_day_id) || jsonb_build_object(
        'assignment_id', r.id,
        'old_start', to_char(c.start_time, 'HH24:MI'), 'old_end', to_char(c.end_time, 'HH24:MI')));
    end loop;
    for r in
      select a.member_id, a.case_day_id from assignments a join case_days d on d.id = a.case_day_id
       where d.case_id = c.id and d.status = 'active' and a.state = 'invited'
    loop
      perform notify(r.member_id, 'case_updated', day_summary(r.case_day_id));
    end loop;
  end if;
  perform audit('update_case', jsonb_build_object('case_id', c.id, 'changes', p));
end $$;

-- 調整某天的人數、我也出班、急件；p_release 指定要釋出的人（不指定就釋出順位最後的）
create or replace function set_day_options(p_case_day uuid, p jsonb) returns void
language plpgsql security definer as $$
declare
  d case_days := require_owner_of_day(p_case_day);
  c cases;
  v_need int := coalesce((p ->> 'need')::int, d.need);
  v_self boolean := coalesce((p ->> 'self_on')::boolean, d.self_on);
  v_urgent boolean := coalesce((p ->> 'urgent')::boolean, d.urgent);
  busy text;
  rid uuid;
  over int;
  r record;
begin
  select * into c from cases where id = d.case_id;
  if v_need < 1 then raise exception 'bad_need'; end if;

  if v_self and not d.self_on then
    busy := member_busy(c.owner_id, d.day, d.id);
    if busy is not null then raise exception 'owner_conflict:%', busy; end if;
  end if;

  update case_days set need = v_need, self_on = v_self, urgent = v_urgent where id = d.id;
  if v_self and not d.self_on then
    perform close_other_invites(c.owner_id, d.day, d.id);
  end if;

  -- 指定釋出的人
  for rid in select (jsonb_array_elements_text(coalesce(p -> 'release', '[]'::jsonb)))::uuid loop
    if exists (select 1 from assignments where id = rid and case_day_id = d.id and state = 'confirmed') then
      perform release_assignment(rid, 'need_reduced');
    end if;
  end loop;

  -- 人數變少：先撤回邀請中的，再從順位最後釋出已確認的
  over := confirmed_count(d.id)
        + (select count(*)::int from assignments where case_day_id = d.id and state = 'invited' and not overdue)
        - v_need;
  if over > 0 then
    for r in select id from assignments where case_day_id = d.id and state = 'invited' order by rank desc loop
      exit when over <= 0;
      perform release_assignment(r.id, 'need_reduced');
      over := over - 1;
    end loop;
  end if;
  over := confirmed_count(d.id) - v_need;
  if over > 0 then
    for r in select id from assignments where case_day_id = d.id and state = 'confirmed' order by rank desc loop
      exit when over <= 0;
      perform release_assignment(r.id, 'need_reduced');
      over := over - 1;
    end loop;
  end if;

  perform audit('set_day_options', jsonb_build_object('case_day_id', d.id, 'changes', p));
  perform dispatch(d.id);
end $$;

-- 加人到順位最後：people = [{member_id, wage, direct}]
create or replace function add_people(p_case_day uuid, people jsonb) returns void
language plpgsql security definer as $$
declare
  d case_days := require_owner_of_day(p_case_day);
  c cases;
  person jsonb;
  pm members;
  v_rank int;
  v_wage int;
  v_direct boolean;
  aid uuid;
  existing assignments;
begin
  select * into c from cases where id = d.case_id;
  select coalesce(max(rank), 0) into v_rank from assignments where case_day_id = d.id;
  for person in select * from jsonb_array_elements(people) loop
    select * into pm from members where id = (person ->> 'member_id')::uuid;
    if pm.id is null or pm.status <> 'active' then raise exception 'member_not_active'; end if;
    if pm.id = c.owner_id then raise exception 'cannot_invite_self'; end if;
    if member_busy(pm.id, d.day, d.id) is not null then raise exception 'member_busy:%', pm.name; end if;
    v_wage := coalesce(nullif(person ->> 'wage', '')::int, last_wage(c.owner_id, pm.id));
    if v_wage is null then raise exception 'wage_required:%', pm.name; end if;
    v_direct := coalesce((person ->> 'direct')::boolean, false);
    if v_direct and confirmed_count(d.id) >= d.need then raise exception 'too_many_direct'; end if;
    v_rank := v_rank + 1;

    select * into existing from assignments where case_day_id = d.id and member_id = pm.id;
    if existing.id is not null then
      if existing.state in ('queued', 'invited', 'confirmed') then raise exception 'duplicate_member:%', pm.name; end if;
      -- 之前婉拒或被釋出的人重新排進來
      update assignments set rank = v_rank, state = case when v_direct then 'confirmed' else 'queued' end,
             direct = v_direct, overdue = false, invited_at = null, deadline = null,
             responded_at = case when v_direct then app_now() end, cancel_reason = null, release_reason = null
       where id = existing.id returning id into aid;
      insert into assignment_wages (assignment_id, wage) values (aid, v_wage)
      on conflict (assignment_id) do update set wage = excluded.wage;
    else
      insert into assignments (case_day_id, member_id, rank, state, direct, responded_at, created_at)
      values (d.id, pm.id, v_rank, case when v_direct then 'confirmed' else 'queued' end, v_direct,
              case when v_direct then app_now() end, app_now())
      returning id into aid;
      insert into assignment_wages (assignment_id, wage) values (aid, v_wage);
    end if;

    if v_direct then
      perform notify(pm.id, 'direct_added', day_summary(d.id) || jsonb_build_object('assignment_id', aid, 'wage', v_wage));
      perform close_other_invites(pm.id, d.day, d.id);
    end if;
  end loop;
  perform audit('add_people', jsonb_build_object('case_day_id', d.id, 'people', people));
  perform dispatch(d.id);
end $$;

-- 已經在 LINE 談好：把順位上的人直接改成已確認
create or replace function make_direct(p_assignment uuid) returns void
language plpgsql security definer as $$
declare
  a assignments;
  d case_days;
  busy text;
begin
  select * into a from assignments where id = p_assignment for update;
  if a.id is null then raise exception 'not_found'; end if;
  d := require_owner_of_day(a.case_day_id);
  if a.state not in ('queued', 'invited') then raise exception 'cannot_make_direct'; end if;
  busy := member_busy(a.member_id, d.day, d.id);
  if busy is not null then raise exception 'member_busy:%', member_name(a.member_id); end if;
  if confirmed_count(d.id) >= d.need then raise exception 'too_many_direct'; end if;
  update assignments set state = 'confirmed', direct = true, responded_at = app_now() where id = a.id;
  perform notify(a.member_id, 'direct_added', day_summary(d.id) || jsonb_build_object(
    'assignment_id', a.id, 'wage', (select wage from assignment_wages where assignment_id = a.id)));
  perform close_other_invites(a.member_id, d.day, d.id);
  perform dispatch(d.id);
end $$;

-- 調整候補順序：ids 為新的順序（只影響還沒邀請的候補）
create or replace function reorder(p_case_day uuid, ids jsonb) returns void
language plpgsql security definer as $$
declare
  d case_days := require_owner_of_day(p_case_day);
  i int := 0;
  aid uuid;
begin
  for aid in select (jsonb_array_elements_text(ids))::uuid loop
    i := i + 1;
    update assignments set rank = i where id = aid and case_day_id = d.id;
  end loop;
end $$;

-- 改日期：原班人馬依原順位優先收到新日期的邀請
create or replace function move_day(p_case_day uuid, p_new_day date) returns uuid
language plpgsql security definer as $$
declare
  d case_days := require_owner_of_day(p_case_day);
  c cases;
  nd uuid;
  r record;
  i int := 0;
  aid uuid;
  busy text;
begin
  select * into c from cases where id = d.case_id;
  if p_new_day < tw_today() then raise exception 'day_in_past'; end if;
  if exists (select 1 from case_days where case_id = c.id and day = p_new_day and status = 'active') then
    raise exception 'day_exists';
  end if;
  if d.self_on then
    busy := member_busy(c.owner_id, p_new_day);
    if busy is not null then raise exception 'owner_conflict:%', busy; end if;
  end if;
  delete from case_days where case_id = c.id and day = p_new_day and status = 'removed';
  insert into case_days (case_id, day, need, self_on, urgent)
  values (c.id, p_new_day, d.need, d.self_on, d.urgent) returning id into nd;
  if d.self_on then perform close_other_invites(c.owner_id, p_new_day, nd); end if;

  for r in
    select a.id, a.member_id, a.guest_name, a.state, w.wage
      from assignments a left join assignment_wages w on w.assignment_id = a.id
     where a.case_day_id = d.id and a.state in ('confirmed', 'invited', 'queued')
     order by case when a.state = 'confirmed' then 0 else 1 end, a.rank
  loop
    i := i + 1;
    if r.member_id is null then
      -- 鄰家女孩跟著搬到新日期（火柴自己跟她確認）
      insert into assignments (case_day_id, guest_name, rank, state, direct, responded_at, created_at)
      values (nd, r.guest_name, i, 'confirmed', true, app_now(), app_now()) returning id into aid;
    else
      insert into assignments (case_day_id, member_id, rank, state, created_at)
      values (nd, r.member_id, i, 'queued', app_now()) returning id into aid;
    end if;
    if r.wage is not null then insert into assignment_wages (assignment_id, wage) values (aid, r.wage); end if;
    perform release_assignment(r.id, 'moved', 'moved');
  end loop;

  update case_days set status = 'removed' where id = d.id;
  perform audit('move_day', jsonb_build_object('case_day_id', d.id, 'new_day', p_new_day));
  perform dispatch(nd);
  return nd;
end $$;

create or replace function add_day(p_case uuid, spec jsonb, p_cancel jsonb default null) returns uuid
language plpgsql security definer as $$
declare
  c cases := require_owner_of_case(p_case);
  nd uuid;
begin
  nd := create_case_day(c.id, spec, p_cancel);
  perform audit('add_day', jsonb_build_object('case_id', c.id, 'day', spec ->> 'day'));
  return nd;
end $$;

create or replace function remove_day(p_case_day uuid) returns void
language plpgsql security definer as $$
declare
  d case_days := require_owner_of_day(p_case_day);
  r record;
begin
  for r in select id from assignments where case_day_id = d.id and state in ('confirmed', 'invited', 'queued') loop
    perform release_assignment(r.id, 'day_removed');
  end loop;
  update case_days set status = 'removed' where id = d.id;
  perform audit('remove_day', jsonb_build_object('case_day_id', d.id));
end $$;

-- 代班：把已確認的人換成另一位，位子直接交接，不觸發補位
create or replace function replace_member(p_assignment uuid, p_new_member uuid, p_wage int default null) returns void
language plpgsql security definer as $$
declare
  a assignments;
  d case_days;
  c cases;
  pm members;
  v_wage int;
  aid uuid;
  existing assignments;
begin
  select * into a from assignments where id = p_assignment for update;
  if a.id is null then raise exception 'not_found'; end if;
  d := require_owner_of_day(a.case_day_id);
  select * into c from cases where id = d.case_id;
  if a.state <> 'confirmed' then raise exception 'not_confirmed'; end if;
  select * into pm from members where id = p_new_member;
  if pm.id is null or pm.status <> 'active' then raise exception 'member_not_active'; end if;
  if pm.id = c.owner_id then raise exception 'cannot_invite_self'; end if;
  if member_busy(pm.id, d.day, d.id) is not null then raise exception 'member_busy:%', pm.name; end if;
  v_wage := coalesce(p_wage, last_wage(c.owner_id, pm.id),
                     (select wage from assignment_wages where assignment_id = a.id));

  update assignments set state = 'replaced', release_reason = 'replaced' where id = a.id;

  select * into existing from assignments where case_day_id = d.id and member_id = pm.id;
  if existing.id is not null then
    if existing.state = 'confirmed' then raise exception 'duplicate_member:%', pm.name; end if;
    update assignments set state = 'confirmed', direct = true, rank = a.rank, responded_at = app_now(),
           overdue = false, cancel_reason = null, release_reason = null
     where id = existing.id returning id into aid;
    insert into assignment_wages (assignment_id, wage) values (aid, v_wage)
    on conflict (assignment_id) do update set wage = excluded.wage;
  else
    insert into assignments (case_day_id, member_id, rank, state, direct, responded_at, created_at)
    values (d.id, pm.id, a.rank, 'confirmed', true, app_now(), app_now()) returning id into aid;
    insert into assignment_wages (assignment_id, wage) values (aid, v_wage);
  end if;

  perform notify(a.member_id, 'replaced_out', day_summary(d.id) || jsonb_build_object('new_member_name', pm.name));
  perform notify(pm.id, 'replaced_in', day_summary(d.id) || jsonb_build_object(
    'assignment_id', aid, 'wage', v_wage, 'old_member_name', member_name(a.member_id)));
  perform close_other_invites(pm.id, d.day, d.id);
  perform audit('replace', jsonb_build_object('assignment_id', a.id, 'new_member', pm.id));
  perform dispatch(d.id);
end $$;

-- 熄滅火柴
create or replace function extinguish(p_case uuid) returns void
language plpgsql security definer as $$
declare
  c cases := require_owner_of_case(p_case);
  r record;
begin
  for r in
    select a.id from assignments a join case_days d on d.id = a.case_day_id
     where d.case_id = c.id and d.status = 'active' and a.state in ('confirmed', 'invited', 'queued')
  loop
    perform release_assignment(r.id, 'extinguished', 'case_cancelled');
  end loop;
  update cases set status = 'extinguished', updated_at = app_now() where id = c.id;
  perform audit('extinguish', jsonb_build_object('case_id', c.id));
end $$;

------------------------------------------------------------
-- 鄰家女孩：團隊以外、火柴自己找來的人
------------------------------------------------------------
create or replace function add_guest(p_case_day uuid, p_name text, p_wage int default null) returns uuid
language plpgsql security definer as $$
declare
  d case_days := require_owner_of_day(p_case_day);
  aid uuid;
  over int;
  r record;
begin
  if nullif(trim(coalesce(p_name, '')), '') is null then raise exception 'guest_name_required'; end if;
  if confirmed_count(d.id) >= d.need then raise exception 'already_full'; end if;
  insert into assignments (case_day_id, guest_name, rank, state, direct, responded_at, created_at)
  values (d.id, trim(p_name),
          (select coalesce(max(rank), 0) + 1 from assignments where case_day_id = d.id),
          'confirmed', true, app_now(), app_now())
  returning id into aid;
  if p_wage is not null then insert into assignment_wages (assignment_id, wage) values (aid, p_wage); end if;
  -- 多出來的邀請先撤回（從順位最後開始）
  over := confirmed_count(d.id)
        + (select count(*)::int from assignments where case_day_id = d.id and state = 'invited' and not overdue)
        - d.need;
  for r in select id from assignments where case_day_id = d.id and state = 'invited' order by rank desc loop
    exit when over <= 0;
    perform release_assignment(r.id, 'need_reduced');
    over := over - 1;
  end loop;
  perform audit('add_guest', jsonb_build_object('case_day_id', d.id, 'name', p_name));
  perform dispatch(d.id);
  return aid;
end $$;

create or replace function remove_guest(p_assignment uuid) returns void
language plpgsql security definer as $$
declare
  a assignments;
  d case_days;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or a.member_id is not null then raise exception 'not_found'; end if;
  d := require_owner_of_day(a.case_day_id);
  update assignments set state = 'released', release_reason = 'guest_removed' where id = a.id;
  perform audit('remove_guest', jsonb_build_object('assignment_id', a.id));
  perform dispatch(d.id);
end $$;

------------------------------------------------------------
-- 排程：每分鐘跑一次
------------------------------------------------------------
create or replace function tick() returns jsonb
language plpgsql security definer as $$
declare
  now_ts timestamptz := app_now();
  local_now timestamp := tw(now_ts);
  r record;
  r2 record;
  n_overdue int := 0;
  n_remind int := 0;
  next_month date;
  flag_key text;
begin
  -- 倒數結束：標記逾時，並照順位多邀下一位
  for r in
    select distinct a.case_day_id from assignments a
     where a.state = 'invited' and not a.overdue and a.deadline <= now_ts
  loop
    update assignments set overdue = true
     where case_day_id = r.case_day_id and state = 'invited' and not overdue and deadline <= now_ts;
    n_overdue := n_overdue + 1;
    perform dispatch(r.case_day_id);
  end loop;

  -- 缺人提醒火柴：出班前 3 天（10:00 起）、出班前一天 18:00
  for r in
    select d.id, d.day, d.need, c.owner_id, d.short3_notified, d.short1_notified
      from case_days d join cases c on c.id = d.case_id
     where d.status = 'active' and c.status = 'active' and not d.started
       and d.day between local_now::date and local_now::date + 3
  loop
    if confirmed_count(r.id) >= r.need then continue; end if;
    if r.day = local_now::date + 1 and local_now::time >= time '18:00' and not r.short1_notified then
      update case_days set short1_notified = true, short3_notified = true where id = r.id;
      perform notify(r.owner_id, 'short_staffed', day_summary(r.id) || jsonb_build_object(
        'missing', r.need - confirmed_count(r.id), 'stage', 'day_before'));
    elsif local_now::time >= time '10:00' and not r.short3_notified then
      update case_days set short3_notified = true where id = r.id;
      perform notify(r.owner_id, 'short_staffed', day_summary(r.id) || jsonb_build_object(
        'missing', r.need - confirmed_count(r.id), 'stage', 'three_days'));
    end if;
  end loop;

  -- 開工：出班當天到了開始時間，還沒回覆的邀請全部關閉
  for r in
    select d.id, d.need from case_days d join cases c on c.id = d.case_id
     where d.status = 'active' and c.status = 'active' and not d.started
       and (d.day < local_now::date or (d.day = local_now::date and local_now::time >= c.start_time))
  loop
    update case_days set started = true, final_short = greatest(0, r.need - confirmed_count(r.id)) where id = r.id;
    for r2 in select id, member_id from assignments where case_day_id = r.id and state in ('invited', 'queued') loop
      update assignments set state = 'withdrawn', release_reason = 'started' where id = r2.id;
    end loop;
    for r2 in select member_id from assignments where case_day_id = r.id and state = 'withdrawn' and release_reason = 'started'
               and invited_at is not null loop
      perform notify(r2.member_id, 'day_started', day_summary(r.id));
    end loop;
  end loop;

  -- 出班前一天 20:00 後提醒
  if local_now::time >= time '20:00' then
    for r in
      select a.id, a.member_id, a.case_day_id from assignments a join case_days d on d.id = a.case_day_id
        join cases c on c.id = d.case_id
       where a.state = 'confirmed' and not a.reminded and d.status = 'active' and c.status = 'active'
         and d.day = local_now::date + 1
    loop
      update assignments set reminded = true where id = r.id;
      perform notify(r.member_id, 'day_before', day_summary(r.case_day_id));
      n_remind := n_remind + 1;
    end loop;
  end if;

  -- 每月 15 號起，提醒還沒填下個月的人（每月一次）
  if extract(day from local_now) >= 15 and local_now::time >= time '10:00' then
    next_month := (date_trunc('month', local_now) + interval '1 month')::date;
    flag_key := 'fill_reminder:' || to_char(next_month, 'YYYY-MM');
    if not exists (select 1 from app_flags where key = flag_key) then
      insert into app_flags (key, value) values (flag_key, now_ts::text);
      for r in
        select m.id from members m
         where m.status = 'active'
           and not exists (select 1 from availability v where v.member_id = m.id
                            and v.day >= next_month and v.day < (next_month + interval '1 month')::date)
      loop
        perform notify(r.id, 'fill_reminder', jsonb_build_object('month', to_char(next_month, 'YYYY-MM')));
      end loop;
    end if;
  end if;

  return jsonb_build_object('overdue_days', n_overdue, 'reminded', n_remind);
end $$;

------------------------------------------------------------
-- 管理者
------------------------------------------------------------
create or replace function admin_add_member(p_name text, p_role text default 'member') returns uuid
language plpgsql security definer as $$
declare
  me members := require_admin();
  mid uuid;
begin
  insert into members (name, role, status) values (trim(p_name), p_role, 'active') returning id into mid;
  perform audit('add_member', jsonb_build_object('member_id', mid, 'name', p_name));
  return mid;
end $$;

create or replace function admin_set_member(p_member uuid, p jsonb) returns void
language plpgsql security definer as $$
declare me members := require_admin();
begin
  update members set
    status = coalesce(p ->> 'status', status),
    role = coalesce(p ->> 'role', role),
    name = coalesce(nullif(trim(p ->> 'name'), ''), name)
  where id = p_member;
  perform audit('set_member', jsonb_build_object('member_id', p_member, 'changes', p));
end $$;
