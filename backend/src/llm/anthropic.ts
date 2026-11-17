import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { LanguageModel } from "./language-model";

const FALLBACK_BETA = "server-side-fallback-2026-07-01";
const MAX_TOKENS = 8000;

export function createAnthropicModel(client: Anthropic, model: string): LanguageModel {
  const cachedSystem = (text: string) => [{ type: "text" as const, text, cache_control: { type: "ephemeral" as const } }];

  return {
    async stream({ system, messages, onText, signal }) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: MAX_TOKENS,
          system: cachedSystem(system),
          messages,
          output_config: { effort: "low" },
          betas: [FALLBACK_BETA],
          fallbacks: "default",
        },
        { signal },
      );
      stream.on("text", onText);
      const message = await stream.finalMessage();
      const text = message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("");
      return { text, refused: message.stop_reason === "refusal" };
    },

    async json({ system, user, schema }) {
      const message = await client.beta.messages.parse({
        model,
        max_tokens: MAX_TOKENS,
        system: cachedSystem(system),
        messages: [{ role: "user", content: user }],
        output_config: { effort: "low", format: betaZodOutputFormat(schema) },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });
      if (message.stop_reason === "refusal" || message.parsed_output == null) {
        throw new Error(`no structured output (stop_reason: ${message.stop_reason})`);
      }
      return message.parsed_output;
    },
  };
}
