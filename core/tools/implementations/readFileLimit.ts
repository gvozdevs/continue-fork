import { ILLM } from "../..";
import { countTokensAsync } from "../../llm/countTokens";
import { ContinueError, ContinueErrorReason } from "../../util/errors";
import { readFileTokenLimit } from "../readFileMaxTokens";

export async function throwIfFileExceedsHalfOfContext(
  filepath: string,
  content: string,
  model: ILLM | null,
  configuredMaxTokens?: number,
) {
  const tokenLimit = readFileTokenLimit(model, configuredMaxTokens);
  if (model && tokenLimit !== undefined) {
    const tokens = await countTokensAsync(content, model.title);
    if (tokens > tokenLimit) {
      throw new ContinueError(
        ContinueErrorReason.FileTooLarge,
        `File ${filepath} is too large (${tokens} tokens vs ${tokenLimit} token limit). Try another approach`,
      );
    }
  }
}
