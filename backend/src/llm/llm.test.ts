import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { createModel, listModels } from "./catalog";
import { createDeepSeekModel } from "./deepseek";

const sseBody = (events: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      const text = events.map((event) => `data: ${event}\n\n`).join("");
      const bytes = new TextEncoder().encode(text);
      controller.enqueue(bytes.slice(0, 25));
      controller.enqueue(bytes.slice(25));
      controller.close();
    },
  });

describe("model catalog", () => {
  it("marks a model available only when its API key is set", () => {
    const options = listModels({ ANTHROPIC_API_KEY: "x" });
    expect(options.map((option) => [option.id, option.available])).toEqual([
      ["claude-sonnet-5-5", true],
      ["deepseek-v4-pro", false],
    ]);
  });

  it("creates nothing for an unknown model or a missing key", () => {
    expect(createModel("deepseek-v4-pro", {})).toBeNull();
    expect(createModel("gpt-unknown", { ANTHROPIC_API_KEY: "x" })).toBeNull();
    expect(createModel("deepseek-v4-pro", { DEEPSEEK_API_KEY: "x" })).not.toBeNull();
  });
});

describe("DeepSeek adapter", () => {
  it("streams answer text and disables thinking", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        sseBody([
          JSON.stringify({ choices: [{ delta: { content: "Hi " } }] }),
          JSON.stringify({ choices: [{ delta: { content: "there!" }, finish_reason: "stop" }] }),
          "[DONE]",
        ]),
      ),
    );
    const model = createDeepSeekModel("key", "deepseek-v4-pro", fetchImpl as unknown as typeof fetch);
    const deltas: string[] = [];

    const result = await model.stream({
      system: "be brief",
      messages: [{ role: "user", content: "hello" }],
      onText: (delta) => deltas.push(delta),
      signal: new AbortController().signal,
    });

    expect(result).toEqual({ text: "Hi there!", refused: false });
    expect(deltas).toEqual(["Hi ", "there!"]);
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body).toMatchObject({ model: "deepseek-v4-pro", stream: true, thinking: { type: "disabled" } });
    expect(body.messages[0]).toEqual({ role: "system", content: "be brief" });
  });

  it("parses JSON output against the schema", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ choices: [{ message: { content: '{"ok": true}' } }] }),
    );
    const model = createDeepSeekModel("key", "deepseek-v4-pro", fetchImpl as unknown as typeof fetch);

    const parsed = await model.json({ system: "coach", user: "hi", schema: z.object({ ok: z.boolean() }) });

    expect(parsed).toEqual({ ok: true });
    const body = JSON.parse((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.messages[0].content).toContain("JSON schema");
  });

  it("rejects blank JSON content", async () => {
    const fetchImpl = vi.fn(async () => Response.json({ choices: [{ message: { content: "  " } }] }));
    const model = createDeepSeekModel("key", "deepseek-v4-pro", fetchImpl as unknown as typeof fetch);

    await expect(model.json({ system: "s", user: "u", schema: z.object({}) })).rejects.toThrow("empty JSON");
  });
});
