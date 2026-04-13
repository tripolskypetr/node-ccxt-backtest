import { json } from "agent-swarm-kit";
import { OutlineName } from "../enum/OutlineName";
import { EntryResponseContract } from "../contract/EntryResponse.contract";
import { HourlyResearchResponseContract } from "../contract/HourlyResearchResponse.contract";

const checkEntry = async (
  research: HourlyResearchResponseContract,
  symbol: string,
  when: Date,
) => {
  const response = await json<EntryResponseContract>(
    OutlineName.EntryOutline,
    research,
    symbol,
    when,
  );
  if (!response.data) {
    throw new Error("EntryOutline failed");
  }
  return { id: response.resultId, ...response.data };
};

export { checkEntry };
