import type { z } from "zod";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface StreamRequest {
  system: string;
  messages: ChatMessage[];
  onText: (delta: string) => void;
  signal: AbortSignal;
}

export interface StreamResult {
  text: string;
  refused: boolean;
}

export interface JsonRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
}

export interface LanguageModel {
  stream(request: StreamRequest): Promise<StreamResult>;
  json<T>(request: JsonRequest<T>): Promise<T>;
}
