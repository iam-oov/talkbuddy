import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { COACH_SYSTEM } from "./prompts";
import { CardSchema, type Card } from "./protocol";
import type { Coach } from "./session";
import { FALLBACK_BETA } from "./tutor";

/** Silent correction card: runs in parallel with the spoken reply and never delays it. */
export function createCoach(client: Anthropic, model: string): Coach {
  return {
    async card({ utterance, previousBotLine, lowWords }) {
      const lowList = lowWords.length
        ? lowWords.map((entry) => `${entry.word} (${Math.round(entry.accuracy)}/100)`).join(", ")
        : "none";
      const message = await client.beta.messages.parse({
        model,
        max_tokens: 8000,
        system: [{ type: "text", text: COACH_SYSTEM, cache_control: { type: "ephemeral" } }],
        messages: [
          {
            role: "user",
            content: [
              previousBotLine ? `The conversation partner had just said: "${previousBotLine}"` : "",
              `The learner said: "${utterance}"`,
              `Words the pronunciation scorer rated low: ${lowList}`,
            ]
              .filter(Boolean)
              .join("\n"),
          },
        ],
        output_config: { effort: "low", format: betaZodOutputFormat(CardSchema) },
        betas: [FALLBACK_BETA],
        fallbacks: "default",
      });
      if (message.stop_reason === "refusal" || !message.parsed_output) {
        throw new Error(`no card (stop_reason: ${message.stop_reason})`);
      }
      return limitCard(message.parsed_output);
    },
  };
}

/** The schema cannot cap list length, so the two-note limit is enforced here. */
export function limitCard(card: Card): Card {
  return { ...card, structure_notes: card.structure_notes.slice(0, 2) };
}
