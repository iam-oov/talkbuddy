import { z } from "zod";

/** Silent correction card shown under each learner turn. 80% structure, 20% pronunciation. */
export const CardSchema = z.object({
  was_fine: z.boolean(),
  natural_version: z.string(),
  structure_notes: z.array(
    z.object({ issue: z.string(), fix: z.string(), why: z.string() }),
  ),
  pronunciation: z.object({ word: z.string(), tip: z.string() }).nullable(),
});
export type Card = z.infer<typeof CardSchema>;

/** JSON text frames from the phone. Audio travels separately as binary PCM16 16 kHz mono frames. */
export const ClientMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("config"), silenceMs: z.number().min(1000).max(6000) }),
  z.object({ type: z.literal("send_now") }),
  z.object({ type: z.literal("tts_done"), turnId: z.number() }),
  z.object({ type: z.literal("interrupted"), turnId: z.number(), spokenText: z.string() }),
]);
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export type ServerMessage =
  | { type: "ready" }
  | { type: "partial"; text: string }
  | { type: "user_turn"; turnId: number; text: string }
  | { type: "reply_delta"; turnId: number; text: string }
  | { type: "reply_done"; turnId: number }
  | { type: "interrupt"; turnId: number }
  | { type: "card"; turnId: number; card: Card }
  | { type: "latency"; turnId: number; firstTextMs: number }
  | { type: "error"; message: string };

export function parseClientMessage(raw: string): ClientMessage | null {
  try {
    const result = ClientMessageSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
