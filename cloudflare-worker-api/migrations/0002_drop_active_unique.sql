-- migration 0002: 申込統合廃止に伴い unique index を削除
-- 同一 player×game×category への複数申込を許可するため
DROP INDEX IF EXISTS uq_applications_active;
