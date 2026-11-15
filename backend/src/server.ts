import "dotenv/config";
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";
import { WebSocketServer } from "ws";
import { createCoach } from "./coach";
import { parseClientMessage, type ServerMessage } from "./protocol";
import { Session } from "./session";
import { startSpeech } from "./speech";
import { createTutor } from "./tutor";

const PORT = Number(process.env.PORT ?? 8787);
const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-5-5";
const PRONUNCIATION = process.env.PRONUNCIATION !== "off";
const REQUIRED = ["ANTHROPIC_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"] as const;
const missing = () => REQUIRED.filter((name) => !process.env[name]);

const http = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: missing().length === 0, missing: missing(), model: MODEL }));
    return;
  }
  response.writeHead(404).end();
});

const sockets = new WebSocketServer({ server: http, path: "/session" });

sockets.on("connection", (socket) => {
  const send = (msg: ServerMessage) => {
    if (msg.type === "latency") console.log(`[turn ${msg.turnId}] first text after ${msg.firstTextMs} ms`);
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  if (missing().length > 0) {
    send({ type: "error", message: `Missing in backend/.env: ${missing().join(", ")}` });
    socket.close();
    return;
  }

  const client = new Anthropic();
  const session = new Session({ send, tutor: createTutor(client, MODEL), coach: createCoach(client, MODEL) });
  const speech = startSpeech({
    key: process.env.AZURE_SPEECH_KEY!,
    region: process.env.AZURE_SPEECH_REGION!,
    pronunciation: PRONUNCIATION,
    onPartial: (text) => session.handlePartial(text),
    onFinal: (segment) => session.handleFinal(segment),
    onError: (message) => send({ type: "error", message }),
  });

  socket.on("message", (data, isBinary) => {
    if (isBinary) {
      speech.write(data as Buffer);
      return;
    }
    const msg = parseClientMessage(data.toString());
    if (msg) session.handleClient(msg);
  });
  socket.on("close", () => {
    session.close();
    speech.close();
  });
  send({ type: "ready" });
});

// Localhost only: the phone reaches it through `adb reverse tcp:8787 tcp:8787`.
http.listen(PORT, "127.0.0.1", () => {
  console.log(`talkbuddy backend on http://127.0.0.1:${PORT} (model ${MODEL})`);
  if (missing().length > 0) console.warn(`Missing in backend/.env: ${missing().join(", ")}`);
});
