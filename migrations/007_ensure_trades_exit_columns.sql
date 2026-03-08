-- Safety net: add exit columns to trades table one by one.
-- The MigrationRunner now handles ER_DUP_FIELDNAME gracefully,
-- so these are no-ops if 005 already ran successfully.
ALTER TABLE trades ADD COLUMN exit_price_sol DECIMAL(18,12) NULL;
ALTER TABLE trades ADD COLUMN exit_reason VARCHAR(32) NULL;
ALTER TABLE trades ADD COLUMN pnl_sol DECIMAL(18,9) NULL;
ALTER TABLE trades ADD COLUMN pnl_pct DECIMAL(8,4) NULL;
ALTER TABLE trades ADD COLUMN closed_at DATETIME NULL;
