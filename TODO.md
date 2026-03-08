# TODO — Código Morto e Variáveis Não Utilizadas

## Variáveis de ambiente para remover
- `FILTER_RELAX_FOR_DRY_RUN` — dry-run deve usar mesmos filtros que modo real
- `FORCE_BUY_SIGNAL` — era debug, cria sinal falso de compra
- `FORCE_VALIDATION_SIMULATION` / `VALIDATION_SIMULATION` — modo debug temporário
- `SKIP_STAGE1_FOR_DEBUG` — bypass de filtro de segurança
- `SKIP_WASH_TRADING_CHECK` — bypass de detecção de wash trading
- `POLLING_FALLBACK_ENABLED` — internalizar como lógica de resiliência automática

## Código morto / redundante
- `src/config/DryRunResolver.ts` — avalia `BOT_DRY_RUN` + `DRY_RUN` + Redis. Consolidar em um único flag
- `src/config/ConnectionsPausedResolver.ts` — redundante com `BotLifecycle.isStopped()`
- `src/config/BotEnabledResolver.ts` — função `isBotEnabledNoCache` ficou sem uso direto após BotLifecycle
- `src/strategies/config.ts#shouldRelaxFiltersForDryRun()` — relaxar filtros não é desejável
- `FORCE_BUY_SIGNAL` check em `main.ts` (linhas ~558-567) — debug que ficou em prod
- `testWebSocket()` em `main.ts` — bloqueia 30s no boot, considerar tornar async não-bloqueante
- Massive block de defaults em `main.ts` (linhas ~375-503) — criar factory `createDefaultContext()`

## Dashboard — redundâncias
- 4 abas (Diagnostics, Analytics, Histórico, Overview) fazem a mesma coisa
- Consolidar em 2: Overview (P&L + posições) e History (trades passados)

## Otimizações futuras
- Helius Enhanced Webhooks em vez de WebSocket (mais confiável, menos manutenção)
- Batch RPC calls: Helius suporta JSON-RPC batch (enviar N requests em 1 HTTP call)
- Redis streams em vez de pub/sub para garantia de entrega
- Worker pool para TOKEN_SCAN com backpressure inteligente
