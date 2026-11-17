import { z } from "zod";
import type { ChatMessage, LanguageModel } from "./language-model";

const BASE_URL = "https://api.deepseek.com";
const STREAM_MAX_TOKENS = 1000;
const JSON_MAX_TOKENS = 2000;

interface ChunkChoice {
  delta?: { content?: string | null };
  finish_reason?: string | null;
}

export function createDeepSeekModel(apiKey: string, model: string, fetchImpl: typeof fetch = fetch): LanguageModel {
  const complete = async (body: Record<string, unknown>, signal?: AbortSignal) => {
    const response = await fetchImpl(`${BASE_URL}/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model, thinking: { type: "disabled" }, ...body }),
      signal,
    });
    if (!response.ok) throw new Error(`DeepSeek ${response.status}: ${await response.text()}`);
    return response;
  };

  const withSystem = (system: string, messages: ChatMessage[]) => [{ role: "system", content: system }, ...messages];

  return {
    async stream({ system, messages, onText, signal }) {
      const response = await complete(
        { stream: true, max_tokens: STREAM_MAX_TOKENS, messages: withSystem(system, messages) },
        signal,
      );
      let text = "";
      let finishReason: string | null = null;
      for await (const chunk of readServerSentEvents(response.body!)) {
        const choice = (chunk as { choices?: ChunkChoice[] }).choices?.[0];
        const delta = choice?.delta?.content;
        if (delta) {
          text += delta;
          onText(delta);
        }
        if (choice?.finish_reason) finishReason = choice.finish_reason;
      }
      return { text, refused: finishReason === "content_filter" };
    },

    async json({ system, user, schema }) {
      const schemaHint = `Reply with one JSON object that follows this JSON schema:\n${JSON.stringify(z.toJSONSchema(schema))}`;
      const response = await complete({
        response_format: { type: "json_object" },
        max_tokens: JSON_MAX_TOKENS,
        messages: withSystem(`${system}\n\n${schemaHint}`, [{ role: "user", content: user }]),
      });
      const body = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
      const content = body.choices?.[0]?.message?.content?.trim();
      if (!content) throw new Error("DeepSeek returned empty JSON content");
      return schema.parse(JSON.parse(content));
    },
  };
}

export async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<unknown> {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const bytes of body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice("data:".length).trim();
      if (data === "[DONE]") return;
      yield JSON.parse(data);
    }
  }
}
