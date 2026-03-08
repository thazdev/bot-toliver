-- Colunas para rastrear fechamento de posições dry run
ALTER TABLE trades
  ADD COLUMN exit_price_sol DECIMAL(18,12) NULL,
  ADD COLUMN exit_reason VARCHAR(32) NULL,
  ADD COLUMN pnl_sol DECIMAL(18,9) NULL,
  ADD COLUMN pnl_pct DECIMAL(8,4) NULL,
  ADD COLUMN closed_at DATETIME NULL;
