CREATE TABLE IF NOT EXISTS stats (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  total_trades INT NOT NULL DEFAULT 0,
  win_count INT NOT NULL DEFAULT 0,
  loss_count INT NOT NULL DEFAULT 0,
  total_pnl_sol DECIMAL(18,9) NOT NULL DEFAULT 0,
  win_rate DECIMAL(6,4) NOT NULL DEFAULT 0,
  tokens_scanned INT NOT NULL DEFAULT 0,
  trades_blocked INT NOT NULL DEFAULT 0,
  uptime_seconds BIGINT NOT NULL DEFAULT 0,
  snapshot_at DATETIME DEFAULT NOW(),
  INDEX idx_stats_snapshot (snapshot_at)
);
