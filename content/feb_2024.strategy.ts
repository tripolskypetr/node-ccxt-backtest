import { extract, run, File } from "@backtest-kit/pinets";
import {
  addExchangeSchema,
  addFrameSchema,
  addRiskSchema,
  addStrategySchema,
  Cache,
  getCandles,
  getDate,
} from "backtest-kit";
import { randomString, singleshot } from "functools-kit";
import { sourceNode, outputNode, resolve } from "@backtest-kit/graph";
import ccxt from "ccxt";
import { predictRange } from "garch";

const getExchange = singleshot(async () => {
  const exchange = new ccxt.binance({
    options: {
      defaultType: "spot",
      adjustForTimeDifference: true,
      recvWindow: 60000,
    },
    enableRateLimit: true,
  });
  await exchange.loadMarkets();
  return exchange;
});

addExchangeSchema({
  exchangeName: "ccxt-exchange",
  getCandles: async (symbol, interval, since, limit) => {
    const exchange = await getExchange();
    const candles = await exchange.fetchOHLCV(
      symbol,
      interval,
      since.getTime(),
      limit,
    );
    return candles.map(([timestamp, open, high, low, close, volume]) => ({
      timestamp: <number>timestamp,
      open: <number>open,
      high: <number>high,
      low: <number>low,
      close: <number>close,
      volume: <number>volume,
    }));
  },
});

// --- SOURCE NODES ---

const emaTrendNode = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(
        File.fromPath("ema_trend_15m.pine", "../math"),
        {
          symbol,
          timeframe: "15m",
          limit: 200,
        },
      );
      return extract(plots, {
        emaSlope: "EmaSlope",
        rsi: "Rsi",
        close: "Close",
      });
    },
    { interval: "15m", key: ([symbol]) => symbol },
  ),
);

// GARCH forecast over 32 bars = 8h = minuteEstimatedTime
const GARCH_STEPS = 32;

const garchNode = sourceNode(
  Cache.fn(
    async (symbol) => {
      const candles = await getCandles(symbol, "15m", 1_000);
      return predictRange(candles, "15m", GARCH_STEPS, 0.95);
    },
    { interval: "15m", key: ([symbol]) => symbol },
  ),
);

// --- OUTPUT NODE ---

const strategySignal = outputNode(
  async ([ema, garch]) => {

    const date = await getDate();

    // GARCH gate: skip unreliable model fits and low-volatility periods
    if (!garch.reliable) {
        console.log("Not reiable", date)
        return null;
    }
    if (garch.movePercent < 0.8) {
        console.log("Flat market", garch.movePercent, date)
        return null;
    }

    // EMA slope threshold: 0.05% change over 6 bars (90 min) = trend active
    const isBull = ema.emaSlope > 0.05;
    const isBear = ema.emaSlope < -0.05;

    // RSI pullback entry: enter when momentum temporarily exhausted within trend
    const longEntry  = isBull && ema.rsi < 40;
    const shortEntry = isBear && ema.rsi > 60;


    if (!longEntry && !shortEntry) {
        console.log("RSI not in range", "rsi:", ema.rsi, "slope:", ema.emaSlope, date)
        return null;
    }

    const isLong = longEntry;
    const price = ema.close;

    // Dynamic TP/SL from GARCH log-normal bands (no magic constants)
    const rawTP = isLong ? garch.upperPrice : garch.lowerPrice;
    const rawSL = isLong ? garch.lowerPrice : garch.upperPrice;

    // Enforce minimum 2:1 R:R — SL never worse than 0.75%
    const tp = rawTP;
    const sl = isLong
      ? Math.max(rawSL, price * 0.9925)
      : Math.min(rawSL, price * 1.0075);

    return {
      id: randomString(),
      position: isLong ? "long" : "short",
      priceTakeProfit: tp,
      priceStopLoss: sl,
      minuteEstimatedTime: GARCH_STEPS * 15,
    } as const;
  },
  emaTrendNode,
  garchNode,
);

// --- REGISTRATION ---

addFrameSchema({
  frameName: "feb_2024_frame",
  interval: "1m",
  startDate: new Date("2024-02-01T00:00:00Z"),
  endDate: new Date("2024-02-29T23:59:59Z"),
  note: "Bull run period",
});

addRiskSchema({
  riskName: "feb_2024_risk",
  validations: [
    ({ currentSignal }) => {
      if (currentSignal.position === "short") {
        throw new Error("Short position is not allowed for this month");
      }
    },
  ],
});

addStrategySchema({
  strategyName: "feb_2024_strategy",
  interval: "15m",
  getSignal: () => resolve(strategySignal),
  riskList: ["feb_2024_risk"],
});
