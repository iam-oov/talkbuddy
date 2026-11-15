import Anthropic from "@anthropic-ai/sdk";
import { TUTOR_SYSTEM } from "./prompts";
import type { Tutor } from "./session";

export const FALLBACK_BETA = "server-side-fallback-2026-07-01";

/** Spoken reply: streamed so the phone can start talking at the first sentence. */
export function createTutor(client: Anthropic, model: string): Tutor {
  return {
    async reply(history, onText, signal) {
      const stream = client.beta.messages.stream(
        {
          model,
          max_tokens: 8000,
          system: [{ type: "text", text: TUTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
          messages: history,
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
  };
}
