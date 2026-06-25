# 賃貸仲介 LINE 完結 MVP

この文書は、LINE Harness `main`（調査時コミット `7dd76ee4df2ab22c27b83a032935adf515d6d366`、package version `0.15.0`）へ追加した賃貸仲介MVPの構成・設定・運用手順です。

## 1. 既存機能の調査結果

流用した機能:

- `apps/worker`: Hono API、LINE Webhook、友だち・LINEアカウント、個別送信、`messages_log`
- `apps/worker/src/services/liff-auth.ts`: LINE Login IDトークンのサーバー検証
- `apps/web`: Next.js管理画面、HttpOnly Cookie、CSRF、Owner/Admin/Staff、共通サイドバー
- `apps/liff`: LIFF初期化、IDトークン、React Router、Cloudflare Pages配信
- `packages/db`: D1、UUID、JST日時、友だち・タグ・スタッフ権限
- R2 `IMAGES` binding: 図面と任意の本人確認書類の保存先
- 既存タグ／リッチメニュー機能: 賃貸ステータスに応じたタグとメニュー切替の設定基盤

専用実装が必要だった理由:

- 汎用フォームは `request_id → estimate_id（部屋単位）→ application_id` の関係を強制できない。
- 見積金額、図面、審査申込、状態遷移、匿名化、PII閲覧ログは業務専用の権限境界が必要。
- 既存 `/images/*` は公開画像向けなので、個人向け図面・本人確認書類には利用できない。

## 2. 実装方針

- 1回の概算見積依頼につき部屋番号を1〜5件受け付け、部屋ごとに推測困難な `estimate_id` を発行する。
- 顧客向けAPIは毎回LINEのIDトークンを検証し、LINE userIdとDB上の所有者を照合する。
- 管理APIは既存Owner/Admin/Staff認証とCSRFを利用する。
- Staffは見積業務のみ。審査申込の個人情報はOwner/Adminだけが閲覧・更新できる。
- 図面と本人確認書類はR2の `rental/...` 配下へ保存し、公開URLを作らない。認証済みAPIがR2オブジェクトをストリーム配信する。
- LINE本文には審査申込の個人情報を載せない。管理画面からの個別通知も個人情報を含まない固定テンプレートだけを送信できる。
- 重要操作は `rental_audit_logs` に残す。申込の閲覧、CSV、ファイル閲覧、更新、LINE送信、匿名化を記録する。
- 本人確認書類アップロードは初期状態OFF。Ownerが安全設定でONにできる。
- 保持期限を超えた個人情報はOwnerが匿名化処理を実行できる。

## 3. DBマイグレーション

主な変更ファイル:

- DB: `packages/db/migrations/046_rental_brokerage.sql`, `packages/db/src/rental.ts`, `packages/db/bootstrap.sql`
- Worker: `apps/worker/src/routes/rental.ts`, `apps/worker/src/services/rental.ts`, `apps/worker/src/index.ts`
- LIFF: `apps/liff/src/pages/Rental*.tsx`, `apps/liff/src/lib/rental-api.ts`, `apps/liff/src/App.tsx`
- 管理画面: `apps/web/src/app/rental/page.tsx`, `apps/web/src/components/layout/sidebar.tsx`, `apps/web/src/lib/api.ts`
- 設定・文書: `.env.example`, `README.md`, `docs/rental-mvp.md`

追加ファイル: `packages/db/migrations/046_rental_brokerage.sql`

追加テーブル:

- `rental_quote_requests`: 依頼単位（`request_id`）
- `rental_estimates`: 部屋単位の見積（`estimate_id`）
- `rental_applications`: 審査申込（`application_id`）
- `rental_audit_logs`: 監査ログ
- `rental_settings`: プライバシーURL、書類アップロードフラグ、保持日数

ローカルD1:

```bash
npx wrangler d1 execute line-harness --local --file=packages/db/migrations/046_rental_brokerage.sql
```

本番D1（名前は実環境に合わせる）:

```bash
npx wrangler d1 execute line-crm --env production --remote --file=packages/db/migrations/046_rental_brokerage.sql
```

新規環境向け `packages/db/bootstrap.sql` と `bootstrap-meta.json` は更新済みです。

## 4. 主要画面とAPI

LIFF:

- `/rental/quote`: 概算見積依頼
- `/rental/requests/:request_id`: 本人限定の見積一覧・図面
- `/rental/estimates/:estimate_id/confirm`: 申込対象確認
- `/rental/estimates/:estimate_id/apply`: 審査申込

管理画面:

- `/rental`: 見積作成、図面添付、LINE送信、申込検索、詳細、CSV、ステータス、メモ、個別LINE、安全設定、匿名化

代表API:

- `POST /api/liff/rental/quote-requests`
- `GET /api/liff/rental/requests/:id/estimates`
- `GET /api/liff/rental/estimates/:id/floor-plan`
- `POST /api/liff/rental/estimates/:id/applications`
- `GET/PATCH /api/rental/requests...` / `/api/rental/estimates...`
- `GET/PATCH/DELETE /api/rental/applications...`
- `GET /api/rental/applications/export.csv`
- `GET /api/rental/audit-logs`
- `POST /api/rental/retention/run`

## 5. LINE通知とタグ

通知:

- 依頼受付: 固定のテキスト通知
- 見積完成: 固定文面のFlex Messageと「見積一覧を確認」ボタン
- 申込受付: 固定のテキスト通知

自動付与される主なタグ:

- `概算見積依頼済み`
- `見積作成待ち` / `見積作成中` / `見積提示済み`
- `審査申込希望` / `審査申込入力済み` / `個別対応中`
- `成約` / `キャンセル`

既存の「リッチメニューグループ」で3種類のメニューを作成・公開し、管理画面 `/rental` の「安全設定」に各グループIDを登録してください。状態タグ更新時に、該当する公開済みグループのデフォルトページへ自動で切り替わります。未設定の段階は現在のメニューを維持します。例:

- 初回: 「概算見積を依頼する」「申込の流れ」「よくある質問」
- 見積提示済み: 「見積を見る」「審査申込へ進む」「よくある質問」
- 申込済み: 「申込状況を確認」「追加案内を確認」「よくある質問」

友だち追加時の既存あいさつ／シナリオには、次のLIFF URLをボタンとして設定します。

```text
https://liff.line.me/<LIFF_ID>/rental/quote
```

## 6. ローカル起動

前提: Node.js 20以上（22 LTS推奨）、Corepack、Cloudflare Wrangler。Windows上のNode.js 24ではCloudflare Vite pluginがネイティブ終了する場合があるため、その場合はNode.js 22 LTSでbuildしてください。

```bash
corepack pnpm install --frozen-lockfile
corepack pnpm --filter @line-crm/shared build
corepack pnpm --filter @line-crm/line-sdk build
corepack pnpm --filter @line-harness/update-engine build
```

Worker:

```bash
corepack pnpm dev:worker
```

管理画面 `apps/web/.env.local`:

```env
NEXT_PUBLIC_API_URL=http://127.0.0.1:8787
```

```bash
corepack pnpm dev:web
```

LIFF `apps/liff/.env.local`:

```env
VITE_API_BASE=http://127.0.0.1:8787
VITE_DEFAULT_LIFF_ID=1234567890-AbCdEfGh
```

```bash
corepack pnpm --filter liff dev
```

LINEアプリ外でLIFF本人確認を完全再現するには実IDトークンが必要です。見た目のローカル確認と、LINE内実機確認を分けて行ってください。

## 7. Cloudflare / LINE設定

Cloudflare:

1. 既存D1へマイグレーションを適用。
2. 既存R2 `IMAGES` bindingが有効であることを確認。
3. Worker、管理Pages、LIFF Pagesをデプロイ。
4. `ADMIN_ORIGIN` とCookie構成を既存手順どおり設定。
5. R2に公開カスタムドメインを付けない。`rental/` 配下を直接公開しない。

LINE Developers:

1. LIFFのEndpoint URLをLIFF PagesのURLへ設定。
2. LIFF scopeに `openid` と `profile` を含める。
3. LIFF URLのパス付きリンクをあいさつ・リッチメニューへ登録。
4. Messaging APIのWebhook URLとアクセストークンを既存LINE Harness設定で確認。
5. 本番前に実際の友だちアカウントで、他人のURLを開いても403/404になることを確認。

環境変数一覧:

- Worker既存必須: `API_KEY`, `LINE_CHANNEL_ACCESS_TOKEN`, `LINE_CHANNEL_SECRET`, `LINE_LOGIN_CHANNEL_ID`, `LINE_LOGIN_CHANNEL_SECRET`, `WORKER_URL`, `LIFF_URL`
- 管理画面: `NEXT_PUBLIC_API_URL`
- LIFF: `VITE_API_BASE`, `VITE_DEFAULT_LIFF_ID`
- 管理認証: `ADMIN_ORIGIN`, 必要時 `ADMIN_ALLOW_CROSS_SITE=true`

プライバシーポリシーURL、本人確認書類ON/OFF、保持日数は環境変数ではなく管理画面の「安全設定」で管理します。

## 8. テスト

```bash
corepack pnpm --filter worker test -- src/services/rental.test.ts
corepack pnpm --filter @line-crm/db test
corepack pnpm --filter worker typecheck
corepack pnpm --filter worker build
corepack pnpm --filter liff build
$env:NEXT_PUBLIC_API_URL='http://127.0.0.1:8787'; corepack pnpm --filter web build
```

## 9. 本番リリース前チェックリスト

- [ ] D1のバックアップを取得し、`046_rental_brokerage.sql`を適用した
- [ ] Worker / Admin / LIFFのURLと環境変数が本番値である
- [ ] R2の `rental/` オブジェクトが公開URLから取得できない
- [ ] Owner/Admin/Staffそれぞれで権限を確認した
- [ ] Staffから審査申込一覧・個人情報へアクセスできない
- [ ] 顧客Aが顧客Bのrequest_id / estimate_id / application_idを閲覧できない
- [ ] 図面は本人と認証済みStaffだけが取得できる
- [ ] 本人確認書類機能は必要になるまでOFFである
- [ ] プライバシーポリシーURLと同意文を法務・運用担当が確認した
- [ ] LINE通知に氏名、住所、電話、メール等が含まれない
- [ ] CSV出力、PII閲覧、ファイル閲覧、更新、送信、匿名化が監査ログへ残る
- [ ] 保持期間と匿名化運用の担当・頻度を決めた
- [ ] 1〜5部屋、重複部屋、対象外、キャンセル、複数見積の申込を実機確認した
- [ ] 見積送信前に支払総額・注意書き・図面をダブルチェックする運用を決めた
- [ ] 管理会社・保証会社等への提出は内容確認後の手動対応であることを確認した
- [ ] BAN検知、自動アカウント切替、トラフィックプール等をこの用途に使っていない
