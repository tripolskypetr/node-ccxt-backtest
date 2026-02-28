import { extract, run, File } from "@backtest-kit/pinets";
import {
  addExchangeSchema,
  addFrameSchema,
  addRiskSchema,
  addStrategySchema,
  Cache,
  getCandles,
} from "backtest-kit";
import { randomString, singleshot } from "functools-kit";
import { sourceNode, outputNode, resolve } from "@backtest-kit/graph";
import ccxt from "ccxt";
import { predict, predictRange } from "garch";

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

const directionTimeframe = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(
        File.fromPath("extreme_direction_5m.pine", "../math"),
        {
          symbol,
          timeframe: "5m",
          limit: 100,
        },
      );
      return extract(plots, {
        trend: "Trend",
        balance: "Balance",
      });
    },
    { interval: "5m", key: ([symbol]) => symbol },
  ),
);

const signalTimeframe = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(
        File.fromPath("signal_strategy_15m.pine", "../math"),
        {
          symbol,
          timeframe: "15m",
          limit: 100,
        },
      );
      return extract(plots, {
        position: "Signal",
        priceOpen: "Close",
        priceStopLoss: "StopLoss",
        priceTakeProfit: "TakeProfit",
        minuteEstimatedTime: "EstimatedTime",
      });
    },
    { interval: "15m", key: ([symbol]) => symbol },
  ),
);

const volumeTimeframe = sourceNode(
  Cache.fn(
    async (symbol) => {
        const candles = await getCandles(symbol, "15m", 1_000);
        return predictRange(candles, '15m', 32);
    },
    { interval: "5m", key: ([symbol]) => symbol },
  ),
);

const strategySignal = outputNode(
  async ([direction, signal, volume]) => {

    if (volume.movePercent < 1) {
        return null;
    } 

    if (signal.position === 0) return null;
    if (direction.trend === -1 && signal.position === 1) return null;
    if (direction.trend === 1 && signal.position === -1) return null;

    const isLong = signal.position === 1;

    return {
      id: randomString(),
      position: isLong ? "long" : "short",
      priceTakeProfit: signal.priceTakeProfit,
      priceStopLoss: signal.priceStopLoss,
      minuteEstimatedTime: signal.minuteEstimatedTime,
    } as const;
  },
  directionTimeframe,
  signalTimeframe,
  volumeTimeframe,
);

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
        throw new Error("Short position is not allowed in for this month");
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
