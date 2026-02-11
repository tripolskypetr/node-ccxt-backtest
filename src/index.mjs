import {
  addExchangeSchema,
  addRiskSchema,
  addFrameSchema,
  addStrategySchema,
  Cache,
  Constant,
  commitPartialProfit,
  addActionSchema,
} from "backtest-kit";

import { extract, run, toSignalDto, File } from "@backtest-kit/pinets";

import { singleshot, str, randomString } from "functools-kit";
import { generateText, Output } from "ai";
import { createGroq } from "@ai-sdk/groq";
import { z } from "zod";
import ccxt from "ccxt";

const groq = createGroq({
  apiKey: process.env.CC_GROQ_API_KEY,
});

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

const getPlotHigher = Cache.fn(
  async (symbol) => {
    return await run(File.fromPath("timeframe_4h.pine"), {
      symbol,
      timeframe: "4h",
      limit: 100,
    });
  },
  {
    interval: "4h",
    key: ([symbol]) => `${symbol}`,
  },
);

const getDataHigher = async (symbol) => {
  const plots = await getPlotHigher(symbol);
  return extract(plots, {
    allowLong: "AllowLong",
    allowShort: "AllowShort",
    allowBoth: "AllowBoth",
    noTrades: "NoTrades",
  });
};

const getPlotLower = Cache.fn(
  async (symbol) => {
    return await run(File.fromPath("timeframe_15m.pine"), {
      symbol,
      timeframe: "15m",
      limit: 100,
    });
  },
  {
    interval: "15m",
    key: ([symbol]) => `${symbol}`,
  },
);

const getDataLower = async (symbol) => {
  const plots = await getPlotLower(symbol);
  return extract(plots, {
    position: "Signal",
    priceOpen: "Close",
    priceTakeProfit: "TakeProfit",
    priceStopLoss: "StopLoss",
    minuteEstimatedTime: "EstimatedTime",
  });
};

const getMarkdownLower = async (symbol) => {
  const plots = await getPlotLower(symbol);
  return await toMarkdown(signalId, plots, {
    position: "Signal",
    priceOpen: "Close",
    priceTakeProfit: "TakeProfit",
    priceStopLoss: "StopLoss",
    minuteEstimatedTime: "EstimatedTime",
    d_RSI: "d_RSI",
    d_EmaFast: "d_EmaFast",
    d_EmaSlow: "d_EmaSlow",
    d_EmaTrend: "d_EmaTrend",
    d_ATR: "d_ATR",
    d_Volume: "d_Volume",
    d_VolMA: "d_VolMA",
    d_VolSpike: "d_VolSpike",
    d_Mom: "d_Mom",
    d_MomUp: "d_MomUp",
    d_MomDown: "d_MomDown",
    d_TrendUp: "d_TrendUp",
    d_TrendDown: "d_TrendDown",
    d_LongCond: "d_LongCond",
    d_ShortCond: "d_ShortCond",
    d_BarsSinceSignal: "d_BarsSinceSignal",
  });
};

addExchangeSchema({
  exchangeName: "binance_exchange",
  getCandles: async (symbol, interval, since, limit) => {
    const exchange = await getExchange();
    const candles = await exchange.fetchOHLCV(
      symbol,
      interval,
      since.getTime(),
      limit,
    );
    return candles.map((row) => ({
      timestamp: row[0],
      open: row[1],
      high: row[2],
      low: row[3],
      close: row[4],
      volume: row[5],
    }));
  },
});

/*
addRiskSchema({
  riskName: "signal_confidence_risk",
  validations: [
    {
      async validate({ currentSignal }) {
        const { output } = await generateText({
          model: groq("qwen/qwen3-32b"),
          prompt: str.newline(
            "Оцени стабильность сигнала",
            "",
            await getMarkdownLower(currentSignal.symbol),
          ),
          output: Output.object({
            schema: z.object({
              recipe: z.object({
                name: z.string(),
                ingredients: z.array(
                  z.object({ name: z.string(), amount: z.string() }),
                ),
                steps: z.array(z.string()),
              }),
            }),
          }),
        });
      },
    },
  ],
});
*/

addActionSchema({
  actionName: "partial_profit_action",
  handler: class {
    async partialProfitAvailable({ symbol, level }) {
      if (level === Constant.TP_LEVEL3) {
        await commitPartialProfit(symbol, 33);
      }
      if (level === Constant.TP_LEVEL2) {
        await commitPartialProfit(symbol, 33);
      }
      if (level === Constant.TP_LEVEL1) {
        await commitPartialProfit(symbol, 34);
      }
    }
  },
});

addActionSchema({
  actionName: "breakeven_action",
  handler: class {
    async breakevenAvailable({ symbol, currentPrice }) {
      // Lower trailing-stop by 3 points (negative value brings stop-loss closer to entry)
      await commitTrailingStop(symbol, -3, currentPrice);
    }
  }
});

addStrategySchema({
  strategyName: "main_strategy",
  interval: "5m",
  getSignal: async (symbol) => {
    const signalId = randomString();

    const data_higher = await getDataHigher(symbol);

    if (data_higher.noTrades) {
      return null;
    }

    const data_lower = await getDataLower(symbol);

    if (data_lower.position === 0) {
      return null;
    }

    if (data_higher.allowShort && data_lower.position === 1) {
      return null;
    }

    if (data_higher.allowLong && data_lower.position === -1) {
      return null;
    }

    return await toSignalDto(signalId, data_lower, null);
  },
  riskList: [
    // "signal_confidence_risk"
  ],
  actions: [
    "partial_profit_action",
    "breakeven_action",
  ]
});

addFrameSchema({
  frameName: "backtest_frame",
  interval: "1m",
  startDate: new Date("2025-10-01T00:00:00Z"),
  endDate: new Date("2025-10-31T23:59:59Z"),
});
