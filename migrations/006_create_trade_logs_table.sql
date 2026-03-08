CREATE TABLE IF NOT EXISTS trade_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  token_mint VARCHAR(64) NOT NULL,
  action ENUM('BUY','SELL','SKIP','BLOCKED','EXIT') NOT NULL,
  price_sol DECIMAL(18,12) DEFAULT 0,
  amount_sol DECIMAL(18,9) DEFAULT 0,
  pnl_sol DECIMAL(18,9) DEFAULT NULL,
  pnl_pct DECIMAL(10,4) DEFAULT NULL,
  mode ENUM('dry_run','real') NOT NULL DEFAULT 'dry_run',
  strategy_id VARCHAR(64) DEFAULT '',
  reason TEXT DEFAULT NULL,
  metadata JSON DEFAULT NULL,
  INDEX idx_trade_logs_token (token_mint),
  INDEX idx_trade_logs_action (action),
  INDEX idx_trade_logs_timestamp (timestamp),
  INDEX idx_trade_logs_mode (mode)
);
