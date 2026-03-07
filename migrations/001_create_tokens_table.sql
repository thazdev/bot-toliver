CREATE TABLE IF NOT EXISTS tokens (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  mint_address VARCHAR(64) NOT NULL UNIQUE,
  symbol VARCHAR(32) NOT NULL DEFAULT '',
  name VARCHAR(128) NOT NULL DEFAULT '',
  decimals INT NOT NULL DEFAULT 0,
  supply DECIMAL(36,0) NOT NULL DEFAULT 0,
  source VARCHAR(20) NOT NULL DEFAULT 'unknown',
  initial_liquidity_sol DECIMAL(18,9) NOT NULL DEFAULT 0,
  initial_price_sol DECIMAL(18,12) NOT NULL DEFAULT 0,
  is_mutable BOOLEAN NOT NULL DEFAULT FALSE,
  has_freeze_authority BOOLEAN NOT NULL DEFAULT FALSE,
  metadata_uri TEXT,
  created_at DATETIME,
  discovered_at DATETIME DEFAULT NOW(),
  INDEX idx_tokens_source (source),
  INDEX idx_tokens_discovered (discovered_at)
);
