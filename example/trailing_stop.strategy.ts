import { extract, run, File } from "@backtest-kit/pinets";
import {
  addStrategySchema,
  Cache,
} from "backtest-kit";
import { randomString } from "functools-kit";
import { sourceNode, outputNode, resolve } from "@backtest-kit/graph";

const directionTimeframe = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(
        File.fromPath("extreme_direction_1m.pine", "../math"),
        {
          symbol,
          timeframe: "1m",
          limit: 240,
        },
      );
      return extract(plots, {
        trend: "Trend",
      });
    },
    { interval: "1m", key: ([symbol]) => symbol },
  ),
);

const goldenCrossTimeframe = sourceNode(
  Cache.fn(
    async (symbol) => {
      const plots = await run(File.fromPath("ema_golden_cross_15m.pine", "../math"), {
        symbol,
        timeframe: "15m",
        limit: 100,
      });
      return extract(plots, {
        position: "Signal",
        priceOpen: "Close",
      });
    },
    { interval: "15m", key: ([symbol]) => symbol },
  ),
);

const strategySignal = outputNode(
  async ([direction, goldenCross]) => {
    if (goldenCross.position === 0) return null;
    if (direction.trend === -1 && goldenCross.position === 1) return null;
    if (direction.trend === 1 && goldenCross.position === -1) return null;

    const isLong = goldenCross.position === 1;

    return {
      id: randomString(),
      position: isLong ? "long" : "short",
      priceTakeProfit: isLong ? goldenCross.priceOpen * 1.01 : goldenCross.priceOpen * 0.99,
      priceStopLoss: isLong ? goldenCross.priceOpen * 0.99 : goldenCross.priceOpen * 1.01,
      minuteEstimatedTime: 240,
    } as const;
  },
  directionTimeframe,
  goldenCrossTimeframe,
);

addStrategySchema({
  strategyName: "trailing_stop_strategy",
  interval: "15m",
  getSignal: () => resolve(strategySignal),
});
