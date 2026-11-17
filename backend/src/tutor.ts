import type { LanguageModel } from "./llm/language-model";
import { TUTOR_SYSTEM } from "./prompts";
import type { Tutor } from "./session";

export function createTutor(model: LanguageModel): Tutor {
  return {
    reply: (history, onText, signal) => model.stream({ system: TUTOR_SYSTEM, messages: history, onText, signal }),
  };
}
