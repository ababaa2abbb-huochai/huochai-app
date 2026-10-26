-- 賣女孩的小火柴：資料表
-- 所有寫入都透過 0002_logic.sql 的函式進行；讀取透過 0003_read.sql 的函式。
-- 時區一律以台北時間判斷日期與時段。

create table members (
  id            uuid primary key default gen_random_uuid(),
  line_user_id  text unique,
  name          text not null,
  role          text not null default 'member' check (role in ('member', 'admin')),
  status        text not null default 'pending' check (status in ('pending', 'active', 'paused')),
  created_at    timestamptz not null default now()
);

-- 每月填班：沒有資料列＝沒空
create table availability (
  member_id  uuid not null references members(id) on delete cascade,
  day        date not null,
  state      text not null check (state in ('free', 'wild')),
  primary key (member_id, day)
);

create table cases (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references members(id),
  area        text not null check (length(trim(area)) > 0),
  job_type    text not null check (job_type in ('打包', '上架', '整理', '打包＋上架')),
  start_time  time not null default '09:00',
  end_time    time not null default '16:00',
  status      text not null default 'active' check (status in ('active', 'extinguished')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

-- 詳細地址分開存放，只有火柴與已確認的女孩讀得到
create table case_addresses (
  case_id  uuid primary key references cases(id) on delete cascade,
  address  text not null
);

create table case_days (
  id                 uuid primary key default gen_random_uuid(),
  case_id            uuid not null references cases(id) on delete cascade,
  day                date not null,
  need               int not null check (need >= 1),   -- 總人數；我也出班時包含火柴
  self_on            boolean not null default true,    -- 我也出班
  urgent             boolean not null default false,   -- 急件：同時邀請全部候補
  status             text not null default 'active' check (status in ('active', 'removed')),
  exhausted_notified boolean not null default false,
  full_notified      boolean not null default false,
  unique (case_id, day)
);

-- 每位被排進順位的女孩一列
--   queued    候補（還沒邀）
--   invited   邀請中（overdue=true 代表倒數已過，仍可確認）
--   confirmed 已確認
--   declined  婉拒
--   full      已額滿（邀請關閉）
--   taken     她確認了別的案子，這張邀請關閉
--   withdrawn 火柴撤回邀請
--   skipped   輪到她時她已有班，跳過
--   cancelled 女孩取消
--   released  火柴釋出（減人、改期、少一天、時間變更沒辦法、熄滅）
--   replaced  被代班替換
create table assignments (
  id                  uuid primary key default gen_random_uuid(),
  case_day_id         uuid not null references case_days(id) on delete cascade,
  member_id           uuid not null references members(id),
  rank                int not null,
  state               text not null check (state in ('queued', 'invited', 'confirmed', 'declined', 'full', 'taken',
                                                     'withdrawn', 'skipped', 'cancelled', 'released', 'replaced')),
  direct              boolean not null default false,
  invited_at          timestamptz,
  deadline            timestamptz,
  overdue             boolean not null default false,
  responded_at        timestamptz,
  cancel_reason       text check (cancel_reason in ('more_important', 'unwell')),
  release_reason      text,
  time_change_pending boolean not null default false,
  reminded            boolean not null default false,
  created_at          timestamptz not null default now(),
  unique (case_day_id, member_id)
);
create index assignments_member_idx on assignments (member_id, state);
create index assignments_day_idx on assignments (case_day_id, state, rank);

-- 時薪分開存放，只有火柴、該女孩、管理者讀得到
create table assignment_wages (
  assignment_id uuid primary key references assignments(id) on delete cascade,
  wage          int not null check (wage > 0)
);

-- 通知匣：App 內鈴鐺顯示；LINE / 網頁推播由 Edge Function 取出送出
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references members(id) on delete cascade,
  kind        text not null,
  payload     jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  read_at     timestamptz,
  sent_at     timestamptz,
  send_error  text
);
create index notifications_member_idx on notifications (member_id, created_at desc);
create index notifications_unsent_idx on notifications (sent_at) where sent_at is null;

-- 修改紀錄（管理者看）
create table audit_log (
  id         bigint generated always as identity primary key,
  actor_id   uuid references members(id),
  action     text not null,
  detail     jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- 系統狀態（月填班提醒是否發過等）
create table app_flags (
  key   text primary key,
  value text not null
);
