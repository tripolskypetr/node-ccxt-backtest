# Strategy Design Guidelines

## Three-Indicator Architecture

Every strategy uses three Pine Script indicators:

1. **Macro context** — answers "what is the global market direction right now?"
2. **Local moment** — answers "is the market at a dip/bounce worth entering?"
3. **Entry signal** — answers "is this the exact bar to enter?"

The entry signal spams candidates. The macro context kills wrong-direction trades. The local moment kills exhausted entries.

---

## Macro Context (EMA Slope)

**Goal:** detect the global market regime — bull or bear — without reacting to short-term noise.

**Current implementation:** `ema_slope_5m.pine` on 5m bars

- EMA(50) on 5m = ~4h of price memory
- Slope measured over 12 bars = change over last 1h
- `Trend=+1`: EMA rising fast enough AND price not overextended above EMA
- `Trend=-1`: EMA falling fast enough AND price not overextended below EMA
- `Trend=0`: flat EMA or price too far from EMA (overextended, no actionable context)

Key insight: `overextended` flag (price > EMA by `max_dev_pct`) prevents entering at the end of an impulse. This is what blocks entries like "buy at 62k after +44% month" while allowing "buy the dip at 43k when EMA is just starting to rise".

**Outputs contract:**

| Plot name | Type  | Description |
|-----------|-------|-------------|
| `Trend`   | int   | 1 = macro bull, −1 = macro bear, 0 = flat/overextended |
| `Slope`   | float | per-bar EMA % change |
| `DevPct`  | float | (close − EMA) / EMA × 100 |

---

## Local Moment (Extreme Direction)

**Goal:** detect whether price is currently in a pullback (within a macro move) or at equilibrium.

**Current implementation:** `extreme_direction_5m.pine` on 5m bars

Used **inverted** relative to macro context:
- When macro is bull (`emaTrend=+1`): look for `localTrend=-1` (local dip = buy the dip)
- When macro is bear (`emaTrend=-1`): look for `localTrend=+1` (local bounce = sell the bounce)

The exhaustion filter (`balance_delta`) prevents entering when the local counter-move has already stalled.

**Outputs contract:**

| Plot name     | Type | Description |
|---------------|------|-------------|
| `Trend`       | int  | 1 = local highs pressure, −1 = local lows pressure, 0 = neutral/exhausted |
| `Balance`     | int  | totalHighs − totalLows raw score |
| `BalanceDelta`| int  | balance change over last deltaLookback bars |
| `TrendRaw`    | int  | trend before exhaustion filter |

---

## Entry Signal

**Goal:** find high-probability entry moments within the confirmed context.

- Must fire frequently — this is the spam layer
- `signal_valid_bars` should cover the full trade window (trade_minutes / bar_minutes)
- SL, TP, and EstimatedTime are hardcoded in Pine and read directly by the strategy
- No SL/TP math in JS — Pine owns that

**Current implementation:** `signal_strategy_15m.pine` on 15m bars

**Outputs contract:**

| Plot name      | Type  | Description                          |
|----------------|-------|--------------------------------------|
| `Signal`       | int   | 1 = long, −1 = short, 0 = no signal  |
| `Close`        | float | entry price                          |
| `StopLoss`     | float | hardcoded SL price                   |
| `TakeProfit`   | float | hardcoded TP price                   |
| `EstimatedTime`| int   | minutes for the trade window         |

---

## outputNode Filter Logic

```ts
// Skip flat market — GARCH says not enough movement to cover TP+fees
if (volume.movePercent < 1) return null;

if (signal.position === 0) return null;

// 3-node filter: buy the dip / sell the bounce
// Long:  macro bull + local dip + signal up
// Short: macro bear + local bounce + signal down
if (isLong  && !(emaSlope.trend === 1  && localDirection.trend === -1)) return null;
if (isShort && !(emaSlope.trend === -1 && localDirection.trend === 1))  return null;
```

No additional filters in JS. If more filtering is needed — add it to Pine.

---

## Why Inverted Local Direction

Classical trend-following: enter when trend confirms signal direction.
This fails because: by the time both trend and signal agree, the move is half over.

Buy-the-dip approach: enter when macro is bullish BUT local pressure is temporarily bearish.
- EMA slope rising = macro bull context
- Local lows pressure (extreme_direction=-1) = pullback in progress
- EMA crossover on 15m = pullback ending, momentum reversing

Feb 2024 validation: this combination identified 1 clean TP at 43k (start of bull run).
It correctly blocked all 3 SL trades at 62k (end of rally, EMA slope was negative).

---

## Timeframe Pairing

| Trade window | Macro context TF | Local moment TF | Entry signal TF |
|---|---|---|---|
| 4h | 5m (EMA50 = 4h memory) | 5m (period3=24 = 2h) | 15m |
| 1h | 1m (EMA50 = ~1h memory) | 1m (period3=12 = 1h) | 5m |
| 24h | 15m (EMA50 = ~12h memory) | 15m (period3=48 = 12h) | 1h |

Rule for macro context: `ema_len × bar_minutes ≈ trade window`.
Rule for local moment: `period3 × bar_minutes ≈ trade window / 2`.
