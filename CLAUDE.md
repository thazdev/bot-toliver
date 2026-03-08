# Solana Trading Bot — Contexto do Projeto

## Arquitetura
- Monolito Node.js/TypeScript rodando no Railway (processo único)
- Frontend: Next.js (dashboard) — serviço separado
- Comunicação: Bot grava em MySQL + Redis → Dashboard lê de MySQL + Redis
- Integrações externas: Helius (RPC + WebSocket), Jupiter (swaps), Telegram (notificações)

## Variáveis de Ambiente (Railway) — após cleanup

### Core (obrigatórias — crash no startup se faltarem)
- HELIUS_RPC_URL, HELIUS_WS_URL, FALLBACK_RPC_URL
- WALLET_PRIVATE_KEY

### Database
- MYSQL_HOST, MYSQL_PORT, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DATABASE
  (ou MYSQL_PUBLIC_URL / DATABASE_URL como connection string)

### Redis
- REDIS_HOST, REDIS_PORT, REDIS_PASSWORD

### Telegram (opcionais)
- TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID

### Trading Config (otimizado para 0.9 SOL de capital)
- TOTAL_CAPITAL_SOL (default: 0.9)
- MAX_POSITION_SIZE_SOL (default: 0.03) — 3.3% do capital por trade
- MAX_OPEN_POSITIONS (default: 3) — máximo 10% do capital alocado
- DEFAULT_SLIPPAGE_BPS (default: 300) — 3% para memecoins
- STOP_LOSS_PERCENT (default: 15) — max perda/trade: ~0.0045 SOL
- TAKE_PROFIT_PERCENT (default: 50) — gain/trade: ~0.015 SOL (R:R 1:3.3)
- MAX_DAILY_LOSS_SOL (default: 0.045) — 5% do capital, para bot após ~10 stops
- STRATEGY_TIER (conservative | balanced | aggressive, default: conservative)

### Filtros de Sinal
- MIN_LIQUIDITY_SOL — gate no listener (LogsListener): decide se o token ENTRA no pipeline.
  Default: 2 SOL. Filtra tokens com pool muito rasa antes de qualquer processamento.
- MIN_LIQUIDITY_FOR_SIGNAL — gate na estratégia (EntryStrategy): decide se gera SINAL DE COMPRA.
  Default: 1 SOL. Tokens com liquidez abaixo deste valor passam no pipeline mas não geram compra.
  **São variáveis diferentes**: uma filtra na entrada, outra filtra na decisão de trade.

### Bot
- LOG_LEVEL (default: warn)

### Variáveis REMOVIDAS (não existem mais no código)
- ~~DRY_RUN~~ → controlado via Redis (bot:mode = "dry-run" | "real")
- ~~BOT_DRY_RUN~~ → idem
- ~~FILTER_RELAX_FOR_DRY_RUN~~ → removido (dry-run usa mesmos filtros)
- ~~FORCE_BUY_SIGNAL~~ → removido (era debug)
- ~~FORCE_VALIDATION_SIMULATION~~ → removido
- ~~VALIDATION_SIMULATION~~ → removido
- ~~SKIP_STAGE1_FOR_DEBUG~~ → removido
- ~~SKIP_WASH_TRADING_CHECK~~ → removido
- ~~POLLING_FALLBACK_ENABLED~~ → internalizado (ativa automaticamente quando WebSocket cai)

## Modo Dry-Run vs Real
- Controlado via Redis: chave `bot:mode` com valor "dry-run" ou "real"
- Dashboard envia toggle → Redis publica → bot lê em tempo real
- Dry-run usa os MESMOS filtros, validação e sizing que modo real
- ÚNICA diferença: no momento do swap, dry-run simula a transação
- Posições simuladas (is_simulated=true) são separadas de posições reais no MySQL
- Ao alternar dry-run→real: posições simuladas são arquivadas, começa limpo
- Ao alternar real→dry-run: posições reais ficam visíveis mas novas operações são simuladas

## Convenções
- TypeScript strict mode
- Config validada com zod — crash no startup se variável obrigatória faltar
- Sem console.log em produção — usar logger estruturado
- Toda mudança deve manter compatibilidade com dados existentes no MySQL/Redis
- Commits atômicos: uma feature por commit
