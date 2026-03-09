# Estratégias de Compra de Memecoins — Bot Toliver

> Documento atualizado em 2026-03-09 — Overhaul de redução de risco.
>
> Principais mudanças: Type A (New Token Sniper) **desabilitado**, Phase 1 (Ignition Sniper) **desabilitada**, filtros globais muito mais rigorosos, limites de posição e overtrading adicionados.

O bot possui **18 estratégias de compra ativas** (2 desabilitadas) distribuídas em 4 módulos: `EntryStrategy`, `LaunchStrategy`, `MomentumStrategy`, `SmartMoneyTracker`, `WhaleMonitor` e `TradeFilterPipeline`. Cada uma opera com 3 tiers de risco: **Conservative**, **Balanced** e **Aggressive**.

---

## Índice

| #  | Estratégia                         | Módulo              | Status       |
|----|------------------------------------|---------------------|--------------|
| 1  | New Token Sniper (Type A)          | EntryStrategy       | **DISABLED** |
| 2  | Pool Creation Sniper (Type B)      | EntryStrategy       | Ativo        |
| 3  | Momentum Confirmation (Type C)     | EntryStrategy       | Ativo        |
| 4  | Dip Re-Entry (Type D)              | EntryStrategy       | Ativo        |
| 5  | Phase 1 — Ignition Sniper         | LaunchStrategy      | **DISABLED** |
| 6  | Phase 2 — Discovery Confirmation  | LaunchStrategy      | Ativo        |
| 7  | Phase 3 — Momentum Entry          | LaunchStrategy      | Ativo        |
| 8  | Pump.fun Near-Graduation          | LaunchStrategy      | Ativo        |
| 9  | Strong Momentum Buy               | MomentumStrategy    | Ativo        |
| 10 | Moderate Momentum Buy             | MomentumStrategy    | Ativo        |
| 11 | Copy Trade — 1 Tier-1 Wallet      | SmartMoneyTracker   | Ativo        |
| 12 | Copy Trade — 2 Tier-1 Wallets     | SmartMoneyTracker   | Ativo        |
| 13 | Copy Trade — 3+ Tier-1 Wallets    | SmartMoneyTracker   | Ativo        |
| 14 | Copy Trade — 2+ Tier-2 Wallets    | SmartMoneyTracker   | Ativo        |
| 15 | Multi-Whale Buy Signal             | WhaleMonitor        | Ativo        |
| 16 | Whale Confidence Buy               | WhaleMonitor        | Ativo        |
| 17 | Liquidity + Safety Bypass          | TradeFilterPipeline | Ativo        |
| 18 | Smart Money Override               | TradeFilterPipeline | Ativo        |
| 19 | Extreme Rug Score Override         | TradeFilterPipeline | Ativo        |
| 20 | Euphoria Sentiment Override        | TradeFilterPipeline | Ativo        |

---

## Pré-requisitos Globais (Signal Stack)

Antes de qualquer estratégia de entrada ser avaliada, o token precisa passar por estas condições mínimas:

| Condição                     | Aggressive | Balanced | Conservative |
|------------------------------|:----------:|:--------:|:------------:|
| Liquidez mínima              | ≥ 5 SOL   | ≥ 8 SOL  | ≥ 12 SOL     |
| Holders mínimos              | ≥ 10      | ≥ 15     | ≥ 20         |
| Top holder máx.              | ≤ 12%     | ≤ 12%    | ≤ 12%        |
| Top 5 holders máx.           | ≤ 35%     | ≤ 35%    | ≤ 35%        |
| Top 10 holders máx.          | ≤ 50%     | ≤ 50%    | ≤ 50%        |
| Buy TX nos últimos 60s       | ≥ 3       | ≥ 3      | ≥ 3          |
| Token age mínimo             | ≥ 120s    | ≥ 120s   | ≥ 120s       |
| Rug score mínimo             | ≥ 70      | ≥ 70     | ≥ 70         |
| Freeze authority ausente     | Sim       | Sim      | Sim          |
| Mint authority desabilitada  | Sim       | Sim      | Sim          |
| Token não blacklistado       | Sim       | Sim      | Sim          |

### Anti-FOMO Gate

Bloqueia entradas quando o preço já subiu demais desde o lançamento:

| Tier         | Max Gain desde Launch |
|:------------:|:---------------------:|
| Conservative | 120%                  |
| Balanced     | 150%                  |
| Aggressive   | 200%                  |

Tokens que ultrapassem esse limite só podem ser comprados se houver **confirmação de smart money** (tier-1 wallet holding + buying) **ou whale accumulation** (≥ 2 whales distintos comprando nos últimos 5 min).

---

## 1. New Token Sniper (Type A) — DESABILITADO

**Status:** ❌ DESABILITADO

Tokens com menos de 60 segundos possuem probabilidade extremamente alta de rug pull. Esta estratégia foi completamente desabilitada.

---

## 2. Pool Creation Sniper (Type B)

**Arquivo:** `EntryStrategy.ts` → `evaluateTypeB()`

**Quando ativa:** Token com idade entre **120s e 600s** com pool confirmada.

**Condições:**
- Token age: 120s – 600s
- Pool initial SOL ≥ 5 SOL
- Holder count ≥ 10
- Top holder ≤ 12%
- Buy/sell ratio ≥ 0.60
- Unique buyers (últimos 2 min) ≥ 8
- Token não blacklistado

**Tamanho:** Máximo de 1% da liquidez da pool.

---

## 3. Momentum Confirmation (Type C)

**Arquivo:** `EntryStrategy.ts` → `evaluateTypeC()`

**Quando ativa:** Token entre **180s e 1800s** de idade com sinais de momentum.

**Condições:**
- Token age: 180s – 1800s
- Volume ratio (1min / 5min avg) ≥ 2.5x
- Variação de preço em 5min: 8% – 80%
- Crescimento de holders ≥ 2/min
- Liquidez USD ≥ $15.000
- Buy/sell ratio ≥ 0.60
- Unique buyers (5min) ≥ 15

---

## 4. Dip Re-Entry (Type D)

**Arquivo:** `EntryStrategy.ts` → `evaluateTypeD()`

**Quando ativa:** Token previamente negociado em queda.

**Condições:**
- Token previamente tradado
- Queda entre 35% e 60% do ATH
- Volume (1min) ≥ 70% do volume médio (5min)
- Holder count não diminuindo
- Buy/sell ratio ≥ 0.55

**Tamanho:** 40% da posição original.

---

## 5. Phase 1 — Ignition Sniper — DESABILITADO

**Status:** ❌ DESABILITADO

Tokens na fase Ignition (0–300s) possuem risco extremo de rug pull. Esta fase foi completamente desabilitada.

---

## 6. Phase 2 — Discovery Confirmation

**Arquivo:** `LaunchStrategy.ts` → `evaluatePhase2Confirmation()`

**Quando ativa:** Token na fase **Discovery** (300s – 900s).

**Condições:**
- Holders ≥ 25
- Unique buyers (5min) ≥ 18
- Buy/sell ratio ≥ 0.60
- Volume trend ≥ 2.0x
- Preço desde lançamento: +10% a +200%
- Liquidez ≥ 8 SOL
- Liquidez estável (<5% variação em 2min)
- Mint e freeze authority OK
- Honeypot simulation passada

**Confidence:** 0.75

---

## 7. Phase 3 — Momentum Entry

**Arquivo:** `LaunchStrategy.ts` → `evaluatePhase3Momentum()`

**Quando ativa:** Token na fase **Momentum** (900s – 3600s).

**Condições:**
- Volume ratio ≥ 1.8x
- Preço subindo (priceRising = true)
- Holder growth ≥ 1.5/min
- Buy/sell ratio ≥ 0.58
- Liquidez ≥ 10 SOL
- Honeypot simulation passada

**Confidence:** `min(0.65, volumeRatio / 5)`

---

## 8. Pump.fun Near-Graduation

**Arquivo:** `LaunchStrategy.ts` → `evaluatePumpFun()`

**Quando ativa:** Token Pump.fun prestes a graduar para Raydium.

**Condições:**
- Token source = `pumpfun`
- Market cap: $55K – $69K
- Pump.fun creation rate ≤ 80 tokens/hora
- Unique buyers (10min) ≥ 20
- Liquidez projetada ≥ 12 SOL
- Honeypot simulation passada

**Confidence:** 0.70

---

## 9. Strong Momentum Buy

**Arquivo:** `MomentumStrategy.ts` → `evaluate()`

**Quando ativa:** Volume trend **acima de 3.5x** com confirmações fortes.

**Condições:**
- Volume trend > 3.5x
- Price change (5min) ≥ 12%
- Buy/sell ratio ≥ 0.62
- Unique buyers (2min) ≥ 10
- Preço subindo
- Sem wash trading

---

## 10. Moderate Momentum Buy

**Arquivo:** `MomentumStrategy.ts` → `evaluate()`

**Quando ativa:** Volume trend entre **2.0x e 3.5x** com confirmações.

**Condições:**
- Volume trend ≥ 2.0x (e < 3.5x)
- Price change (5min) ≥ 6%
- Buy/sell ratio ≥ 0.58
- Liquidez ≥ 8 SOL
- Preço subindo
- Sem wash trading

---

## 11. Copy Trade — 1 Tier-1 Wallet

**Arquivo:** `SmartMoneyTracker.ts` → `evaluateCopyTradeEntry()`

**Condições:**
- 1 tier-1 wallet buying
- Token age ≥ 300s
- Rug score ≥ 75

**Tamanho:** 50% do tamanho base. Máximo 1.2% da liquidez.

---

## 12. Copy Trade — 2 Tier-1 Wallets

**Condições:**
- 2 tier-1 wallets buying
- Token age ≥ 240s
- Rug score ≥ 70

**Tamanho:** 100% do tamanho base. Máximo 1.2% da liquidez.

---

## 13. Copy Trade — 3+ Tier-1 Wallets

**Condições:**
- ≥ 3 tier-1 wallets buying
- Token age ≥ 180s
- Rug score ≥ 70

**Tamanho:** 150% do tamanho base (BOOST). Máximo 1.2% da liquidez.

---

## 14. Copy Trade — 2+ Tier-2 Wallets

**Condições:**
- ≥ 2 tier-2 wallets buying
- Sem tier-1 wallets suficientes

**Tamanho:** 35% do tamanho base.

---

## 15. Multi-Whale Buy Signal

**Arquivo:** `WhaleMonitor.ts` → `evaluateBuySignal()`

**Condições:**
- ≥ 3 whales distintos comprando em 5 min
- ≥ 8 SOL acumulados em compras
- Sem whale wash trading

**Efeito:**
- Score boost: +30 pontos
- Size multiplier: 1.5x
- TP boost: +50%

---

## 16. Whale Confidence Buy

**Condições:**
- Whale confidence score ≥ 0.65
- Rug score ≥ 65
- Token age ≥ 300s

**Efeito:**
- Score boost: +20 pontos

---

## 17. Liquidity + Safety Bypass

**Arquivo:** `TradeFilterPipeline.ts` → `applyOverrides()`

**Condições:**
- Liquidez ≥ 20 SOL
- Holders ≥ 10
- Rug score ≥ 70
- Mint authority desabilitada
- Freeze authority ausente

**Efeito:** Entry score elevado ao mínimo necessário.

---

## 18. Smart Money Override

**Condições:**
- ≥ 4 carteiras tier-1 comprando

**Efeito:** Bypass dos filtros soft.

---

## 19. Extreme Rug Score Override

**Condições:**
- Rug score ≥ 97

**Efeito:** +5 pontos bônus no entry score.

---

## 20. Euphoria Sentiment Override

**Condições:**
- Sentiment score ≥ 90

**Efeito:** Override para tier agressivo em mercados eufóricos.

---

## Controle de Risco Global

| Parâmetro                  | Conservative | Balanced | Aggressive |
|----------------------------|:------------:|:--------:|:----------:|
| Max posições simultâneas   | 1            | 2        | 3          |
| Cooldown entre trades      | 20s          | 20s      | 20s        |
| Max trades por minuto      | 2            | 2        | 2          |
| Posição máxima (% pool)    | 1%           | 1%       | 1%         |

---

## Stop Loss e Gestão de Lucro

### Hard Stop Loss

| Tier         | Stop Loss |
|:------------:|:---------:|
| Conservative | 10%       |
| Balanced     | 12%       |
| Aggressive   | 15%       |

### Trailing Rules

| Ganho Atingido | Ação                          |
|:--------------:|-------------------------------|
| +30%           | Mover stop para break even    |
| +60%           | Travar lucro mínimo de +20%   |
| +120%          | Trailing stop de 25%          |

---

## Resumo dos Tiers

| Parâmetro                | Conservative | Balanced | Aggressive |
|--------------------------|:------------:|:--------:|:----------:|
| Min Liquidez (SOL)       | 12           | 8        | 5          |
| Min Holders              | 20           | 15       | 10         |
| Max Top Holder           | 12%          | 12%      | 12%        |
| Max Top 5 Holders        | 35%          | 35%      | 35%        |
| Min Entry Score          | 50           | 60       | 45         |
| SOL Size Min             | 0.02         | 0.10     | 0.20       |
| SOL Size Max             | 0.03         | 0.50     | 1.00       |
| Slippage Tolerância      | 3%           | 7%       | 15%        |
| Max Gain Anti-FOMO       | 120%         | 150%     | 200%       |
| Hard Stop Loss           | 10%          | 12%      | 15%        |
| Max Posições Simultâneas | 1            | 2        | 3          |
| Max Perda Diária         | 5%           | 8%       | 12%        |
| Min Token Age            | 120s         | 120s     | 120s       |
| Min Rug Score            | 70           | 70       | 70         |
| Min Buy TX (60s)         | 3            | 3        | 3          |

---

## Fluxo Completo de Decisão de Compra

```
Token Detectado
    │
    ▼
Signal Stack (pré-condições globais)
  ├── Token age ≥ 120s?
  ├── Liquidez ≥ mínimo tier?
  ├── Holders ≥ mínimo tier?
  ├── Top holder ≤ 12%?
  ├── Top 5 holders ≤ 35%?
  ├── Buy TX ≥ 3 (60s)?
  ├── Rug score ≥ 70?
  ├── Freeze authority ausente?
  └── Mint authority desabilitada?
    │ FAIL → Skip
    ▼ PASS
Anti-FOMO Gate (max gain 120/150/200% por tier)
    │ FAIL → Skip (a menos que smart money/whale confirmem)
    ▼ PASS
TradeFilterPipeline
    ├── Stage 1: Hard Reject (blacklist, rug devs, honeypot DB)
    ├── Stage 2: Deep Analysis (top holder %, honeypot sim, entry score)
    ├── Overrides (#17-#20)
    └── Final Score Gate (score ≥ threshold)
    │ FAIL → Skip
    ▼ PASS
EntryStrategy (Types B-D — Type A desabilitado)
    │
LaunchStrategy (Phase 2-3 + Pump.fun — Phase 1 desabilitada)
    │
MomentumStrategy (Strong/Moderate com filtros adicionais)
    │
SmartMoneyTracker (Copy Trade com token age + rug score gates)
    │
WhaleMonitor (Whale Buy Signals com SOL acumulado mínimo)
    │
    ▼
StrategyRegistry → getBestBuySignal()
    │
    ▼
Risk Control (max posições, cooldown, max trades/min)
    │ BLOCKED → Queue/Skip
    ▼ PASS
Execução da Compra (maior confidence vence)
```

---

## Entry Score — Composição

O score final (0–100) que determina se um token é comprado:

| Componente      | Peso | Cálculo                                           |
|-----------------|:----:|---------------------------------------------------|
| Liquidez        | 25%  | 0–100 baseado em SOL na pool (0→0, 50+→100)       |
| Holders         | 20%  | Contagem + penalidade por concentração + growth    |
| Momentum        | 20%  | Volume ratio + price change 5min + buy TX/60s      |
| Segurança       | 25%  | Rug score + penalidades (mint/freeze/blacklist/dev) |
| Smart Money     | 10%  | Score das carteiras inteligentes no token           |

---

## Mudanças vs. Versão Anterior

| Área                    | Antes                    | Agora                           |
|-------------------------|--------------------------|---------------------------------|
| Type A (New Token)      | Ativo (< 60s)           | **DESABILITADO**                |
| Phase 1 (Ignition)      | Ativo (0-300s)          | **DESABILITADO**                |
| Liquidez min (Aggr.)    | 1 SOL                   | 5 SOL                          |
| Holders min (Aggr.)     | 3                        | 10                              |
| Top holder máx.         | 100% (Aggr.)            | 12% (todos)                    |
| Top 5 holders máx.      | 100% (Aggr.)            | 35% (todos)                    |
| Token age mínimo        | 0s                       | 120s                            |
| Min buy TX (60s)        | 1                        | 3                               |
| Anti-FOMO (Aggr.)       | 1000%                    | 200%                            |
| Hard stop (Aggr.)       | 25%                      | 15%                             |
| Hard stop (Balanced)    | 20%                      | 12%                             |
| Max posições (Cons.)    | 3                        | 1                               |
| Max posições (Bal.)     | 5                        | 2                               |
| Max posições (Aggr.)    | 5                        | 3                               |
| Strong momentum vol     | ≥ 3.0x                   | ≥ 3.5x + price/ratio/buyers    |
| Moderate momentum vol   | ≥ 1.5x                   | ≥ 2.0x + price/ratio/liquidity |
| Smart money override    | 3 tier-1 wallets         | 4 tier-1 wallets               |
| Extreme rug override    | ≥ 95                     | ≥ 97                            |
| Euphoria override       | ≥ 85                     | ≥ 90                            |
| Liquidity bypass        | ≥ 12 SOL                 | ≥ 20 SOL                       |
| Copy trade 1 T1         | rug ≥ 60                 | age ≥ 300s, rug ≥ 75           |
| Whale confidence        | > 0.5, age < 30min       | ≥ 0.65, age ≥ 300s             |
| Whale multi-buy         | 3 whales                 | 3 whales + 8 SOL acumulados    |
| Pump.fun near-grad      | mcap 50-69K              | mcap 55-69K + 20 buyers/10min  |
| Phase 2 holders         | ≥ 20                     | ≥ 25                            |
| Phase 3 volume          | ≥ 1.5x                   | ≥ 1.8x + ratio + growth + liq  |
