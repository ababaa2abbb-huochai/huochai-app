-- 賣女孩的小火柴：讀取函式（依身分過濾，前端只透過這些函式讀資料）

create or replace function get_me() returns jsonb
language plpgsql security definer stable as $$
declare m members;
begin
  select * into m from members where id = app_member_id();
  if m.id is null then return null; end if;
  return jsonb_build_object(
    'id', m.id, 'name', m.name, 'role', m.role, 'status', m.status,
    'unread', (select count(*) from notifications where member_id = m.id and read_at is null),
    'today', tw_today(), 'now', app_now());
end $$;

create or replace function get_members() returns jsonb
language plpgsql security definer stable as $$
declare me members := require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'role', role, 'status', status) order by created_at, name)
      from members
     where status = 'active' or me.role = 'admin'), '[]'::jsonb);
end $$;

-- 月曆：每天「還能約」人數與名單。野放只有本人看得到（月曆上別人看到的是沒空）
create or replace function get_month(p_month date) returns jsonb
language plpgsql security definer stable as $$
declare
  me members := require_member();
  first_day date := date_trunc('month', p_month)::date;
  last_day date := (date_trunc('month', p_month) + interval '1 month - 1 day')::date;
begin
  return jsonb_build_object(
    'month', first_day,
    'days', coalesce((
      select jsonb_agg(jsonb_build_object('day', g.day, 'free', g.free, 'people', g.people) order by g.day)
        from (
          select dd::date as day,
                 (select count(*)::int from availability v join members m on m.id = v.member_id
                   where v.day = dd::date and v.state = 'free' and m.status = 'active'
                     and member_busy(v.member_id, dd::date) is null) as free,
                 coalesce((
                   select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'status', p.status, 'with', p.owner_name)
                                    order by p.sort, p.name)
                     from (
                       select m.id, m.name,
                              case when member_busy(m.id, dd::date) = m.name then 'owner'
                                   when member_busy(m.id, dd::date) is not null then 'confirmed'
                                   when exists (select 1 from assignments a join case_days d on d.id = a.case_day_id
                                                  join cases c on c.id = d.case_id
                                                 where a.member_id = m.id and a.state = 'invited' and d.day = dd::date
                                                   and d.status = 'active' and c.status = 'active') then 'invited'
                                   else 'free' end as status,
                              member_busy(m.id, dd::date) as owner_name,
                              case when member_busy(m.id, dd::date) is not null then 0
                                   when exists (select 1 from assignments a join case_days d on d.id = a.case_day_id
                                                 where a.member_id = m.id and a.state = 'invited' and d.day = dd::date
                                                   and d.status = 'active') then 1
                                   else 2 end as sort
                         from members m
                        where m.status = 'active'
                          and (exists (select 1 from availability v where v.member_id = m.id and v.day = dd::date and v.state = 'free')
                               or member_busy(m.id, dd::date) is not null
                               or exists (select 1 from assignments a join case_days d on d.id = a.case_day_id
                                           join cases c on c.id = d.case_id
                                          where a.member_id = m.id and a.state = 'invited' and d.day = dd::date
                                            and d.status = 'active' and c.status = 'active'))
                     ) p), '[]'::jsonb) as people
            from generate_series(first_day, last_day, interval '1 day') dd
        ) g), '[]'::jsonb),
    'mine', coalesce((
      select jsonb_object_agg(v.day, v.state) from availability v
       where v.member_id = me.id and v.day between first_day and last_day), '{}'::jsonb));
end $$;

-- 點燃或加人時的名單：所有成員、填班狀態（含野放）、是否已有班、上次時薪
create or replace function get_candidates(p_day date, p_case_day uuid default null) returns jsonb
language plpgsql security definer stable as $$
declare me members := require_member();
begin
  return coalesce((
    select jsonb_agg(x order by x ->> 'sort', x ->> 'name')
      from (
        select jsonb_build_object(
                 'id', m.id, 'name', m.name,
                 'availability', coalesce(v.state, 'none'),
                 'busy_with', member_busy(m.id, p_day, p_case_day),
                 'last_wage', last_wage(me.id, m.id),
                 'in_case', (select a.state from assignments a where a.case_day_id = p_case_day and a.member_id = m.id),
                 'sort', case when member_busy(m.id, p_day, p_case_day) is not null then '3'
                              when v.state = 'free' then '1' else '2' end) as x
          from members m
          left join availability v on v.member_id = m.id and v.day = p_day
         where m.status = 'active' and m.id <> me.id
      ) s), '[]'::jsonb);
end $$;

create or replace function assignment_json(a assignments, p_day date) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'id', a.id, 'member_id', a.member_id, 'name', coalesce(m.name, a.guest_name), 'guest', a.member_id is null,
    'rank', a.rank, 'state', a.state,
    'direct', a.direct, 'invited_at', a.invited_at, 'deadline', a.deadline, 'overdue', a.overdue,
    'responded_at', a.responded_at, 'cancel_reason', a.cancel_reason, 'release_reason', a.release_reason,
    'time_change_pending', a.time_change_pending,
    'wage', (select wage from assignment_wages where assignment_id = a.id),
    'availability', coalesce((select state from availability where member_id = a.member_id and day = p_day), 'none'),
    'paused_now', a.member_id is not null and busy_today(a.member_id, app_now()))
    from (select 1) one left join members m on m.id = a.member_id
$$;

-- 我的火柴：我點燃的案件
create or replace function get_my_cases() returns jsonb
language plpgsql security definer stable as $$
declare me members := require_member();
begin
  return coalesce((
    select jsonb_agg(case_json order by first_day nulls last, created_at desc)
      from (
        select c.created_at,
               (select min(day) from case_days where case_id = c.id and status = 'active') as first_day,
               jsonb_build_object(
                 'id', c.id, 'owner_id', c.owner_id, 'owner_name', o.name, 'area', c.area,
                 'address', (select address from case_addresses where case_id = c.id),
                 'job_type', c.job_type,
                 'start_time', to_char(c.start_time, 'HH24:MI'), 'end_time', to_char(c.end_time, 'HH24:MI'),
                 'status', c.status,
                 'days', coalesce((
                   select jsonb_agg(jsonb_build_object(
                            'id', d.id, 'day', d.day, 'need', d.need, 'self_on', d.self_on, 'urgent', d.urgent,
                            'confirmed', confirmed_count(d.id),
                            'started', d.started, 'final_short', d.final_short,
                            'days_left', d.day - tw_today(),
                            'assignments', coalesce((
                              select jsonb_agg(assignment_json(a, d.day) order by a.rank)
                                from assignments a where a.case_day_id = d.id), '[]'::jsonb))
                          order by d.day)
                     from case_days d where d.case_id = c.id and d.status = 'active'), '[]'::jsonb)
               ) as case_json
          from cases c join members o on o.id = c.owner_id
         where c.owner_id = me.id
           and (c.status = 'active' or c.updated_at > app_now() - interval '14 days')
           and (c.status = 'extinguished'
                or exists (select 1 from case_days d where d.case_id = c.id and d.status = 'active' and d.day >= tw_today() - 7))
      ) s), '[]'::jsonb);
end $$;

-- 我的班：邀請與已確認（詳細地址只有已確認才看得到），以及自己當火柴且出班的日子
create or replace function get_my_shifts() returns jsonb
language plpgsql security definer stable as $$
declare me members := require_member();
begin
  return jsonb_build_object(
    'invites', coalesce((
      select jsonb_agg(day_summary(d.id) || jsonb_build_object(
               'assignment_id', a.id, 'state', a.state, 'deadline', a.deadline, 'overdue', a.overdue,
               'wage', (select wage from assignment_wages where assignment_id = a.id),
               'need', d.need, 'confirmed', confirmed_count(d.id))
             order by d.day)
        from assignments a join case_days d on d.id = a.case_day_id join cases c on c.id = d.case_id
       where a.member_id = me.id and a.state = 'invited' and d.status = 'active' and c.status = 'active'), '[]'::jsonb),
    'shifts', coalesce((
      select jsonb_agg(x order by x ->> 'day')
        from (
          select day_summary(d.id) || jsonb_build_object(
                   'assignment_id', a.id, 'role', 'girl',
                   'wage', (select wage from assignment_wages where assignment_id = a.id),
                   'address', (select address from case_addresses where case_id = c.id),
                   'time_change_pending', a.time_change_pending,
                   'teammates', (select jsonb_agg(coalesce(m2.name, a2.guest_name) order by a2.rank) from assignments a2 left join members m2 on m2.id = a2.member_id
                                  where a2.case_day_id = d.id and a2.state = 'confirmed' and a2.member_id is distinct from me.id)) as x
            from assignments a join case_days d on d.id = a.case_day_id join cases c on c.id = d.case_id
           where a.member_id = me.id and a.state = 'confirmed' and d.status = 'active' and c.status = 'active'
             and d.day >= tw_today()
          union all
          select day_summary(d.id) || jsonb_build_object(
                   'role', 'owner',
                   'address', (select address from case_addresses where case_id = c.id),
                   'teammates', (select jsonb_agg(coalesce(m2.name, a2.guest_name) order by a2.rank) from assignments a2 left join members m2 on m2.id = a2.member_id
                                  where a2.case_day_id = d.id and a2.state = 'confirmed'))
            from case_days d join cases c on c.id = d.case_id
           where c.owner_id = me.id and d.self_on and d.status = 'active' and c.status = 'active'
             and d.day >= tw_today()
        ) s), '[]'::jsonb));
end $$;

create or replace function get_notifications(p_limit int default 50) returns jsonb
language plpgsql security definer stable as $$
declare me members := require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', id, 'kind', kind, 'payload', payload,
                                        'created_at', created_at, 'read', read_at is not null)
                     order by created_at desc)
      from (select * from notifications where member_id = me.id order by created_at desc limit p_limit) n), '[]'::jsonb);
end $$;

-- 點燃前檢查撞期：我這天是否已答應別人的班
create or replace function get_conflict(p_day date) returns jsonb
language plpgsql security definer stable as $$
declare me members := require_member();
begin
  return (
    select day_summary(d.id) || jsonb_build_object('assignment_id', a.id, 'kind', 'girl')
      from assignments a join case_days d on d.id = a.case_day_id join cases c on c.id = d.case_id
     where a.member_id = me.id and a.state = 'confirmed' and d.day = p_day
       and d.status = 'active' and c.status = 'active'
     limit 1)
  ;
end $$;

-- 跟客戶改日期時的建議：前後 10 天內，我沒班、而且還能約到足夠人數的日子
create or replace function suggest_days(p_day date, p_people int) returns jsonb
language plpgsql security definer stable as $$
declare me members := require_member();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('day', day, 'free', free) order by abs(day - p_day), day)
      from (
        select dd::date as day,
               (select count(*)::int from availability v join members m on m.id = v.member_id
                 where v.day = dd::date and v.state = 'free' and m.status = 'active' and m.id <> me.id
                   and member_busy(v.member_id, dd::date) is null) as free
          from generate_series(greatest(p_day - 10, tw_today()), p_day + 10, interval '1 day') dd
         where dd::date <> p_day and member_busy(me.id, dd::date) is null
      ) s
     where free >= p_people), '[]'::jsonb);
end $$;

create or replace function get_audit(p_limit int default 100) returns jsonb
language plpgsql security definer stable as $$
declare me members := require_admin();
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('action', l.action, 'detail', l.detail, 'at', l.created_at,
                                        'actor', (select name from members where id = l.actor_id))
                     order by l.created_at desc)
      from (select * from audit_log order by created_at desc limit p_limit) l), '[]'::jsonb);
end $$;
