# D1 migration tools

## 生成対象
- 実データ JSON: `scripts/migration-data.json`（`.gitignore` 対象）
- サンプル JSON: `scripts/migration-data.sample.json`
- 生成 SQL: `scripts/generated/migration-<env>.sql`

## GAS エクスポート
- Apps Script で `exportMigrationData()` を実行すると JSON 文字列がログ出力される。
- 出力先は `scripts/migration-data.json` 想定。

## ローカル投入
```bash
cd /Users/ryuiyamada/Desktop/ryui-workspace/projects/happinets/family-tickets
wrangler d1 execute family-tickets-db --local --file=cloudflare-worker-api/migrations/0001_init.sql
node scripts/migrate-to-d1.js --input scripts/migration-data.sample.json --env local --execute
cd cloudflare-worker-api && wrangler d1 execute family-tickets-db --local --file=../scripts/verify-migration.sql
```

## 本番手順
1. `wrangler login`
2. `cd cloudflare-worker-api && wrangler d1 create family-tickets-db`
3. `wrangler d1 execute family-tickets-db --file=migrations/0001_init.sql`
4. GAS で `exportMigrationData()` を実行し、出力 JSON を `scripts/migration-data.json` として保存
5. `node scripts/migrate-to-d1.js --input scripts/migration-data.json --env production`
6. 出力された `wrangler d1 execute ... --remote --file=...` を実行
7. `cd cloudflare-worker-api && wrangler d1 execute family-tickets-db --remote --file=../scripts/verify-migration.sql`

## admins.pw_hash
- `migration-data.json` に `pw_hash` は含めない。
- 先に移行 SQL で `admins(role, api_token)` だけ投入し、`pw_hash=''` の行を作る。
- その後、平文 password から PBKDF2(SHA-256, iterations=100000, salt=`ADMIN_SALT`) で生成した hex ハッシュを直接更新する。

```sql
UPDATE admins SET pw_hash = '<pbkdf2-hex>' WHERE role = 'ticket';
UPDATE admins SET pw_hash = '<pbkdf2-hex>' WHERE role = 'manager';
```
