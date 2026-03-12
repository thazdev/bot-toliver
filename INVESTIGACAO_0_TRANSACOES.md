# Investigação: 0 Transações em 26 Horas

**Data:** 2026-03-11  
**Período:** ~26h de bot em DRY_RUN  
**Resultado:** 0 transações simuladas

---

## Resumo Executivo

O pipeline está **excessivamente restritivo** em três camadas:

1. **Signal Stack** — 136/138 tokens falham (98,5%)
2. **Estratégias de entrada** — os 2 que passam não geram buy signal
3. **Filtros em cascata** — volume collapsing, EMAS e entry score bloqueiam os poucos candidatos

---

## 1. Signal Stack — Gargalo Principal

| Fail Reason | Contagem | Interpretação |
|-------------|:--------:|---------------|
| `liquidity_below_threshold` | **124** | Maioria dos pools tem 3–4 SOL; tier conservative exige ≥5 SOL |
| `top_holder_too_high` | 78 | Concentração típica de memecoins (top holder >30–40%) |
| `top5_holder_too_high` | 62 | Top 5 holders concentram >60–70% |
| `pool_age_too_low` | 3 | Poucos casos |

**Configuração atual (tier padrão = conservative):**

| Condição | Conservative | Balanced | Aggressive |
|----------|:------------:|:--------:|:----------:|
| Min liquidez | 5 SOL | 4 SOL | 3 SOL |
| Max top holder | 30% | 35% | 40% |
| Max top 5 holders | 60% | 65% | 70% |

O **listener** usa `MIN_LIQUIDITY_SOL=3` como gate. Tokens com 3–5 SOL passam o listener, mas falham no Signal Stack se o tier for conservative (5 SOL) ou balanced (4 SOL).

---

## 2. Tokens que Passaram — Por Que Não Compraram?

Os 2 tokens que passaram o pipeline (mesmo mint `8WFvPqUypLMmocUZy52n1RdCeNGvdiiNVP75qBZepump`):

- **Liquidez:** 68 SOL  
- **Holders:** 102  
- **Entry score (TradeFilterPipeline):** 63,82  
- **hasBuySignal:** false  
- **tradeBlockReason:** `no_buy_signal`

**Skip reasons das estratégias:**

| Estratégia | Motivo |
|------------|--------|
| EntryStrategy | `Entry score 42.5 below threshold 45` |
| MomentumStrategy | `Volume collapsing: vol_trend 0.20 < 0.5` |
| LaunchStrategy | `Phase 1 (Ignition Sniper) DISABLED` |
| EarlyMomentumStrategy | `EMAS 56 < 60` |

### Por que EntryStrategy retorna 42,5 e TradeFilterPipeline 63,82?

- **TradeFilterPipeline** usa fórmula simplificada: liquidez, holders, momentum (volume ratio), rug score, smart money.
- **EntryStrategy** usa `scoreMomentum` mais rígido:
  - `volumeRatio` 0,2 (volume caindo) → 0 pontos
  - `priceChangePercent5min` = 0 (não populado) → 0 pontos
  - Penaliza forte volume collapsing

### Volume collapsing

`vol_trend = volume1min / volume5minAvg` = 0,20 → volume recente é 20% da média 5min.  
`volumeCollapsingThreshold` = 0,5. Qualquer token com volume em queda é bloqueado pelo MomentumStrategy.

### EMAS

`EarlyMomentumStrategy` exige EMAS ≥ 60 e tendência de alta (score atual ≥ anterior + 5).  
Token com EMAS 56 não passa.

---

## 3. Fluxo de Decisão — Onde Bloqueia

```
138 tokens recebidos
    │
    ▼
Signal Stack
  ├── 136 FALHARAM (liquidez 124, top_holder 78, top5 62)
  └── 2 PASSARAM
    │
    ▼
TradeFilterPipeline (Stage 1–6)
  └── 2 PASSARAM (entry score 63,82)
    │
    ▼
StrategyRegistry.evaluateAll()
  ├── EntryStrategy → skip (score 42,5 < 45)
  ├── MomentumStrategy → skip (volume collapsing)
  ├── LaunchStrategy → skip (Phase 1 disabled)
  ├── EarlyMomentumStrategy → skip (EMAS 56 < 60)
  ├── SmartMoneyTracker → skip (0 tier-1 buying)
  └── WhaleMonitor → skip (sem whale accumulation)
    │
    ▼
getBestBuySignal() → null → no_buy_signal
```

---

## 4. Recomendações

### A. Ajustes Imediatos (baixo risco)

1. **Usar tier `aggressive`**  
   - `STRATEGY_TIER=aggressive` no Railway  
   - Min liquidez: 3 SOL  
   - Max top holder: 40%  
   - Max top 5: 70%  
   - Min entry score: 45  

2. **Relaxar `volumeCollapsingThreshold`**  
   - Atual: 0,5  
   - Sugestão: 0,3 (aceitar tokens com volume 30% da média 5min)  
   - Arquivo: `src/strategies/config.ts` → `SHARED_MOMENTUM.volumeCollapsingThreshold`

3. **Relaxar EMAS mínimo**  
   - Atual: 60  
   - Sugestão: 55  
   - Arquivo: `src/strategies/EarlyMomentumStrategy.ts` → `EMAS_MIN`

### B. Ajustes Moderados (calibrar depois)

4. **Alinhar entry score entre TradeFilterPipeline e EntryStrategy**  
   - Ou usar o score do pipeline como fonte única, ou  
   - Suavizar `scoreMomentum` do EntryStrategy quando `volume5minAvg > 0` mas ratio baixo (ex.: mínimo 20 em vez de 0).

5. **Relaxar Signal Stack para tier aggressive**  
   - `minLiquiditySol`: 2,5 SOL (apenas para aggressive)  
   - `maxTopHolderPercent`: 45%  
   - `maxTop5HolderPercent`: 75%

### C. Melhorias de Observabilidade

6. **Logar tier em uso no startup**  
   - Garantir que `STRATEGY_TIER` está sendo lido corretamente.

7. **Diagnóstico por tier**  
   - Se o tier puder vir do Redis, expor no dashboard qual tier está ativo.

---

## 5. Ações Sugeridas (Ordem)

| # | Ação | Impacto esperado | Status |
|---|------|------------------|:------:|
| 1 | `STRATEGY_TIER=aggressive` no Railway | Mais tokens passam no Signal Stack | **Manual** |
| 2 | `volumeCollapsingThreshold: 0.3` | MomentumStrategy deixa passar tokens com volume em queda moderada | **Implementado** |
| 3 | `EMAS_MIN: 55` | EarlyMomentumStrategy aceita mais tokens | **Implementado** |
| 4 | Revisar `scoreMomentum` no EntryStrategy | Reduz discrepância com TradeFilterPipeline | Pendente |

---

## 6. Verificação do Tier Atual

O tier padrão é `conservative` (`src/config/index.ts`).  
Confirme no Railway se `STRATEGY_TIER` está definido. Se não estiver, o bot usa conservative (5 SOL, top holder 30%).

---

## 7. tokens_received = 0 — Diagnóstico Adicional (2026-03-11)

Quando `tokens_received` é 0 mas há atividade em `pool_not_found`, `swap_gate_deferred`, `institutional_filtered`:

**O que significa:** Tokens **estão** sendo detectados e processados. Nenhum passou todos os gates (pool + swap + institucional).

**Funil típico:**
- `scanner_skip_cache` + `scanner_skip_no_mint` — jobs ignorados antes do pool scan
- `pool_not_found` — pool não encontrado (RPC/lag ou token ainda na bonding curve)
- `tokens_pool_found` — pool encontrado (nova métrica)
- `swap_gate_deferred` — DexScreener ainda sem dados de swap (token muito novo)
- `tokens_passed_swap_gate` — passou o gate de swap (nova métrica)
- `institutional_filtered` — bundle ou dev cluster detectado
- `tokens_received` — passou tudo e entrou no pipeline

**Ajustes implementados:**
- Swap gate: defer máximo aumentado de 2 para **3** (3 min para DexScreener indexar)
- **Swap gate bypass**: quando pool tem liquidez ≥ minLiquiditySol (tier) e pool_age ≥ 30s, passa sem DexScreener
- **Pool retry**: quando pool_not_found, retry 1x após 30s (pool pode não estar indexado)
- **Filtros institucionais relaxados**: bundle 5 wallets, insider 6 dos primeiros 10, dev cluster 4 holders
- Novas métricas: `tokens_pool_found`, `tokens_passed_swap_gate` no dashboard
