# Estratégias de Compra de Memecoins — Bot Toliver

> Documento gerado em 2026-03-09 com base no código-fonte do projeto.

O bot possui **20 estratégias de compra** distribuídas em 4 módulos: `EntryStrategy`, `LaunchStrategy`, `MomentumStrategy`, `SmartMoneyTracker`, `WhaleMonitor` e `TradeFilterPipeline`. Cada uma opera com 3 tiers de risco: **Conservative**, **Balanced** e **Aggressive**.

---

## Índice

| #  | Estratégia                         | Módulo              |
|----|------------------------------------|---------------------|
| 1  | New Token Sniper (Type A)          | EntryStrategy       |
| 2  | Pool Creation Sniper (Type B)      | EntryStrategy       |
| 3  | Momentum Confirmation (Type C)     | EntryStrategy       |
| 4  | Dip Re-Entry (Type D)              | EntryStrategy       |
| 5  | Phase 1 — Ignition Sniper         | LaunchStrategy      |
| 6  | Phase 2 — Discovery Confirmation  | LaunchStrategy      |
| 7  | Phase 3 — Momentum Entry          | LaunchStrategy      |
| 8  | Pump.fun Near-Graduation          | LaunchStrategy      |
| 9  | Strong Momentum Buy               | MomentumStrategy    |
| 10 | Moderate Momentum Buy             | MomentumStrategy    |
| 11 | Copy Trade — 1 Tier-1 Wallet      | SmartMoneyTracker   |
| 12 | Copy Trade — 2 Tier-1 Wallets     | SmartMoneyTracker   |
| 13 | Copy Trade — 3+ Tier-1 Wallets    | SmartMoneyTracker   |
| 14 | Copy Trade — 2+ Tier-2 Wallets    | SmartMoneyTracker   |
| 15 | Multi-Whale Buy Signal             | WhaleMonitor        |
| 16 | Whale Confidence Buy               | WhaleMonitor        |
| 17 | Liquidity + Safety Bypass          | TradeFilterPipeline |
| 18 | Smart Money Override               | TradeFilterPipeline |
| 19 | Extreme Rug Score Override         | TradeFilterPipeline |
| 20 | Euphoria Sentiment Override        | TradeFilterPipeline |

---

## Pré-requisitos Globais (Signal Stack)

Antes de qualquer estratégia de entrada ser avaliada, o token precisa passar por estas condições mínimas:

| Condição                  | Valor (Aggressive)     |
|---------------------------|------------------------|
| Liquidez mínima           | ≥ 1 SOL               |
| Holders mínimos           | ≥ 3                    |
| Top holder máx.           | ≤ 100%                 |
| Top 5 holders máx.        | ≤ 100%                 |
| Mint authority desabilitada | Sim                   |
| Freeze authority ausente  | Sim                    |
| Buy TX nos últimos 60s    | ≥ 1                    |
| Token não blacklistado    | Sim                    |
| Rug score mínimo          | ≥ 60                   |

Além disso, o **Anti-FOMO Gate** bloqueia entradas quando o preço já subiu demais desde o lançamento (300%/500%/1000% conforme tier) e não há smart money ou volume sustentando.

---

## 1. New Token Sniper (Type A)

**Arquivo:** `EntryStrategy.ts` → `evaluateTypeA()`

**Quando ativa:** Token com menos de **60 segundos** de existência.

**Condições:**
- Token age < 60s
- Liquidez > 0 SOL
- Rug score ≥ 70
- Top holder < 20%

**Tamanho da posição:** Limitado ao `solSizeMax` do tier (0.03 / 0.5 / 1.0 SOL).

**Risco:** Alto — token muito novo, sem histórico de preço.

---

## 2. Pool Creation Sniper (Type B)

**Arquivo:** `EntryStrategy.ts` → `evaluateTypeB()`

**Quando ativa:** Token com menos de **10 minutos** e pool recém-criada.

**Condições:**
- Token age < 600s
- Pool initial SOL ≥ `phase1MinPoolSol` (3 SOL)
- Token não blacklistado
- Holder count ≥ mínimo do tier (3/5/10)

**Risco:** Médio-alto — pool confirmada com liquidez mínima.

---

## 3. Momentum Confirmation (Type C)

**Arquivo:** `EntryStrategy.ts` → `evaluateTypeC()`

**Quando ativa:** Token entre **1 e 30 minutos** de idade com sinais de momentum.

**Condições:**
- Token age 60s–1800s
- Volume ratio (1min / 5min avg) ≥ 3x
- Variação de preço em 5min ≥ 15%
- Crescimento de holders ≥ 2/min
- Liquidez USD ≥ $5.000

**Risco:** Moderado — momentum confirmado por múltiplas métricas.

---

## 4. Dip Re-Entry (Type D)

**Arquivo:** `EntryStrategy.ts` → `evaluateTypeD()`

**Quando ativa:** Token que o bot **já negociou antes** e está em queda.

**Condições:**
- Token previamente tradado
- Queda de 40%–70% desde o pico
- Volume ainda ativo
- Holder count não está diminuindo

**Tamanho:** Reduzido em 50% (multiplicador 0.5x).

**Risco:** Moderado — reentrada em token conhecido com volume sustentado.

---

## 5. Phase 1 — Ignition Sniper

**Arquivo:** `LaunchStrategy.ts` → `evaluatePhase1Sniper()`

**Quando ativa:** Token na fase **Ignition** (0–300 segundos).

**Condições (gates sequenciais):**
1. Pool initial SOL ≥ 3 SOL
2. Rug score ≥ 65
3. Mint authority desabilitada
4. Sem bundle launch detectado
5. Honeypot simulation passada

**Confidence:** 0.65 (fixo)

**Tamanho:** `min(solSizeMax, liquidez × 0.5%)`

---

## 6. Phase 2 — Discovery Confirmation

**Arquivo:** `LaunchStrategy.ts` → `evaluatePhase2Confirmation()`

**Quando ativa:** Token na fase **Discovery** (5–15 minutos).

**Condições:**
- Holders ≥ 20
- Unique buyers em 5min ≥ 15
- Buy/sell ratio ≥ 0.55
- Preço subiu desde o lançamento (sem bomba acima de 500%)
- Liquidez estável (variação < 5% em 2min)
- Mint e freeze authority OK
- Rug score ≥ 80% do threshold mínimo
- Honeypot simulation passada

**Confidence:** 0.75

---

## 7. Phase 3 — Momentum Entry

**Arquivo:** `LaunchStrategy.ts` → `evaluatePhase3Momentum()`

**Quando ativa:** Token na fase **Momentum** (15–60 minutos).

**Condições:**
- Preço subindo
- Volume ratio ≥ 1.5x
- Holders não estão diminuindo
- Honeypot simulation passada

**Confidence:** `min(0.65, volumeRatio / 5)`

**Tamanho:** `solSizeMin × 1.5`

---

## 8. Pump.fun Near-Graduation

**Arquivo:** `LaunchStrategy.ts` → `evaluatePumpFun()`

**Quando ativa:** Token criado via Pump.fun prestes a **graduar para Raydium**.

**Condições:**
- Token source = `pumpfun`
- Market cap entre $50K e $69K (pré-graduação)
- Pump.fun creation rate < 100 tokens/hora (sem overheat)
- Honeypot simulation passada

**Confidence:** 0.70

**Tamanho:** `solSizeMax × 0.6`

**Lógica:** Antecipar a listagem no Raydium quando o token está prestes a atingir o market cap de graduação ($69K).

---

## 9. Strong Momentum Buy

**Arquivo:** `MomentumStrategy.ts` → `evaluate()`

**Quando ativa:** Volume trend **acima de 3x** com preço subindo.

**Condições:**
- Volume trend (1min / 5min avg) > 3.0x
- Preço subindo (`priceRising = true`)
- Sem wash trading detectado
- Score boost de +15 pontos

**Confidence:** `min(1.0, (momentumScore / 100) + 0.15)`

**Tamanho:** `solSizeMax × confidence`

---

## 10. Moderate Momentum Buy

**Arquivo:** `MomentumStrategy.ts` → `evaluate()`

**Quando ativa:** Volume trend entre **1.5x e 3x** com preço subindo.

**Condições:**
- Volume trend ≥ 1.5x (e < 3.0x)
- Preço subindo
- Sem wash trading
- Sem padrão de absorção (volume alto sem preço subir)

**Confidence:** `(momentumScore / 100) × 0.8`

**Tamanho:** `solSizeMin × confidence`

---

## 11. Copy Trade — 1 Tier-1 Wallet

**Arquivo:** `SmartMoneyTracker.ts` → `evaluateCopyTradeEntry()`

**Quando ativa:** **1 carteira tier-1** (score ≥ 70) está comprando o token.

**Condições:**
- 1 tier-1 wallet buying
- Rug score ≥ 60

**Tamanho:** 50% do tamanho base (`copyTrade1WalletSizePct`)

---

## 12. Copy Trade — 2 Tier-1 Wallets

**Arquivo:** `SmartMoneyTracker.ts` → `evaluateCopyTradeEntry()`

**Quando ativa:** **2 carteiras tier-1** estão comprando simultaneamente.

**Condições:**
- 2 tier-1 wallets buying
- Rug score ≥ 60

**Tamanho:** 100% do tamanho base (`copyTrade2WalletSizePct`)

---

## 13. Copy Trade — 3+ Tier-1 Wallets

**Arquivo:** `SmartMoneyTracker.ts` → `evaluateCopyTradeEntry()`

**Quando ativa:** **3 ou mais carteiras tier-1** estão comprando — sinal mais forte.

**Condições:**
- ≥ 3 tier-1 wallets buying
- Rug score ≥ 60

**Tamanho:** 150% do tamanho base (`copyTrade3WalletSizePct`) — **BOOST entry**.

---

## 14. Copy Trade — 2+ Tier-2 Wallets

**Arquivo:** `SmartMoneyTracker.ts` → `evaluateCopyTradeEntry()`

**Quando ativa:** **2 ou mais carteiras tier-2** (score 50–70) estão comprando.

**Condições:**
- ≥ 2 tier-2 wallets buying
- Sem tier-1 wallets suficientes para ativar as estratégias 11-13

**Tamanho:** 35% do tamanho base (50% × 0.7)

**Risco:** Menor confiança — carteiras de nível inferior.

---

## 15. Multi-Whale Buy Signal

**Arquivo:** `WhaleMonitor.ts` → `evaluateBuySignal()`

**Quando ativa:** **3+ baleias distintas** comprando nos últimos 5 minutos.

**Condições:**
- ≥ 3 distinct whale buyers em 5min
- Sem wash trading de baleias detectado

**Efeito:**
- Score boost: +30 pontos (buyScoreBoost × 1.5)
- Size multiplier: 1.5x
- TP boost: +50% nos targets de profit

---

## 16. Whale Confidence Buy

**Arquivo:** `WhaleMonitor.ts` → `evaluateBuySignal()`

**Quando ativa:** Baleias com **alta pontuação de confiança** estão comprando.

**Condições:**
- Whale confidence score > 0.5
- Rug score ≥ 65
- Token age < 30 minutos

**Efeito:**
- Score boost: +20 pontos
- Sem multiplicador de tamanho (1.0x)

---

## 17. Liquidity + Safety Bypass

**Arquivo:** `TradeFilterPipeline.ts` → `applyOverrides()`

**Quando ativa:** Token com **liquidez alta e segurança básica** confirmada.

**Condições:**
- Liquidez ≥ 12 SOL
- Holders ≥ 3
- Rug score ≥ 60
- Mint authority desabilitada
- Freeze authority ausente

**Efeito:** Entry score é automaticamente elevado ao mínimo necessário, permitindo que tokens com boa liquidez passem pelo filtro mesmo com scores marginais.

---

## 18. Smart Money Override

**Arquivo:** `TradeFilterPipeline.ts` → `applyOverrides()`

**Quando ativa:** **3+ carteiras tier-1** estão comprando o token.

**Condições:**
- `tier1WalletsBuying ≥ smartMoneyOverrideMinWallets` (3)

**Efeito:** Bypass dos filtros soft — entry score elevado ao threshold mínimo. Smart money de alta confiança supera análise técnica.

---

## 19. Extreme Rug Score Override

**Arquivo:** `TradeFilterPipeline.ts` → `applyOverrides()`

**Quando ativa:** Token com **rug score extremamente alto**.

**Condições:**
- Rug score ≥ 95

**Efeito:** +5 pontos bônus no entry score. Token considerado extremamente seguro recebe tratamento preferencial.

---

## 20. Euphoria Sentiment Override

**Arquivo:** `TradeFilterPipeline.ts` → `applyOverrides()`

**Quando ativa:** Mercado em **sentimento de euforia**.

**Condições:**
- Sentiment score ≥ 85

**Efeito:** Override para tier agressivo — em mercados eufóricos, o bot relaxa os critérios de entrada.

---

## Resumo dos Tiers

| Parâmetro                | Conservative | Balanced | Aggressive |
|--------------------------|:------------:|:--------:|:----------:|
| Min Liquidez (SOL)       | 2            | 3        | 1          |
| Min Holders              | 10           | 5        | 3          |
| Min Entry Score          | 50           | 60       | 45         |
| SOL Size Min             | 0.02         | 0.10     | 0.20       |
| SOL Size Max             | 0.03         | 0.50     | 1.00       |
| Slippage Tolerância      | 3%           | 7%       | 15%        |
| Max Gain Anti-FOMO       | 300%         | 500%     | 1000%      |
| Hard Stop Loss           | 10%          | 20%      | 25%        |
| Max Posições Simultâneas | 3            | 5        | 5          |
| Max Perda Diária         | 5%           | 8%       | 12%        |

---

## Fluxo Completo de Decisão de Compra

```
Token Detectado
    │
    ▼
Signal Stack (pré-condições globais)
    │ FAIL → Skip
    ▼ PASS
Anti-FOMO Gate
    │ FAIL → Skip
    ▼ PASS
TradeFilterPipeline
    ├── Stage 1: Hard Reject (blacklist, rug devs, honeypot DB)
    ├── Stage 2: Deep Analysis (top holder %, honeypot sim, entry score)
    ├── Overrides (#17-#20)
    └── Final Score Gate (score ≥ threshold)
    │ FAIL → Skip
    ▼ PASS
EntryStrategy (Types A-D)
    │
LaunchStrategy (Phases 1-3, Pump.fun)
    │
MomentumStrategy (Strong/Moderate)
    │
SmartMoneyTracker (Copy Trade)
    │
WhaleMonitor (Whale Buy Signals)
    │
    ▼
StrategyRegistry → getBestBuySignal()
    │
    ▼
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
