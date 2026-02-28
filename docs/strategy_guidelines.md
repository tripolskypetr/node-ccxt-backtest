# Strategy Design Guidelines

## Two-Indicator Architecture

Every strategy uses exactly two Pine Script indicators:

1. **Trend filter** — runs on a slower timeframe, answers "is the market moving in my direction right now?"
2. **Entry signal** — runs on a faster timeframe, answers "is this a good moment to enter?"

The entry signal spams candidates. The trend filter kills the ones that go against the current direction.

---

## Trend Filter

**Goal:** detect the direction of market pressure over the last ~2× the trade window.

- If the trade window is 4h, the trend filter looks back ~2–8h
- Must flip fast enough to be relevant — if it never flips within the trade window, it's useless
- Must be stable enough to not flip *during* a single trade
- Target: 1 flip per 1–2× trade window length

**Current implementation:** `extreme_direction_5m.pine` on 5m bars

Detects whether price has been making more highs or more lows across multiple lookback windows. The `balance` output (totalHighs − totalLows) shows pressure direction. `trend` is the hysteresis-gated signal (+1/−1/0).

Key rule: trend filter lives in `directionTimeframe` sourceNode with `interval` matching the pine timeframe.

---

## Entry Signal

**Goal:** find high-probability entry moments within the trend direction.

- Must fire frequently — this is the spam layer
- `signal_valid_bars` should cover the full trade window (trade_minutes / bar_minutes)
- SL, TP, and EstimatedTime are hardcoded in Pine and read directly by the strategy
- No SL/TP math in JS — Pine owns that

**Good entry conditions (from TEMPLATE):**
- EMA crossover (fast/slow) as the trigger
- RSI in non-extreme zone (not overbought for long, not oversold for short)
- Volume spike (volume > MA × 1.5) — confirms real interest
- Momentum confirmation (mom > 0 for long, mom < 0 for short)
- Internal EMA trend filter (close > ema_trend for long) as secondary check

**Current implementation:** `signal_strategy_15m.pine` on 15m bars

Key rule: entry signal lives in a separate sourceNode with its own `interval`. SL/TP/EstimatedTime are plot outputs read via `extract`.

---

## Outputs Contract

Pine must export these named plots for the entry indicator:

| Plot name      | Type  | Description                        |
|----------------|-------|------------------------------------|
| `Signal`       | int   | 1 = long, −1 = short, 0 = no signal |
| `Close`        | float | entry price                        |
| `StopLoss`     | float | hardcoded SL price                 |
| `TakeProfit`   | float | hardcoded TP price                 |
| `EstimatedTime`| int   | minutes for the trade window       |

Pine must export these for the trend indicator:

| Plot name | Type | Description              |
|-----------|------|--------------------------|
| `Trend`   | int  | 1 = bull, −1 = bear, 0 = neutral |
| `Balance` | int  | raw pressure score       |

---

## outputNode Filter Logic

```ts
if (goldenCross.position === 0) return null;                              // no entry signal
if (direction.trend === -1 && goldenCross.position === 1) return null;   // long against bear trend
if (direction.trend === 1  && goldenCross.position === -1) return null;  // short against bull trend
```

No additional filters in JS. If more filtering is needed — add it to Pine.

---

## Timeframe Pairing

| Trade window | Trend filter TF | Entry signal TF |
|---|---|---|
| 4h | 5m (looks back 2h with period3=24) | 15m |
| 1h | 1m (looks back 30min) | 5m |
| 24h | 15m (looks back 8h) | 1h |

Rule: trend TF × period3 ≈ trade window / 2.
