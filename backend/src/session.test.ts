import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { limitCard } from "./coach";
import { CardSchema, parseClientMessage, type Card, type ServerMessage } from "./protocol";
import { isBargeIn, Session, type Coach, type Tutor } from "./session";
import { extractLowWords } from "./speech";

const fineCard: Card = { was_fine: true, natural_version: "ok", structure_notes: [], pronunciation: null };
const segment = (text: string) => ({ text, lowWords: [] });

/** A tutor whose reply is released by the test, so the bot can be "mid-sentence". */
function controllableTutor() {
  const calls: { history: { role: string; content: string }[]; finish: (text: string) => void; signal: AbortSignal }[] = [];
  const tutor: Tutor = {
    reply(history, onText, signal) {
      return new Promise((resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
        calls.push({
          history,
          signal,
          finish: (text) => {
            onText(text);
            resolve({ text, refused: false });
          },
        });
      });
    },
  };
  return { tutor, calls };
}

function setup() {
  const sent: ServerMessage[] = [];
  const { tutor, calls } = controllableTutor();
  const coach: Coach = { card: vi.fn(async () => fineCard) };
  const session = new Session({ send: (msg) => sent.push(msg), tutor, coach });
  const types = () => sent.map((msg) => msg.type);
  return { session, sent, calls, coach, types };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("turn taking", () => {
  it("commits a turn only after the silence window", async () => {
    const { session, calls, types } = setup();
    session.handleFinal(segment("I think that"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(types()).not.toContain("user_turn");
    await vi.advanceTimersByTimeAsync(1000);
    expect(types()).toContain("user_turn");
    expect(calls[0].history).toEqual([{ role: "user", content: "I think that" }]);
  });

  it("keeps the turn open when the learner resumes after a thinking pause", async () => {
    const { session, sent, types } = setup();
    session.handleFinal(segment("I think that"));
    await vi.advanceTimersByTimeAsync(1000);
    session.handlePartial("the problem");
    await vi.advanceTimersByTimeAsync(5000);
    expect(types()).not.toContain("user_turn");
    session.handleFinal(segment("the problem is the price."));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent.find((msg) => msg.type === "user_turn")).toMatchObject({ text: "I think that the problem is the price." });
  });

  it("send_now commits without waiting", () => {
    const { session, types } = setup();
    session.handleFinal(segment("Hello there"));
    session.handleClient({ type: "send_now" });
    expect(types()).toContain("user_turn");
  });

  it("sends the card for the turn", async () => {
    const { session, sent, coach } = setup();
    session.handleFinal(segment("I have 30 years"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(coach.card).toHaveBeenCalledWith({ utterance: "I have 30 years", previousBotLine: null, lowWords: [] });
    expect(sent.find((msg) => msg.type === "card")).toMatchObject({ turnId: 1, card: fineCard });
  });
});

describe("barge-in", () => {
  async function botTalking() {
    const ctx = setup();
    ctx.session.handleFinal(segment("Tell me about your weekend"));
    await vi.advanceTimersByTimeAsync(2000);
    ctx.calls[0].finish("I went hiking near the lake on Saturday. What about you?");
    await vi.advanceTimersByTimeAsync(0);
    return ctx;
  }

  it("ignores the bot's own voice coming back through the microphone", async () => {
    const { session, types } = await botTalking();
    session.handleFinal(segment("went hiking near the lake"));
    session.handlePartial("what about you");
    expect(types()).not.toContain("interrupt");
  });

  it("ignores a single word or noise", async () => {
    const { session, types } = await botTalking();
    session.handlePartial("Mm");
    expect(types()).not.toContain("interrupt");
  });

  it("stops the bot and keeps only what was spoken aloud", async () => {
    const { session, sent, calls } = await botTalking();
    session.handlePartial("wait which lake");
    expect(sent.at(-2)).toEqual({ type: "interrupt", turnId: 1 });
    session.handleClient({ type: "interrupted", turnId: 1, spokenText: "I went hiking near the lake on Saturday." });
    session.handleFinal(segment("Wait, which lake?"));
    await vi.advanceTimersByTimeAsync(2000);
    expect(calls[1].history).toEqual([
      { role: "user", content: "Tell me about your weekend" },
      { role: "assistant", content: "I went hiking near the lake on Saturday. [interrupted]" },
      { role: "user", content: "Wait, which lake?" },
    ]);
  });

  it("aborts a reply that is still streaming and drops it when nothing was spoken", async () => {
    const { session, calls } = setup();
    session.handleFinal(segment("Tell me a story"));
    await vi.advanceTimersByTimeAsync(2000);
    session.handlePartial("actually never mind");
    expect(calls[0].signal.aborted).toBe(true);
    session.handleClient({ type: "interrupted", turnId: 1, spokenText: "" });
    expect(session.transcript).toEqual([{ role: "user", content: "Tell me a story" }]);
  });

  it("drops the bot's last sentence when Azure reports it just after the speech ended", async () => {
    const { session, sent } = await botTalking();
    session.handleClient({ type: "tts_done", turnId: 1 });
    await vi.advanceTimersByTimeAsync(800);
    session.handlePartial("what about you");
    session.handleFinal(segment("What about you?"));
    session.handleFinal(segment("You?"));
    await vi.advanceTimersByTimeAsync(5000);
    expect(sent.filter((msg) => msg.type === "user_turn")).toHaveLength(1);
  });

  it("lets the learner answer normally once the phone reports the speech ended", async () => {
    const { session, sent } = await botTalking();
    session.handleClient({ type: "tts_done", turnId: 1 });
    session.handleFinal(segment("Yes."));
    await vi.advanceTimersByTimeAsync(2000);
    expect(sent.filter((msg) => msg.type === "user_turn")).toHaveLength(2);
  });
});

describe("helpers", () => {
  it("isBargeIn separates echo from real speech", () => {
    const bot = "I went hiking near the lake on Saturday.";
    expect(isBargeIn("hiking near the lake", bot)).toBe(false);
    expect(isBargeIn("sorry can you repeat", bot)).toBe(true);
    expect(isBargeIn("okay", bot)).toBe(false);
  });

  it("extractLowWords keeps the worst words only", () => {
    const json = JSON.stringify({
      NBest: [
        {
          Words: [
            { Word: "I", PronunciationAssessment: { AccuracyScore: 98, ErrorType: "None" } },
            { Word: "thought", PronunciationAssessment: { AccuracyScore: 41, ErrorType: "Mispronunciation" } },
            { Word: "comfortable", PronunciationAssessment: { AccuracyScore: 55, ErrorType: "None" } },
          ],
        },
      ],
    });
    expect(extractLowWords(json)).toEqual([
      { word: "thought", accuracy: 41 },
      { word: "comfortable", accuracy: 55 },
    ]);
    expect(extractLowWords("not json")).toEqual([]);
  });

  it("card schema and limits", () => {
    const note = { issue: "a", fix: "b", why: "c" };
    const card = CardSchema.parse({ ...fineCard, was_fine: false, structure_notes: [note, note, note] });
    expect(limitCard(card).structure_notes).toHaveLength(2);
    expect(CardSchema.safeParse({ was_fine: true }).success).toBe(false);
  });

  it("parses client messages and rejects junk", () => {
    expect(parseClientMessage('{"type":"config","silenceMs":3000}')).toEqual({ type: "config", silenceMs: 3000 });
    expect(parseClientMessage('{"type":"config","silenceMs":10}')).toBeNull();
    expect(parseClientMessage("nope")).toBeNull();
  });
});
