#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "usage: sudo bash provision.sh <deploy-public-key-file>" >&2
  exit 1
}

[ "$(id -u)" -eq 0 ] || { echo "run as root (sudo)" >&2; exit 1; }
[ $# -eq 1 ] && [ -f "$1" ] || usage
PUBLIC_KEY_FILE=$1
PORT=8790

SERVICE=talkbuddy
HOME_DIR=/home/$SERVICE
REPO_DIR=$HOME_DIR/talkbuddy
REPO_URL=https://github.com/iam-oov/talkbuddy.git

echo "==> packages"
apt-get update -qq
apt-get install -y -qq nodejs npm git curl openssl
node -v

echo "==> user"
id "$SERVICE" >/dev/null 2>&1 || useradd -m -s /bin/bash "$SERVICE"
usermod -aG systemd-journal "$SERVICE"

echo "==> deploy key"
install -d -m 700 -o "$SERVICE" -g "$SERVICE" "$HOME_DIR/.ssh"
touch "$HOME_DIR/.ssh/authorized_keys"
grep -qxF "$(cat "$PUBLIC_KEY_FILE")" "$HOME_DIR/.ssh/authorized_keys" || cat "$PUBLIC_KEY_FILE" >> "$HOME_DIR/.ssh/authorized_keys"
chown "$SERVICE:$SERVICE" "$HOME_DIR/.ssh/authorized_keys"
chmod 600 "$HOME_DIR/.ssh/authorized_keys"

echo "==> repo"
[ -d "$REPO_DIR/.git" ] || sudo -u "$SERVICE" git clone -q "$REPO_URL" "$REPO_DIR"
install -d -o "$SERVICE" -g "$SERVICE" "$REPO_DIR/backend"

echo "==> secrets"
ENV_PATH=$REPO_DIR/backend/.env
if [ ! -f "$ENV_PATH" ]; then
  install -m 600 -o "$SERVICE" -g "$SERVICE" /dev/null "$ENV_PATH"
  printf '%s\n' \
    "ANTHROPIC_API_KEY=" "DEEPSEEK_API_KEY=" "AZURE_SPEECH_KEY=" "AZURE_SPEECH_REGION=" \
    "PRONUNCIATION=on" "PORT=$PORT" "APP_TOKEN=$(openssl rand -hex 32)" > "$ENV_PATH"
fi

echo "==> systemd unit"
UNIT_SOURCE=$(dirname "$0")/talkbuddy.service
install -m 644 "$UNIT_SOURCE" /etc/systemd/system/$SERVICE.service
systemctl daemon-reload
systemctl enable $SERVICE

echo "==> sudoers"
echo "$SERVICE ALL=(ALL) NOPASSWD: /usr/bin/systemctl restart $SERVICE" > /etc/sudoers.d/$SERVICE
chmod 440 /etc/sudoers.d/$SERVICE
visudo -cf /etc/sudoers.d/$SERVICE

echo "==> done."
echo "Next: fill in the API keys with: sudo -u $SERVICE nano $ENV_PATH"
echo "The first deploy from main installs dependencies and starts the service."
