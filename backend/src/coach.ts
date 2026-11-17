import type { LanguageModel } from "./llm/language-model";
import { COACH_SYSTEM } from "./prompts";
import { CardSchema, type Card } from "./protocol";
import type { Coach } from "./session";

export function createCoach(model: LanguageModel): Coach {
  return {
    async card({ utterance, previousBotLine, lowWords }) {
      const lowList = lowWords.length
        ? lowWords.map((entry) => `${entry.word} (${Math.round(entry.accuracy)}/100)`).join(", ")
        : "none";
      const user = [
        previousBotLine ? `The conversation partner had just said: "${previousBotLine}"` : "",
        `The learner said: "${utterance}"`,
        `Words the pronunciation scorer rated low: ${lowList}`,
      ]
        .filter(Boolean)
        .join("\n");
      const card = await model.json({ system: COACH_SYSTEM, user, schema: CardSchema });
      return limitCard(card);
    },
  };
}

/** The schema cannot cap list length, so the two-note limit is enforced here. */
export function limitCard(card: Card): Card {
  return { ...card, structure_notes: card.structure_notes.slice(0, 2) };
}
