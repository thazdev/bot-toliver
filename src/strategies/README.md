# Trading Strategies

## How to Create a New Strategy

1. Create a new file in this directory (e.g. `MyStrategy.ts`)
2. Extend the `BaseStrategy` abstract class
3. Implement the required properties and `evaluate` method

### Example

```typescript
import { BaseStrategy } from './BaseStrategy.js';
import type { StrategyContext, StrategyResult } from '../types/strategy.types.js';

export class MyStrategy extends BaseStrategy {
  readonly name = 'MyStrategy';
  readonly description = 'A brief description of what this strategy does';
  readonly version = '1.0.0';

  async evaluate(context: StrategyContext): Promise<StrategyResult> {
    // Analyze context and return a signal
    return {
      signal: 'hold',
      confidence: 0,
      reason: 'No conditions met',
      suggestedSizeSol: 0,
    };
  }
}
```

## StrategyContext

The `evaluate` method receives a `StrategyContext` object containing:

| Field        | Type       | Description                                       |
|-------------|------------|---------------------------------------------------|
| tokenInfo   | TokenInfo  | Token metadata (mint, symbol, decimals, supply...) |
| poolInfo    | PoolInfo   | Pool data (address, liquidity, price, volume...)   |
| position    | Position?  | Existing position if one is open for this token    |
| currentPrice| number     | Current token price in SOL                         |
| liquidity   | number     | Current pool liquidity in SOL                      |
| volume      | number     | Recent trading volume                              |
| timestamp   | number     | Current timestamp in milliseconds                  |

## StrategyResult

Your `evaluate` method must return a `StrategyResult`:

| Field           | Type            | Description                                    |
|----------------|-----------------|------------------------------------------------|
| signal         | StrategySignal  | One of: 'buy', 'sell', 'hold', 'skip'          |
| confidence     | number          | 0 to 1 — how confident the strategy is          |
| reason         | string          | Human-readable explanation of the decision       |
| suggestedSizeSol| number         | Suggested position size in SOL                   |

## How to Register a Strategy

In `src/main.ts`, after initializing the `StrategyRegistry`:

```typescript
import { MyStrategy } from './strategies/MyStrategy.js';

const strategyRegistry = new StrategyRegistry();
strategyRegistry.register(new MyStrategy());
```

## How Confidence Affects Position Sizing

The `PositionSizer` uses a Kelly-inspired formula:

```
positionSize = (maxPositionSize * 0.5) * confidence
```

- A confidence of 1.0 yields 50% of max position size
- A confidence of 0.5 yields 25% of max position size
- The size is always capped at `MAX_POSITION_SIZE_SOL` and available capital

Higher confidence = larger position, but always within risk limits.
