import "dotenv/config";
import { readFileSync } from "node:fs";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer } from "ws";
import { isAuthorized } from "./auth";
import { createCoach } from "./coach";
import { createModel, DEFAULT_MODEL_ID, listModels } from "./llm/catalog";
import type { LanguageModel } from "./llm/language-model";
import { parseClientMessage, type ServerMessage } from "./protocol";
import { Session } from "./session";
import { startSpeech } from "./speech";
import { createTutor } from "./tutor";

const PORT = Number(process.env.PORT ?? 8787);
const PRONUNCIATION = process.env.PRONUNCIATION !== "off";
const APP_TOKEN = process.env.APP_TOKEN || undefined;
const VERSION: string = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
const REQUIRED = ["ANTHROPIC_API_KEY", "AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"] as const;
const missing = () => REQUIRED.filter((name) => !process.env[name]);

const agentsFor = (model: LanguageModel) => ({ tutor: createTutor(model), coach: createCoach(model) });

const sendJson = (response: ServerResponse, body: unknown, status = 200) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const http = createServer((request, response) => {
  if (request.url === "/health") {
    sendJson(response, { ok: missing().length === 0, missing: missing(), version: VERSION });
    return;
  }
  if (request.url === "/models") {
    if (!isAuthorized(request, APP_TOKEN)) {
      sendJson(response, { error: "unauthorized" }, 401);
      return;
    }
    sendJson(response, { model: DEFAULT_MODEL_ID, models: listModels() });
    return;
  }
  response.writeHead(404).end();
});

const sockets = new WebSocketServer({
  server: http,
  path: "/session",
  verifyClient: ({ req }: { req: IncomingMessage }) => isAuthorized(req, APP_TOKEN),
});

sockets.on("connection", (socket) => {
  const send = (msg: ServerMessage) => {
    if (msg.type === "latency") console.log(`[turn ${msg.turnId}] first text after ${msg.firstTextMs} ms`);
    if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
  };

  const defaultModel = createModel(DEFAULT_MODEL_ID);
  if (missing().length > 0 || !defaultModel) {
    send({ type: "error", message: `Missing in backend/.env: ${missing().join(", ")}` });
    socket.close();
    return;
  }

  let modelId = DEFAULT_MODEL_ID;
  const session = new Session({ send, ...agentsFor(defaultModel) });
  const switchModel = (requested: string) => {
    const model = createModel(requested);
    if (model) {
      modelId = requested;
      session.useAgents(agentsFor(model));
      console.log(`[session] model switched to ${modelId}`);
    } else {
      send({ type: "error", message: `Model ${requested} is not available. Is its API key in backend/.env?` });
    }
    send({ type: "model", model: modelId });
  };

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
    if (msg?.type === "set_model") switchModel(msg.model);
    else if (msg) session.handleClient(msg);
  });
  socket.on("close", () => {
    session.close();
    speech.close();
  });
  send({ type: "ready", model: modelId, models: listModels() });
});

http.listen(PORT, "127.0.0.1", () => {
  const models = listModels().map((option) => `${option.id}${option.available ? "" : " (no key)"}`);
  console.log(`talkbuddy backend ${VERSION} on http://127.0.0.1:${PORT} (models: ${models.join(", ")})`);
  if (!APP_TOKEN) console.warn("APP_TOKEN is not set: anyone who can reach this port can use it");
  if (missing().length > 0) console.warn(`Missing in backend/.env: ${missing().join(", ")}`);
});
