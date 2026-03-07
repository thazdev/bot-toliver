-- Execução manual: cria apenas a tabela users sem afetar tabelas existentes
CREATE TABLE IF NOT EXISTS users (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  username       VARCHAR(64)  NOT NULL UNIQUE,
  password       VARCHAR(255) NOT NULL,
  display_name   VARCHAR(128) NOT NULL,
  wallet_address VARCHAR(64)  NOT NULL,
  tier           VARCHAR(32)  NOT NULL DEFAULT 'admin',
  created_at     DATETIME     NOT NULL DEFAULT NOW()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
