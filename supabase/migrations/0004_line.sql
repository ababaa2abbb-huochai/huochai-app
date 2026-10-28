-- LINE 串接用的函式（正式版與試玩都會載入，但只有伺服器端能呼叫）

-- LINE 登入：用 LINE 使用者 ID 找到或建立成員。第一位登入的人自動成為管理者。
create or replace function line_upsert_member(p_line_user_id text, p_name text, p_auth_user_id uuid) returns jsonb
language plpgsql security definer as $$
declare m members;
begin
  select * into m from members where line_user_id = p_line_user_id;
  if m.id is not null then
    update members set auth_user_id = p_auth_user_id where id = m.id and auth_user_id is distinct from p_auth_user_id
    returning * into m;
    select * into m from members where line_user_id = p_line_user_id;
  else
    insert into members (line_user_id, auth_user_id, name, role, status)
    values (p_line_user_id, p_auth_user_id, coalesce(nullif(trim(p_name), ''), 'LINE 夥伴'),
            case when exists (select 1 from members) then 'member' else 'admin' end,
            case when exists (select 1 from members) then 'pending' else 'active' end)
    returning * into m;
  end if;
  return jsonb_build_object('id', m.id, 'name', m.name, 'role', m.role, 'status', m.status);
end $$;

-- 管理者把預先建立的成員（試玩或手動新增的）綁到某個 LINE 帳號，或換手機時重新綁定
create or replace function admin_bind_line(p_member uuid, p_line_user_id text) returns void
language plpgsql security definer as $$
declare
  me members := require_admin();
  auth_id uuid;
begin
  -- 先把這個 LINE 帳號自動建立出來的待核准空帳號清掉，登入帳號移到指定的成員身上
  select auth_user_id into auth_id from members where line_user_id = p_line_user_id and id <> p_member;
  delete from members where line_user_id = p_line_user_id and id <> p_member and status = 'pending'
    and not exists (select 1 from assignments where member_id = members.id);
  update members set line_user_id = null, auth_user_id = null where line_user_id = p_line_user_id and id <> p_member;
  update members set line_user_id = p_line_user_id, auth_user_id = coalesce(auth_id, auth_user_id) where id = p_member;
  perform audit('bind_line', jsonb_build_object('member_id', p_member));
end $$;

-- LINE 訊息上的「確認／婉拒」按鈕：用 LINE 使用者身分回覆邀請
create or replace function respond_invite_by_line(p_line_user_id text, p_assignment uuid, p_accept boolean) returns text
language plpgsql security definer as $$
declare mid uuid;
begin
  select id into mid from members where line_user_id = p_line_user_id and status = 'active';
  if mid is null then raise exception 'not_active'; end if;
  perform set_config('app.member_id', mid::text, true);
  return respond_invite(p_assignment, p_accept);
end $$;

-- 取出還沒送出的通知（給送 LINE 的排程用），並附上收件人的 LINE ID
create or replace function take_unsent_notifications(p_limit int default 50) returns jsonb
language plpgsql security definer as $$
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('id', n.id, 'kind', n.kind, 'payload', n.payload,
                                        'line_user_id', m.line_user_id, 'name', m.name) order by n.created_at)
      from (select * from notifications where sent_at is null order by created_at limit p_limit) n
      join members m on m.id = n.member_id), '[]'::jsonb);
end $$;

create or replace function mark_notifications_sent(p_ids uuid[], p_error text default null) returns void
language sql security definer as $$
  update notifications set sent_at = now(), send_error = p_error where id = any(p_ids)
$$;
