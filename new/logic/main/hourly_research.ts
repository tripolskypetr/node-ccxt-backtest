import { json } from "agent-swarm-kit";
import { OutlineName } from "../enum/OutlineName";
import { HourlyResearchResponseContract } from "../contract/HourlyResearchResponse.contract";

const hourlyResearch = async (symbol: string, when: Date) => {
  const response = await json<HourlyResearchResponseContract>(
    OutlineName.HourlyResearchOutline,
    symbol,
    when,
  );
  if (!response.data) {
    throw new Error("HourlyResearch failed");
  }
  return { id: response.resultId, ...response.data };
};

export { hourlyResearch };
