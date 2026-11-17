# talkbuddy

Android app to practice spoken English with an AI partner. Hands-free voice conversation, a silent correction card after each turn (about 80% structure, 20% pronunciation), and you can talk over the bot to interrupt it.

## Layout

- `app/` — Flutter app (Android). Streams microphone audio, speaks the replies, shows the cards.
- `backend/` — Node + TypeScript. Azure Speech for transcription and pronunciation scores, Claude for the spoken reply and the correction card.

## Setup

1. Copy `backend/.env.example` to `backend/.env` and fill in:
   - `ANTHROPIC_API_KEY` — from console.anthropic.com
   - `AZURE_SPEECH_KEY` and `AZURE_SPEECH_REGION` — from a "Speech" resource in the Azure Portal
2. `cd backend && npm install`
3. On the phone, turn on Developer options and USB debugging, then connect it by USB.

## Run

```bash
cd backend && npm run dev            # terminal 1
adb reverse tcp:8787 tcp:8787        # lets the phone reach the Mac on localhost
cd app && flutter run                # terminal 2
```

`curl localhost:8787/health` reports any missing key.

## Settings (`backend/.env`)

| Variable | Default | Meaning |
|---|---|---|
| `DEEPSEEK_API_KEY` | empty | Optional. Enables `deepseek-v4-pro` in the app's model picker |
| `PRONUNCIATION` | `on` | `off` skips Azure pronunciation scoring |
| `PORT` | `8787` | Backend port |

## Tests

```bash
cd backend && npm test && npm run typecheck
cd app && flutter analyze && flutter test
```
