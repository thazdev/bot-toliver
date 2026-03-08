# Review Completo: Por que o bot em Dry Run não realiza transações

## Resumo executivo

O bot está configurado corretamente para dry run (`DRY_RUN=true`, `FORCE_VALIDATION_SIMULATION=true`), mas **nenhuma transação (nem simulação) é executada** porque o fluxo é bloqueado em múltiplos pontos:

1. **Gargalo de RPC** — rate limiter saturado (fila > 100)
2. **Filtros muito restritivos** — tokens novos raramente passam sem `FILTER_RELAX_FOR_DRY_RUN`
3. **Estratégias exigentes** — `EntryStrategy` exige holders, volume e rug score altos
4. **Logs ausentes** — não aparecem "pool scan concluído", "Token rejeitado" ou "Token passou no filtro" nos seus logs, indicando que o fluxo pode estar travado no scan de pool ou antes

---

## 1. Fluxo do TOKEN_SCAN (onde tudo começa)

```
PumpFunListener / LogsListener
    → BaseListener.onEvent(TOKEN_DETECTED ou POOL_CREATED)
    → queueManager.addJob(TOKEN_SCAN)
    → Worker TOKEN_SCAN (concurrency: 3)
        → tokenScanner.processToken()     ← getAccountInfo + scanForPool (RPC)
        → "TOKEN_SCAN: token ok, buscando pool"
        → poolScanner.scanForPool()       ← RPC (ou cache)
        → "TOKEN_SCAN: pool scan concluído" ou "pool não encontrado"
        → [se pool encontrado] holderVolumeFetcher.fetchHolderData()
        → tradeFilterPipeline.runPipeline()
        → strategyRegistry.evaluateAll()
        → [se buySignal] ou [FORCE_VALIDATION_SIMULATION] → TRADE_EXECUTE
```

---

## 2. Causas raiz identificadas

### 2.1 Rate limiter saturado

**Evidência:** `Rate limiter queue growing large` nos logs.

- **Config padrão:** 5 req/s, 3 concorrentes
- **Por token:** 2–3 chamadas RPC (getAccountInfo + getPool)
- **3 workers** processando em paralelo → 6+ chamadas simultâneas
- Com muitos tokens, a fila passa de 100 e os jobs demoram muito

**Impacto:** O fluxo pode ficar preso em `poolScanner.scanForPool()` ou em `tokenScanner.processToken()`.

### 2.2 TradeFilterPipeline — filtros rígidos

O pipeline rejeita tokens em várias etapas. Com dados padrão para tokens novos:

| Etapa | Condição | Valor padrão (token novo) | Threshold aggressive |
|-------|----------|---------------------------|----------------------|
| step2 | deferTokenAgeSec | token < 5s | 5s (aggressive) |
| step3 | minLiquiditySol | pool.liquidity | ≥ 1 SOL |
| step3 | mintAuthorityDisabled | !isMutable | true |
| step3 | rugScore | 70 (default) | ≥ 50 |
| step4 | entryScore | ~28* | ≥ 45 |
| step6 | hotWalletBalance | 1 (default) | ≥ 0.1 |

\* **Cálculo do entryScore com defaults:**
- liquidity 1 SOL → liquidityScore ≈ 10
- holderCount 0 → holderScore = 0
- momentumScore = 50 (sem volume)
- safetyScore = 70
- smartMoneyScore = 0  
→ **entryScore ≈ 28** < 45 → **rejeitado**

### 2.3 EntryStrategy — signal stack

Mesmo que o filtro passe, a `EntryStrategy` exige:

| Condição | Aggressive | Problema para tokens novos |
|----------|------------|----------------------------|
| minHolderCount | 3 | Tokens Pump.fun recém-criados costumam ter 0–1 holders |
| minBuyTxLast60s | 1 | volumeContext usa holderCount como heurística; 0 holders = 0 compras |
| rugScore | ≥ 70 | Fixo em 70 no default |
| Liquidity | ≥ 1 SOL | OK se pool tiver 1+ SOL |

**Conclusão:** Tokens muito novos quase nunca passam no signal stack.

### 2.4 FORCE_VALIDATION_SIMULATION — condição restritiva

Quando o token **passa no filtro** mas **não gera sinal de compra**, o bot pode forçar 1 simulação a cada 5 min:

```typescript
// main.ts linhas 514-536
if (forceValidationSimulation && dryRun && pool.liquidity >= 0.5 && ...) {
  await queueManager.addJob(QueueName.TRADE_EXECUTE, 'validation-simulation', {...});
}
```

**Problema:** Para isso acontecer, o token precisa **passar no filtro**. Com entryScore ~28 e threshold 45, quase nenhum token passa.

---

## 3. Variáveis de ambiente que faltam (Railway)

As imagens mostram o ambiente **Railway** (produção). O seu `.env` local já tem `FILTER_RELAX_FOR_DRY_RUN=true`, mas no Railway essa variável **não aparece** nas imagens. Se o bot está rodando no Railway, adicione lá:

Com base nas imagens dos seus envs do Railway, estas variáveis **não** aparecem e são importantes:

| Variável | Valor sugerido | Efeito |
|----------|----------------|--------|
| **FILTER_RELAX_FOR_DRY_RUN** | `true` | Relaxa filtros em dry run: minHolderCount=0, minBuyTxLast60s=0, minEntryScoreThreshold=15 |
| **RPC_REQUESTS_PER_SECOND** | `15` ou `20` | Aumenta throughput de RPC (Helius costuma suportar mais) |
| **RPC_MAX_CONCURRENT** | `5` ou `8` | Mais requisições em paralelo |

---

## 4. Recomendações de correção

### 4.1 Imediato — habilitar relaxamento em dry run

Adicione ao `.env` (ou variáveis do Railway):

```
FILTER_RELAX_FOR_DRY_RUN=true
```

Isso permite que tokens novos passem no filtro e cheguem à validação/simulação.

### 4.2 Reduzir gargalo de RPC

```
RPC_REQUESTS_PER_SECOND=15
RPC_MAX_CONCURRENT=6
```

Ajuste conforme limites da sua conta Helius.

### 4.3 Reduzir carga de jobs (opcional)

- Reduzir `concurrency` do worker TOKEN_SCAN de 3 para 2
- Ou limitar a quantidade de listeners ativos (ex.: desativar um deles temporariamente)

### 4.4 Logs para diagnóstico

Para entender onde o fluxo para, aumente o nível de log:

```
LOG_LEVEL=debug
```

Assim você verá:
- `TOKEN_SCAN: pool scan concluído` ou `pool não encontrado`
- `Token rejeitado pelo filtro` (com step e motivo)
- `Token passou no filtro mas sem sinal de compra`
- `VALIDAÇÃO: forçando simulação de compra`

---

## 5. Checklist de verificação

- [ ] `FILTER_RELAX_FOR_DRY_RUN=true` no env
- [ ] `FORCE_VALIDATION_SIMULATION=true` (já está)
- [ ] `DRY_RUN=true` (já está)
- [ ] `MIN_LIQUIDITY_SOL=1` compatível com tier aggressive
- [ ] `STRATEGY_TIER=aggressive` (já está)
- [ ] RPC rate limit aumentado
- [ ] `LOG_LEVEL=debug` para diagnóstico

---

## 6. Resumo do fluxo esperado após correções

Com `FILTER_RELAX_FOR_DRY_RUN=true`:

1. Tokens novos passam no filtro (threshold 15, minHolder 0, etc.)
2. Estratégias podem não dar buy (normal para tokens muito novos)
3. `FORCE_VALIDATION_SIMULATION` entra em ação: 1 simulação a cada 5 min quando um token passa no filtro e tem liquidez ≥ 0.5 SOL
4. Você deve ver nos logs: `VALIDAÇÃO: forçando simulação de compra (dry run)` e jobs `TRADE_EXECUTE` sendo processados

---

*Review gerado em 08/03/2026*
