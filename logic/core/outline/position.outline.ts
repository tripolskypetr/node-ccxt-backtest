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
  "**Требуемый результат:**",
  "1. **action**: OPEN или WAIT.",
  "2. **reasoning**: кратко объясни почему именно сейчас входить (или почему WAIT).",
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
      reasoning: {
        type: "string",
        description: "Обоснование решения о входе на основе технического анализа.",
      },
    },
    required: ["action", "reasoning"],
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
  ],
  callbacks: {
    async onValidDocument(result: IOutlineResult<PositionResponseContract>) {
      if (!result.data) {
        return;
      }
      if (result.data.action === "WAIT") {
        return;
      }
      await dumpOutlineResult(result, "./dump/outline/position");
    },
  },
});
