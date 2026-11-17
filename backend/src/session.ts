import type { ChatMessage } from "./llm/language-model";
import { INTERRUPTED_MARK, REFUSAL_LINE } from "./prompts";
import type { Card, ClientMessage, ServerMessage } from "./protocol";

export type { ChatMessage };

export interface LowWord {
  word: string;
  accuracy: number;
}
export interface SpeechSegment {
  text: string;
  lowWords: LowWord[];
}
export interface Tutor {
  reply(
    history: ChatMessage[],
    onText: (delta: string) => void,
    signal: AbortSignal,
  ): Promise<{ text: string; refused: boolean }>;
}
export interface Coach {
  card(input: { utterance: string; previousBotLine: string | null; lowWords: LowWord[] }): Promise<Card>;
}

/** How long Azure waits in silence before it closes a phrase. Our turn timer runs on top of it. */
export const SEGMENT_SILENCE_MS = 800;
const DEFAULT_SILENCE_MS = 2000;
/** Azure reports the bot's last sentence a moment after the speaker goes quiet; keep filtering until then. */
export const ECHO_GRACE_MS = SEGMENT_SILENCE_MS + 1200;

interface BotTurn {
  turnId: number;
  text: string;
  abort: AbortController;
  entry: ChatMessage | null;
  expiry: ReturnType<typeof setTimeout> | null;
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean);

const bigrams = (tokens: string[]) => tokens.slice(1).map((token, i) => `${tokens[i]} ${token}`);

/**
 * While the bot is talking, the microphone stays open. Speech counts as a real
 * interruption only when it has two or more words and is not the bot's own voice
 * leaking back through the speaker (most of its word pairs appear in the bot's line).
 */
export function isBargeIn(heard: string, botText: string): boolean {
  return words(heard).length >= 2 && !isEcho(heard, botText);
}

/** True when the heard text is most likely the bot's own line picked up by the microphone. */
export function isEcho(heard: string, botText: string): boolean {
  const heardWords = words(heard);
  const botWords = words(botText);
  if (heardWords.length === 0) return true;
  if (heardWords.length === 1) return botWords.at(-1) === heardWords[0];
  const botPairs = new Set(bigrams(botWords));
  const heardPairs = bigrams(heardWords);
  const echoed = heardPairs.filter((pair) => botPairs.has(pair)).length;
  return echoed / heardPairs.length >= 0.5;
}

/** One phone connection: turns speech segments into turns, runs tutor and coach, handles barge-in. */
export class Session {
  private history: ChatMessage[] = [];
  private pending: SpeechSegment[] = [];
  private turnTimer: ReturnType<typeof setTimeout> | null = null;
  private silenceMs = DEFAULT_SILENCE_MS;
  private sendOnNextFinal = false;
  private turnId = 0;
  private bot: BotTurn | null = null;
  private interruptedBots = new Map<number, BotTurn>();
  private recentBot: { text: string; until: number } | null = null;
  private closed = false;

  constructor(
    private deps: { send: (msg: ServerMessage) => void; tutor: Tutor; coach: Coach },
  ) {}

  /** Swaps the brain behind tutor and coach; the conversation history carries over. */
  useAgents(agents: { tutor: Tutor; coach: Coach }): void {
    this.deps = { ...this.deps, ...agents };
  }

  handlePartial(text: string): void {
    if (!text.trim() || this.closed) return;
    if (this.bot && !this.tryInterrupt(text)) return;
    if (this.isLateEcho(text)) return;
    this.clearTurnTimer();
    this.deps.send({ type: "partial", text: this.pendingText(text) });
  }

  handleFinal(segment: SpeechSegment): void {
    if (!segment.text.trim() || this.closed) return;
    if (this.bot && !this.tryInterrupt(segment.text)) return;
    if (this.isLateEcho(segment.text)) return;
    this.pending.push(segment);
    this.deps.send({ type: "partial", text: this.pendingText() });
    if (this.sendOnNextFinal) {
      this.commit();
      return;
    }
    this.clearTurnTimer();
    this.turnTimer = setTimeout(() => this.commit(), Math.max(this.silenceMs - SEGMENT_SILENCE_MS, 300));
  }

  handleClient(msg: ClientMessage): void {
    switch (msg.type) {
      case "config":
        this.silenceMs = msg.silenceMs;
        break;
      case "send_now":
        if (this.pending.length > 0) this.commit();
        else this.sendOnNextFinal = true;
        break;
      case "tts_done":
        if (this.bot?.turnId === msg.turnId) this.endBotTurn();
        break;
      case "interrupted": {
        const bot = this.interruptedBots.get(msg.turnId);
        if (!bot) break;
        this.interruptedBots.delete(msg.turnId);
        this.setSpoken(bot, msg.spokenText);
        break;
      }
    }
  }

  close(): void {
    this.closed = true;
    this.clearTurnTimer();
    if (this.bot) {
      this.bot.abort.abort();
      this.endBotTurn();
    }
  }

  /** Read-only view for tests and logs. */
  get transcript(): readonly ChatMessage[] {
    return this.history;
  }

  private pendingText(extra = ""): string {
    return [...this.pending.map((segment) => segment.text), extra].filter(Boolean).join(" ");
  }

  private clearTurnTimer(): void {
    if (this.turnTimer) clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }

  private endBotTurn(): void {
    if (!this.bot) return;
    if (this.bot.expiry) clearTimeout(this.bot.expiry);
    this.recentBot = { text: this.bot.text, until: Date.now() + ECHO_GRACE_MS };
    this.bot = null;
  }

  private isLateEcho(heard: string): boolean {
    return !this.bot && this.recentBot !== null && Date.now() < this.recentBot.until && isEcho(heard, this.recentBot.text);
  }

  /** Returns true when the bot was cut off and the heard text should start a new learner turn. */
  private tryInterrupt(heard: string): boolean {
    const bot = this.bot;
    if (!bot) return true;
    if (!isBargeIn(heard, bot.text)) return false;
    bot.abort.abort();
    this.deps.send({ type: "interrupt", turnId: bot.turnId });
    // Provisional until the phone reports how much was actually spoken aloud.
    this.setSpoken(bot, bot.text);
    this.interruptedBots.set(bot.turnId, bot);
    this.endBotTurn();
    return true;
  }

  private setSpoken(bot: BotTurn, spokenText: string): void {
    const spoken = spokenText.trim();
    if (!spoken) {
      if (bot.entry) this.history = this.history.filter((entry) => entry !== bot.entry);
      bot.entry = null;
      return;
    }
    const content = `${spoken} ${INTERRUPTED_MARK}`;
    if (bot.entry) bot.entry.content = content;
    else {
      bot.entry = { role: "assistant", content };
      this.history.push(bot.entry);
    }
  }

  private commit(): void {
    this.clearTurnTimer();
    this.sendOnNextFinal = false;
    if (this.pending.length === 0) return;
    const segments = this.pending;
    this.pending = [];
    const utterance = segments.map((segment) => segment.text).join(" ");
    const lowWords = segments.flatMap((segment) => segment.lowWords);
    const previousBotLine = this.history.findLast((entry) => entry.role === "assistant")?.content ?? null;
    const turnId = ++this.turnId;

    this.history.push({ role: "user", content: utterance });
    this.deps.send({ type: "user_turn", turnId, text: utterance });

    void this.runTutor(turnId);
    void this.runCoach(turnId, { utterance, previousBotLine, lowWords });
  }

  private async runTutor(turnId: number): Promise<void> {
    const bot: BotTurn = { turnId, text: "", abort: new AbortController(), entry: null, expiry: null };
    this.bot = bot;
    const startedAt = Date.now();
    const say = (delta: string) => {
      if (bot.abort.signal.aborted) return;
      if (!bot.text) this.deps.send({ type: "latency", turnId, firstTextMs: Date.now() - startedAt });
      bot.text += delta;
      this.deps.send({ type: "reply_delta", turnId, text: delta });
    };

    try {
      const result = await this.deps.tutor.reply([...this.history], say, bot.abort.signal);
      if (bot.abort.signal.aborted) return;
      if (result.refused) say(bot.text ? ` ${REFUSAL_LINE}` : REFUSAL_LINE);
      bot.entry = { role: "assistant", content: bot.text };
      this.history.push(bot.entry);
      this.deps.send({ type: "reply_done", turnId });
      // If the phone never confirms the speech ended, stop treating the bot as talking.
      const speakingMs = (bot.text.length / 10) * 1000 + 3000;
      bot.expiry = setTimeout(() => {
        if (this.bot === bot) this.endBotTurn();
      }, speakingMs);
    } catch (error) {
      if (bot.abort.signal.aborted) return;
      if (this.bot === bot) this.endBotTurn();
      this.deps.send({ type: "error", message: `Tutor: ${describe(error)}` });
    }
  }

  private async runCoach(turnId: number, input: Parameters<Coach["card"]>[0]): Promise<void> {
    try {
      const card = await this.deps.coach.card(input);
      if (!this.closed) this.deps.send({ type: "card", turnId, card });
    } catch (error) {
      console.error(`[coach] turn ${turnId}: ${describe(error)}`);
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
