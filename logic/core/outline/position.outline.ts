import {
  addOutline,
  ask,
  dumpOutlineResult,
  IOutlineHistory,
  IOutlineResult,
} from "agent-swarm-kit";
import { str } from "functools-kit";
import {
  commitLongTermMath,
  commitHourHistory,
  commitBookDataReport,
} from "@backtest-kit/signals";
import { OutlineName } from "../../enum/OutlineName";
import { CompletionName } from "../../enum/CompletionName";
import { ResearchResponseContract } from "../../contract/ResearchResponse.contract";
import dayjs from "dayjs";
import { PositionResponseContract } from "../../contract/PositionResponse.contract";

const DISPLAY_NAME_MAP = {
  BTCUSDT: "Bitcoin",
  ETHUSDT: "Ethereum",
  BNBUSDT: "Binance Coin (BNB)",
  XRPUSDT: "Ripple",
  SOLUSDT: "Solana",
};

const POSITION_PROMPT = str.newline(
  "Ты — трейдер, который принимает решение о точке входа в позицию.",
  "Направление уже определено фундаментальным анализом. Твоя задача — оценить текущую техническую картину и решить: входить прямо сейчас или ждать лучшей цены.",
  "",
  "**Как думать:**",
  " - Смотри на стакан: есть ли рядом крупные уровни поддержки/сопротивления, насколько сбалансирован bid/ask.",
  " - Смотри на последние свечи: есть ли импульс в нужную сторону, или цена в нерешительности.",
  " - Смотри на технические индикаторы: подтверждают ли RSI, MACD, ADX движение в направлении сигнала.",
  " - Учитывай уровни Фибоначчи: находится ли цена у значимого уровня, от которого разумно входить.",
  " - Стоп и тейк фиксированные (2% и 1%) — оценивай только качество точки входа, а не размер движения.",
  " - Если цена уже далеко ушла от хорошей точки входа — лучше подождать отката.",
  " - Если картина размытая или стакан неглубокий — выбирай WAIT.",
  "",
  "**Определения действий (выбери ровно одно):**",
  " - **OPEN**: Входить сейчас. Текущая цена — разумная точка входа с учётом технической картины.",
  " - **WAIT**: Не входить. Цена неудобная, импульс слабый или стакан не поддерживает вход.",
  "",
  "**Параметры риска (минимальные значения):**",
  " - Risk/Reward: минимум 1:2",
  " - Stop-Loss: не более 2% от цены входа",
  " - Take-Profit: не менее 1% от цены входа",
  " - Для LONG:  SL ≤ open_price × 0.98,  TP ≥ open_price × 1.01",
  " - Для SHORT: SL ≤ open_price × 1.02,  TP ≥ open_price × 0.99",
  " - Можно ставить лучше (уже стоп, дальше тейк) если техническая картина позволяет.",
  "",
  "**Требуемый результат:**",
  "1. **action**: OPEN или WAIT.",
  "2. **open_price**: цена входа (текущая рыночная цена по стакану).",
  "3. **stop_loss_price**: рассчитать по формуле выше.",
  "4. **take_profit_price**: рассчитать по формуле выше.",
  "5. **reasoning**: кратко объясни почему именно сейчас входить (или почему WAIT).",
  "",
  "При action=WAIT укажи open_price как текущую цену по стакану, stop_loss_price и take_profit_price выставь в 0.",
);

const commitFundamentalResearch = async (
  research: ResearchResponseContract,
  history: IOutlineHistory,
) => {
  await history.push(
    {
      role: "user",
      content: str.newline(
        "Прочитай фундаментальный анализ рынка от профессионального трейдера и скажи ОК",
        "",
        JSON.stringify(research, null, 2),
      ),
    },
    {
      role: "assistant",
      content: "ОК",
    },
  );
};

addOutline<PositionResponseContract>({
  outlineName: OutlineName.PositionOutline,
  completion: CompletionName.OllamaOutlineToolCompletion,
  format: {
    type: "object",
    properties: {
      action: {
        type: "string",
        description: "Решение о входе: OPEN — войти сейчас, WAIT — ждать лучшей точки.",
        enum: ["OPEN", "WAIT"],
      },
      open_price: {
        type: "number",
        description: "Цена входа в позицию (текущая рыночная цена по стакану).",
      },
      stop_loss_price: {
        type: "number",
        description: "Уровень стоп-лосса. При action=WAIT указать 0.",
      },
      take_profit_price: {
        type: "number",
        description: "Уровень тейк-профита. При action=WAIT указать 0.",
      },
      reasoning: {
        type: "string",
        description: "Обоснование точки входа, стопа и тейка на основе технического анализа.",
      },
    },
    required: ["action", "open_price", "stop_loss_price", "take_profit_price", "reasoning"],
  },
  getOutlineHistory: async (
    { history },
    research: ResearchResponseContract,
    symbol: string,
    when: Date,
  ) => {
    const displayName = Reflect.get(DISPLAY_NAME_MAP, symbol) || symbol;
    await history.push({
      role: "system",
      content: str.newline(
        `Текущая дата и время: ${dayjs(when).format("DD MMMM YYYY HH:mm")}`,
        `Выбранный актив: ${displayName}`,
        `Будет открыта позиция: ${research.signal === "BUY" ? "LONG" : research.signal === "SELL" ? "SHORT" : "-"}`,
      ),
    });
    {
      await commitFundamentalResearch(research, history);
      await commitLongTermMath(symbol, history);
      await commitHourHistory(symbol, history);
      await commitBookDataReport(symbol, history);
    }
    await history.push({
      role: "user",
      content: POSITION_PROMPT,
    });
  },
  validations: [
    {
      validate: ({ data }) => {
        if (!data.action) {
          throw new Error("Поле action не заполнено");
        }
      },
      docDescription: "Проверяет, что сигнал (BUY/SELL/WAIT) определён.",
    },
    {
      validate: ({ data }) => {
        if (!data.reasoning) {
          throw new Error("Поле reasoning не заполнено");
        }
      },
      docDescription: "Проверяет, что сигнал сгенерирован с рассуждением",
    },
    {
      validate: ({ data }) => {
        if (data.action === "OPEN") {
          return;
        }
        if (data.action === "WAIT") {
          return;
        }
        throw new Error("Поле action должно быть OPEN или WAIT");
      },
      docDescription: "Проверяет, что action содержит допустимое значение.",
    },
    {
      validate: ({ data }) => {
        if (!data.open_price || data.open_price <= 0) {
          throw new Error("Поле open_price должно содержать положительную цену");
        }
      },
      docDescription: "Проверяет, что цена входа указана и положительна.",
    },
    {
      validate: ({ data }) => {
        if (data.action === "OPEN" && (!data.stop_loss_price || data.stop_loss_price <= 0)) {
          throw new Error("При action=OPEN поле stop_loss_price обязательно и должно быть положительным");
        }
      },
      docDescription: "Проверяет, что стоп-лосс указан при открытии позиции.",
    },
    {
      validate: ({ data }) => {
        if (data.action === "OPEN" && (!data.take_profit_price || data.take_profit_price <= 0)) {
          throw new Error("При action=OPEN поле take_profit_price обязательно и должно быть положительным");
        }
      },
      docDescription: "Проверяет, что тейк-профит указан при открытии позиции.",
    },
  ],
  callbacks: {
    async onValidDocument(result: IOutlineResult<ResearchResponseContract>) {
      await dumpOutlineResult(result, "./dump/outline/position");
    },
  },
});
