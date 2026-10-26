# 賣女孩的小火柴

整理師夥伴的排班與找人 App。規則說明見《賣女孩的小火柴 說明書》，上線步驟見 [docs/上線指南.md](docs/上線指南.md)。

## 結構

```
supabase/migrations/   資料庫結構與所有排班規則（Postgres 函式）
  0001_schema.sql      資料表
  0002_logic.sql       規則：點燃、邀請、補位、倒數、急件、直接加入、替換、撞期、改期、熄滅、排程
  0003_read.sql        依身分過濾的讀取函式（時薪、地址、野放的可見範圍在這裡控制）
  0004_line.sql        LINE 登入與按鈕回覆用的伺服器端函式
  0005_supabase_only_security.sql  權限、RLS、即時同步、pg_cron（只在 Supabase 執行）
supabase/functions/    Edge Functions：line-login、line-notify、line-webhook
src/                   前端（Preact）
  api/demo.js          試玩模式：瀏覽器裡跑 PGlite，載入同一份 SQL
  api/supabase.js      正式版：Supabase + LIFF
test/rules.test.js     規則測試（PGlite）
test/e2e/              瀏覽器流程測試（Playwright）
```

## 指令

```bash
npm install
npm test                  # 規則測試
npm run build:demo        # 試玩版 → dist-demo/
node test/e2e/walk.js     # 瀏覽器流程（需先 build:demo）
node test/e2e/walk2.js
npm run build             # 正式版單一 index.html → dist/（需要 .env）
```

正式版 `.env`：

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_LIFF_ID=
```

Edge Function 的環境變數：`LINE_LOGIN_CHANNEL_ID`、`LINE_CHANNEL_SECRET`、`LINE_CHANNEL_ACCESS_TOKEN`、`LIFF_ID`、`APP_JWT_SECRET`（= Supabase JWT Secret）、`CRON_SECRET`、`LINE_PUSH_KINDS`（預設 `invite,time_change,short_staffed`）。

## 新增函式時

0005 會先撤銷所有函式的執行權限，再逐一開放。之後新增給前端呼叫的函式，記得加進 0005 的 grant 清單。
