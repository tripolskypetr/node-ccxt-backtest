import { addExchangeSchema } from "backtest-kit";
import { markdown, File } from "@backtest-kit/pinets";
import { randomString, singleshot } from "functools-kit";
import ccxt from "ccxt";

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

const SIGNAL_ID = randomString();

const SIGNAL_SCHEMA = {
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

const md = await markdown(
  SIGNAL_ID,
  File.fromPath("timeframe_15m.pine"),
  {
    symbol: "BTCUSDT",
    timeframe: "15m",
    limit: 60,
  },
  SIGNAL_SCHEMA,
  "binance_exchange",
  new Date("2025-09-23T16:00:00.000Z"),
);

console.log(md);
