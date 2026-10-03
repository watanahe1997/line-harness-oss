# 賃貸仲介 LINE 完結 MVP

この文書は、LINE Harness v0.24.1に賃貸仲介の独自機能を組み合わせた構成・設定・運用手順です。

## 見積フォーム・回答の改善仕様（2026-10-03）

- 物件URLを優先し、URLがない場合は物件名と所在地を受け付けます。部屋番号・入居時期は未確認／未定でも依頼できます。ペットや駐車場などの詳細を入力できます。
- フォームは確認画面を経由し、LINEユーザーごとの下書きを端末に7日間保存します。同じ送信キーでの再試行は依頼を増やしません。受付通知に失敗しても、保存済みであることを表示します。
- 月額費用と初期費用を分けます。家賃・共益費は月額に、前家賃・日割り家賃は初期費用に含めます。初期支払額から引くのは仲介手数料の割引のみです。
- キャッシュバックは初期費用の入金確認後、PayPayまたはAmazonギフト券で渡します。初期支払額からは差し引かず、受け取り後の実質負担を別に表示します。
- 空欄は確認中、0円は費用なしです。確認中の初期費用がある場合は合計を確定せず、確認済み費用の小計と未確認項目を表示します。
- 公開前に顧客向けプレビューを確認します。公開済みの金額・注意書き・図面は保存時点の版を保持し、下書きの変更が顧客画面へ漏れないようにします。再提示した旧版も閲覧できます。
- LINE通知は見積依頼ごとに1通へまとめ、同じ版の再試行は同じLINE retry keyを使います。通知未完了は管理画面に表示します。再試行は23時間以内とし、期限を過ぎた場合は送信履歴の確認が必要です。
- 審査申込希望時点の提示内容を記録します。一度申込希望を出した顧客は、新しい物件の依頼やキャンセル後も個別対応を継続します。
- 旧形式で提示済みの見積は金額を再計算せず、旧形式であることを表示します。マイル付与・マイル自動返信は賃貸運用では初期状態OFFです。

更新用DB計画は `scripts/rental/migration-plan.ts`、本番への適用は `scripts/rental/upgrade-database.ts apply` を使います。適用前にD1 Time Travelの復旧地点を `.wrangler/rental-upgrade/` に記録し、既存テーブルへの追加変更だけを適用します。過去の行動へのマイル付与処理を除外した方針とファイルハッシュを専用台帳に記録し、通常のマイグレーション台帳にも導入済みファイルを登録します。APIキーやLINEの認証情報は変更しません。

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
- `/rental/estimates`: 本人に提示済みの全依頼・全物件の概算見積一覧（最新提示順）
- `/rental/requests/:request_id`: 本人限定の見積一覧・図面
- `/rental/estimates/:estimate_id/confirm`: 申込対象確認
- `/rental/estimates/:estimate_id/apply`: 審査申込

管理画面:

- `/rental`: 見積作成、図面添付、LINE送信、申込検索、詳細、CSV、ステータス、メモ、個別LINE、安全設定、匿名化

代表API:

- `POST /api/liff/rental/quote-requests`
- `GET /api/liff/rental/estimates`: LINE本人確認後、送信日時のある本人の見積だけを返す。未送信・削除済みは除外し、申込後・成約後の見積も残す。
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

### 共通の見積リッチメニュー

現在の単一アカウント構成では、管理画面 `/rental` 下部の「公式LINEの見積メニュー」から設定できる。Owner/Adminに操作を表示し、既存の管理認証とCSRFでLINEに登録する。接続済みの環境変数の公式LINEを対象にする。

- 左: 「見積を依頼する」→ `/rental/quote`
- 右: 「概算見積を見る」→ `/rental/estimates`
- 画像: `assets/rental-rich-menu/rental-rich-menu.png`（2500×843）、リンク定義: 同ディレクトリ `rich-menu.json`
- 同じ名前・リンク・寸法のメニューがあれば再利用し、画像登録後に標準メニューへ設定する。旧メニューは削除しない。
- LINEの標準メニューIDをAPIから読み戻して設定完了を確認する。個別メニューは標準より優先されるため、該当する顧客は個別設定も別途確認する。
- 一覧から既存の物件別画面で内訳・図面・審査申込希望を確認できる。物件別画面も未送信の部屋は表示しない。

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
