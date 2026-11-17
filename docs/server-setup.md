# Home server setup

One-time bring-up of the TalkBuddy backend on the x86 home server (Ubuntu Server 26.04, behind the
Cloudflare Tunnel). After this, every push to `main` that passes CI deploys itself through
`.github/workflows/deploy.yml`.

The workflow cannot do any of these steps: it reaches the server through the tunnel and the
`talkbuddy` user created here.

## Automated provisioning

`deploy/provision.sh` does steps 2 to 7 in one run. It is idempotent and keeps an existing `.env`.
Copy it to the server together with `deploy/talkbuddy.service` and the deploy public key, then:

```bash
sudo bash provision.sh talkbuddy_deploy.pub
sudo -u talkbuddy nano /home/talkbuddy/talkbuddy/backend/.env
```

The script generates `APP_TOKEN` on the server; you fill in the API keys. The steps below stay as
the reference and the fallback.

## 1. Pick a free port

Port `8787` belongs to memodi.

```bash
ss -tlnp | grep -E ':879[0-9]'
```

The examples below use `8790`. If it is taken, pick another and use it everywhere below.

## 2. Node.js

```bash
sudo apt install -y nodejs npm git curl
node -v
```

`node -v` must print 22 or newer.

## 3. Service user and deploy key

```bash
sudo useradd -m -s /bin/bash talkbuddy
sudo usermod -aG systemd-journal talkbuddy
```

On your own machine, create the CI key pair (no passphrase):

```bash
ssh-keygen -t ed25519 -N '' -C talkbuddy-deploy -f ~/.ssh/talkbuddy_deploy
```

Authorize the public key on the server:

```bash
sudo -u talkbuddy mkdir -p /home/talkbuddy/.ssh
echo '<contents of talkbuddy_deploy.pub>' | sudo tee -a /home/talkbuddy/.ssh/authorized_keys
sudo chown -R talkbuddy:talkbuddy /home/talkbuddy/.ssh
sudo chmod 700 /home/talkbuddy/.ssh
sudo chmod 600 /home/talkbuddy/.ssh/authorized_keys
```

## 4. Repo and dependencies

```bash
sudo -iu talkbuddy bash <<'EOF'
git clone https://github.com/iam-oov/talkbuddy.git ~/talkbuddy
cd ~/talkbuddy/backend && npm ci --omit=dev
cp .env.example .env
EOF
```

If the repo is private, clone with a read-only deploy key instead of HTTPS.

## 5. Secrets

Edit `/home/talkbuddy/talkbuddy/backend/.env`:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY`, `DEEPSEEK_API_KEY`, `AZURE_SPEECH_KEY`, `AZURE_SPEECH_REGION` | Same keys as your local `.env` |
| `PORT` | The port from step 1 |
| `APP_TOKEN` | A long random value: `openssl rand -hex 32` |

`APP_TOKEN` is required in production. The deploy fails if `/models` answers without it.

```bash
sudo chmod 600 /home/talkbuddy/talkbuddy/backend/.env
```

## 6. systemd unit

```bash
sudo cp /home/talkbuddy/talkbuddy/deploy/talkbuddy.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now talkbuddy
curl -s http://127.0.0.1:8790/health
```

`/health` must answer `"ok":true`.

## 7. Sudoers for the deploy restart

```bash
echo 'talkbuddy ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart talkbuddy' | sudo tee /etc/sudoers.d/talkbuddy
sudo chmod 440 /etc/sudoers.d/talkbuddy
```

## 8. Public hostname

In the Cloudflare Zero Trust dashboard, add a public hostname to the existing tunnel:
`talkbuddy.valdoh.com → http://localhost:8790`. WebSockets work through the tunnel with no extra
setting.

```bash
curl -s https://talkbuddy.valdoh.com/health
```

## 9. GitHub secrets

```bash
gh secret set CF_ACCESS_CLIENT_ID
gh secret set CF_ACCESS_CLIENT_SECRET
gh secret set SERVER_SSH_USER --body talkbuddy
gh secret set SERVER_SSH_KEY < ~/.ssh/talkbuddy_deploy
```

The Cloudflare Access service token can be the one memodi uses, as long as the `pi.valdoh.com`
Access policy allows it.

## Release build of the app

```bash
cd app
flutter build apk --release \
  --dart-define=BACKEND_WS=wss://talkbuddy.valdoh.com/session \
  --dart-define=BACKEND_TOKEN=<APP_TOKEN from step 5>
adb install -r build/app/outputs/flutter-apk/app-release.apk
```

The token is compiled into the APK, so keep the APK to yourself. To revoke it, change `APP_TOKEN`
on the server, restart the service and rebuild the app.

## Manual deploy

```bash
ssh -o "ProxyCommand=cloudflared access ssh --hostname %h" talkbuddy@pi.valdoh.com
cd ~/talkbuddy && git fetch origin main && git reset --hard origin/main
cd backend && npm ci --omit=dev && sudo systemctl restart talkbuddy
```
