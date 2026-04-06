import {
  addOutline,
  commitAssistantMessage,
  commitUserMessage,
  dumpOutlineResult,
  execute,
  fork,
  IOutlineHistory,
  IOutlineResult,
} from "agent-swarm-kit";
import { str } from "functools-kit";
import { OutlineName } from "../../enum/OutlineName";
import { CompletionName } from "../../enum/CompletionName";
import { SwarmName } from "../../enum/SwarmName";
import { SignalResponseContract } from "../../contract/SignalResponse.contract";
import dayjs from "dayjs";

const DISPLAY_NAME_MAP = {
  BTCUSDT: "Bitcoin",
  ETHUSDT: "Ethereum",
  BNBUSDT: "Binance Coin (BNB)",
  XRPUSDT: "Ripple",
  SOLUSDT: "Solana",
};

const SEARCH_PROMPT = str.newline(
  "Ты ищешь краткосрочные сигналы разворота — события и данные последних часов, которые могут изменить направление цены прямо сейчас.",
  "",
  "Акцент на негативных сигналах — они надёжнее: позитивные новости часто SEO-маркетинг, негативные сложнее подделать.",
  "",
  "Ищи по следующим запросам (подставь актив и дату):",
  " - {asset} liquidation cascade {date}",
  " - {asset} large sell order whale dump {date}",
  " - {asset} exchange inflow spike {date}",
  " - {asset} flash crash risk {date}",
  " - {asset} funding rate negative {date}",
  " - {asset} open interest drop {date}",
  " - {asset} stop hunt below support {date}",
  " - {asset} fear greed index drop {date}",
  " - {asset} hack exploit rumor {date}",
  " - {asset} regulatory action ban {date}",
  "",
  "Также ищи контрарианские сигналы разворота вверх:",
  " - {asset} short squeeze {date}",
  " - {asset} oversold bounce {date}",
  " - {asset} buy the dip institutional {date}",
  "",
  "Правила:",
  " * Только события последних 4–12 часов — никакой инертной аналитики за неделю",
  " * Если дату источника нельзя определить явно — не использовать",
  " * Не копировать мнение одной статьи — искать подтверждение из нескольких источников",
  " * Пиши только то, что нашёл, без домыслов",
);

const SIGNAL_PROMPT = str.newline(
  "Ты — трейдер, который принимает решение о направлении сделки прямо сейчас на основе свежих рыночных событий.",
  "",
  "Ты прочитал отчёт о краткосрочных сигналах. Твоя задача — выдать один сигнал на ближайшие часы.",
  "",
  "**Как думать:**",
  " - Краткосрочные события весомее инертной аналитики: ликвидация, крупный перевод на биржу, резкий рост funding rate — это факты, а не прогнозы",
  " - Отсутствие негативных сигналов — уже информация: если ничего тревожного не происходит, рынок, вероятно, продолжит текущий тренд",
  " - Если нашлось только маркетинговое позитивное — игнорируй, это шум",
  " - Если картина противоречивая или данных мало — выбирай WAIT",
  "",
  "**Определения сигналов (выбери ровно один):**",
  " - **BUY**:  Краткосрочные данные указывают на рост в ближайшие часы",
  " - **SELL**: Краткосрочные данные указывают на падение в ближайшие часы",
  " - **WAIT**: Данных недостаточно или картина размытая — не входить",
  "",
  "**Требуемый результат:**",
  "1. **signal**: BUY, SELL или WAIT.",
  "2. **reasoning**: какие конкретные события из отчёта привели к этому выводу.",
);

const commitSignalSearch = async (
  query: string,
  date: Date,
  resultId: string,
  history: IOutlineHistory,
) => {
  const report = await fork(
    async (clientId, agentName) => {
      await commitUserMessage(
        str.newline(
          "Прочитай что именно мне нужно найти и скажи ОК",
          "",
          SEARCH_PROMPT,
        ),
        "user",
        clientId,
        agentName,
      );
      await commitAssistantMessage("OK", clientId, agentName);
      const request = str.newline(
        `Найди в интернете краткосрочные сигналы для ${query}`,
        `Только события актуальные на ${dayjs(date).format("DD MMMM YYYY HH:mm")}`,
        `Сформируй отчёт о краткосрочных рисках и возможностях`,
      );
      return await execute(request, clientId, agentName);
    },
    {
      clientId: `${resultId}_signal`,
      swarmName: SwarmName.WebSearchSwarm,
      onError: (error) => console.error(`Error in SignalOutline search for ${query}:`, error),
    },
  );
  if (!report) {
    throw new Error("SignalOutline web search failed");
  }
  await history.push(
    {
      role: "user",
      content: str.newline(
        "Прочитай отчёт о краткосрочных рыночных сигналах и скажи ОК",
        "",
        report,
      ),
    },
    {
      role: "assistant",
      content: "ОК",
    },
  );
};

addOutline<SignalResponseContract>({
  outlineName: OutlineName.SignalOutline,
  completion: CompletionName.OllamaOutlineToolCompletion,
  format: {
    type: "object",
    properties: {
      signal: {
        type: "string",
        description: "Краткосрочный торговый сигнал на ближайшие часы.",
        enum: ["BUY", "SELL", "WAIT"],
      },
      reasoning: {
        type: "string",
        description: "Конкретные события из отчёта, которые обосновывают сигнал.",
      },
    },
    required: ["signal", "reasoning"],
  },
  getOutlineHistory: async ({ resultId, history }, symbol: string, when: Date) => {
    const displayName = Reflect.get(DISPLAY_NAME_MAP, symbol) || symbol;
    await history.push({
      role: "system",
      content: str.newline(
        `Текущая дата и время: ${dayjs(when).format("DD MMMM YYYY HH:mm")}`,
        `Актив: ${displayName}`,
      ),
    });
    await commitSignalSearch(displayName, when, resultId, history);
    await history.push({
      role: "user",
      content: SIGNAL_PROMPT,
    });
  },
  validations: [
    {
      validate: ({ data }) => {
        if (!data.signal) {
          throw new Error("Поле signal не заполнено");
        }
      },
      docDescription: "Проверяет, что сигнал определён.",
    },
    {
      validate: ({ data }) => {
        if (!["BUY", "SELL", "WAIT"].includes(data.signal)) {
          throw new Error("Поле signal должно быть BUY, SELL или WAIT");
        }
      },
      docDescription: "Проверяет, что signal содержит допустимое значение.",
    },
    {
      validate: ({ data }) => {
        if (!data.reasoning) {
          throw new Error("Поле reasoning не заполнено");
        }
      },
      docDescription: "Проверяет, что сигнал обоснован.",
    },
  ],
  callbacks: {
    async onValidDocument(result: IOutlineResult<SignalResponseContract>) {
      if (!result.data) {
        return;
      }
      if (result.data.signal === "WAIT") {
        return;
      }
      await dumpOutlineResult(result, "./dump/outline/signal");
    },
  },
});
