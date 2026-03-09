# Revisão das Regras para "Passed" — Pipeline + Estratégias

## Fluxo Geral

```
Tokens detectados → Pipeline (6 estágios + score gate) → Estratégias (Entry, Momentum, Launch)
                                                              ↓
                                              Se ALGUMA retorna BUY → Trade executado
                                              Se TODAS retornam SKIP → Nenhum trade
```

O contador `passed` = tokens que **passaram o pipeline inteiro** (chegaram ao `diag:passed_tokens_log`).
Para um **trade ser executado**, além de passar o pipeline, pelo menos uma estratégia deve retornar sinal de compra.

---

## 1. Pipeline — Condições para Passar

### Stage 1 (Hard Reject)
| Regra | Valor | Rigidez |
|-------|-------|---------|
| Não blacklisted | - | OK |
| Não known rug dev | - | OK |
| Não honeypot em DB | - | OK |
| Não token blacklisted | - | OK |

### Stage 2/3 (Basic Viability)
| Regra | Valor CONSERVATIVE | Rejeitados | Rigidez |
|-------|-------------------|------------|---------|
| **liquidity >= minLiquiditySol** | 2 SOL | **502** | **ALTA** — muitos tokens PumpFun têm < 2 SOL |
| **mintAuthorityDisabled** | true | 0 | OK |
| **freezeAuthorityAbsent** | penaliza rug -20, não rejeita | 175* | *EntryStrategy exige freeze absent |
| **rugScore >= minRugScoreStep3** | 50 | 0 | OK (após penalidade freeze, rug=50 passa) |

### Stage 4 (Deep Analysis)
| Regra | Valor | Rigidez |
|-------|-------|---------|
| **topHolderPercent <= maxTopHolderPercent** | 100% | Ajustado para PumpFun (bonding curve) |
| **honeypotSimulationPassed** | true | OK (default true) |

### Stage 5 (Market Context)
| Regra | Valor | Rigidez |
|-------|-------|---------|
| sentimentRegime !== 'panic' | - | OK |
| consecutiveLosses < 5 | - | OK |
| dailyLossPercent < 5% | - | OK |
| jupiterAvailable | true | OK |

### Stage 6 (Sizing Risk)
| Regra | Valor | Rigidez |
|-------|-------|---------|
| **hotWalletBalance >= 0.1 SOL** | 0.1 | **MÉDIA** — em dry-run pode ser fixo 1 |

### Final Score Gate
| Regra | Valor | Rigidez |
|-------|-------|---------|
| **adjustedScore >= minEntryScoreThreshold** | 60 | **MÉDIA** — score depende de volume (0) e smartMoney (0) |

### Bypasses (podem elevar score)
- Liquidez >= 12 SOL + 3+ holders + rug >= 60 + mint disabled + freeze absent → score = 60
- 3+ tier1 wallets buying → score = 60
- rugScore >= 95 → +5 no score

---

## 2. Estratégias — Condições para BUY Signal

### EntryStrategy.passesSignalStack (TODAS devem passar)
| Regra | Valor | Rigidez |
|-------|-------|---------|
| liquidity >= MIN_LIQUIDITY_FOR_SIGNAL | 1 SOL | OK |
| **holderCount >= minHolderCount** | **10** | **ALTA** — tokens novos podem ter < 10 |
| topHolderPercent <= 100 | 100% | OK |
| top5HolderPercent <= 100 | 100% | OK |
| mintAuthorityDisabled | true | OK |
| **freezeAuthorityAbsent** | true | **ALTA** — 175 tokens têm freeze |
| **buyTxLast60s >= MIN_BUYS_LAST_60S** | 1 | **ALTA** — se API falha, = 0 |
| !isBlacklisted | - | OK |
| **rugScore >= 70** | **70 (hardcoded)** | **ALTA** — freeze dá -20 → rug=50, falha |

### LaunchStrategy
| Regra | Valor | Rigidez |
|-------|-------|---------|
| **phase !== 'birth'** | birthMaxSec = 3 | **ALTA** — tokenAgeSec < 3s bloqueia |
| phase !== 'decline' | > 2h | OK |
| phase !== 'peak' | - | OK |
| Phase 1 sniper: poolInitialSol >= 2, rug >= 60 | - | Média |

*Problema: tokenAgeSec = (Date.now() - tokenInfo.createdAt). createdAt = new Date() no momento da detecção. Então idade = tempo desde detecção, não criação on-chain. Pode ser 0-5s.*

### MomentumStrategy
| Regra | Valor | Rigidez |
|-------|-------|---------|
| volume5minAvg > 0 (senão skip) | - | **ALTA** — volume sempre 0, sempre skip |
| vol_trend >= 0.5 quando tem volume | - | N/A (nunca tem volume) |

---

## 3. Regras Extremamente Rígidas (Recomendações)

### Críticas — Bloqueiam a maioria dos tokens PumpFun

1. **freezeAuthorityAbsent** (Pipeline stage 2 + EntryStrategy)
   - **175 rejeições**. PumpFun frequentemente usa freeze authority.
   - **Sugestão**: Para dry-run ou PumpFun, aceitar freeze com penalidade (já existe -20 rug) mas não bloquear.

2. **holderCount >= 10** (EntryStrategy)
   - Tokens recém-criados podem ter 0-5 holders.
   - **Sugestão**: Reduzir para 3 no CONSERVATIVE, ou 1 para sniper early.

3. **rugScore >= 70** (EntryStrategy, hardcoded)
   - Com penalidade freeze (-20), rug default 70 vira 50 → falha.
   - **Sugestão**: Usar 60 ou 50, ou ler de config.

4. **buyTxLast60s >= 1** (EntryStrategy)
   - Heurística: holderCount quando API retorna. Se API falha = 0.
   - **Sugestão**: MIN_BUYS_LAST_60S=0 para dry-run, ou aceitar holderCount como proxy.

5. **liquidity >= 2 SOL** (Pipeline stage 2)
   - **502 rejeições**. Muitos tokens PumpFun iniciam com < 2 SOL.
   - **Sugestão**: Reduzir para 1 SOL no CONSERVATIVE.

6. **MomentumStrategy sempre skip** (sem volume)
   - volume1min e volume5minAvg nunca populados → retorna skip.
   - **Sugestão**: Já feito — retorna skip neutro. EntryStrategy e LaunchStrategy precisam gerar o buy.

7. **birthMaxSec = 3** (LaunchStrategy)
   - tokenAgeSec < 3 → Phase 0 Birth → skip.
   - createdAt = momento da detecção, não criação on-chain. Idade pode ser 0-2s.
   - **Sugestão**: birthMaxSec = 0 para permitir tokens imediatamente.

### Médias

8. **minEntryScoreThreshold = 60**
   - Score máximo sem volume/smartMoney ≈ 67. Bypasses podem ajudar.
   - OK por enquanto.

9. **hotWalletBalance >= 0.1**
   - Em main.ts default é 1. OK.

---

## 4. Validação para Dry-Run = Real (sem relaxar)

Objetivo: dry-run deve ser **idêntico** ao modo real. As regras devem fazer sentido para transações reais.

### Regras que FAZEM SENTIDO manter (para real)

| Regra | Justificativa |
|-------|---------------|
| **freezeAuthorityAbsent** | Freeze = dev pode congelar tokens. Mecanismo clássico de rug. Bloquear é correto. |
| **holderCount >= 10** | Filtra tokens com só dev + amigos. 10 holders indica interesse orgânico. |
| **rugScore >= 70** (EntryStrategy) | Barra mais alta que o pipeline (50). Duas etapas de filtro: pipeline passa rug 50+, estratégia exige 70 para buy. |
| **buyTxLast60s >= 1** | Exige alguma atividade de compra. Evita tokens mortos ou honeypot sem compras. |
| **liquidity >= 2 SOL** | Com 0.9 SOL de capital, pool de 2 SOL limita slippage. 1 SOL seria muito fino. |
| **birthMaxSec = 3** | Evita FOMO nos primeiros segundos. 3s é filtro de sanidade. |
| **mintAuthorityDisabled** | Mint ativa = dev pode criar supply infinito. Bloquear é correto. |
| **minEntryScoreThreshold = 60** | Barra mínima de qualidade. |
| **hotWalletBalance >= 0.1** | Garante SOL para gas. |

### Regra excepcional: topHolderPercent = 100%

**Por que 100%?** No PumpFun, o bonding curve segura a maior parte do supply no início. A API de holders trata o curve como "top holder" e reporta 60–100%. Para Raydium, um holder com 100% seria sinal de rug.

**Para real:** No PumpFun, o curve não é um "holder" malicioso — é a AMM. Então 100% aqui não é relaxamento, é ajuste para a estrutura do PumpFun. O risco real está em quem segura o restante (top 5 holders). Para tokens novos, curve + primeiros compradores = 100% de top 5, o que é esperado.

**Conclusão:** Manter 100% para PumpFun é aceitável para real. Para Raydium, um limite mais baixo (ex.: 30%) faria mais sentido, mas isso exigiria lógica por protocolo.

### Inconsistência corrigida: minSize em dry-run

Em `main.ts` havia:
```ts
const minSize = dryRun ? MINIMUM_TRADE_SIZE_SOL : getTierConfig(...).sizing.minPositionSol;
```
- **Dry-run:** minSize = 0.009 SOL
- **Real:** minSize = 0.02 SOL (CONSERVATIVE) ou 0.05 SOL (BALANCED/AGGRESSIVE)

**Correção aplicada:** usar sempre `getTierConfig(...).sizing.minPositionSol` em ambos os modos. Dry-run agora usa o mesmo minSize que real.

### Conclusão final

As regras de filtro estão alinhadas com trading real. Dry-run = real:
1. **Regras:** todas mantidas como estão (sem relaxar).
2. **minSize:** corrigido para usar o mesmo valor em dry-run e real.
