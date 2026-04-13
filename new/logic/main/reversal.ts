import { json } from "agent-swarm-kit";
import { OutlineName } from "../enum/OutlineName";
import { ReversalResponseContract } from "../contract/ReversalResponse.contract";
import { HourlyResearchResponseContract } from "../contract/HourlyResearchResponse.contract";

const checkReversal = async (
  research: HourlyResearchResponseContract,
  symbol: string,
  when: Date,
) => {
  const response = await json<ReversalResponseContract>(
    OutlineName.ReversalOutline,
    research,
    symbol,
    when,
  );
  if (!response.data) {
    throw new Error("ReversalOutline failed");
  }
  return { id: response.resultId, ...response.data };
};

export { checkReversal };
