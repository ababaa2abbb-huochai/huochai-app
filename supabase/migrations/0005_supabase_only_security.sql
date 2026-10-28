-- 只在 Supabase 上執行（試玩模式不載入）：權限、即時同步、排程
-- 原則：前端只能呼叫下面列出的函式；資料表本身只開放「讀取不含祕密的欄位」給即時同步用。

-- 1. 預設不准呼叫任何函式
revoke execute on all functions in schema public from public, anon, authenticated;

-- 2. 前端可以呼叫的函式
grant execute on function
  get_me(), get_members(), get_month(date), get_candidates(date, uuid), get_my_cases(), get_my_shifts(),
  get_notifications(int), get_conflict(date), suggest_days(date, int), get_audit(int),
  ignite(jsonb), respond_invite(uuid, boolean), cancel_shift(uuid, text), respond_time_change(uuid, boolean),
  set_availability(jsonb), mark_notifications_read(), update_case(uuid, jsonb), set_day_options(uuid, jsonb),
  add_people(uuid, jsonb), make_direct(uuid), reorder(uuid, jsonb), move_day(uuid, date), add_day(uuid, jsonb, jsonb),
  remove_day(uuid), replace_member(uuid, uuid, int), extinguish(uuid), add_guest(uuid, text, int), remove_guest(uuid),
  admin_add_member(text, text), admin_set_member(uuid, jsonb), admin_bind_line(uuid, text)
to authenticated;

-- 3. 只有伺服器（Edge Function 用 service_role）能呼叫
grant execute on function
  line_upsert_member(text, text, uuid), respond_invite_by_line(text, uuid, boolean),
  take_unsent_notifications(int), mark_notifications_sent(uuid[], text), tick()
to service_role;

-- 4. 資料表：全部開 RLS，前端不能直接寫
alter table members enable row level security;
alter table availability enable row level security;
alter table cases enable row level security;
alter table case_addresses enable row level security;
alter table case_days enable row level security;
alter table assignments enable row level security;
alter table assignment_wages enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;
alter table app_flags enable row level security;

-- 即時同步需要能「讀」到變動的資料列；時薪與詳細地址在另外的表，不開放
create or replace function is_active_member() returns boolean
language sql stable security definer as $$
  select exists (select 1 from members where id = app_member_id() and status = 'active')
$$;
grant execute on function is_active_member() to authenticated;

grant select on assignments, case_days, availability, notifications to authenticated;
create policy read_assignments on assignments for select to authenticated using (is_active_member());
create policy read_case_days on case_days for select to authenticated using (is_active_member());
create policy read_availability on availability for select to authenticated using (is_active_member());
create policy read_own_notifications on notifications for select to authenticated using (member_id = app_member_id());

-- 5. 即時同步
alter publication supabase_realtime add table assignments, case_days, availability, notifications;

-- 6. 排程：每分鐘跑規則（倒數、提醒）
--    送 LINE 的排程在上線指南裡設定（需要填入你的專案網址和金鑰）
create extension if not exists pg_cron;
select cron.schedule('huochai-tick', '* * * * *', $$select public.tick()$$);
