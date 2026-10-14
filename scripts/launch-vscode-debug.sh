#!/usr/bin/env bash
# Starts the installed Visual Studio Code with this checkout loaded as an
# extension, then waits until its extension host opens the inspect port.
# The "Launch extension (VS Code)" config attaches to that port.
# A launch config of type extensionHost cannot do this: Cursor handles that
# request by opening a Cursor window and ignores runtimeExecutable.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CODE="/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"
MAIN_BIN="/Applications/Visual Studio Code.app/Contents/MacOS/Code"
USER_DATA_DIR="$ROOT/extensions/.vscode-debug-user"
CONTINUE_DIR="$ROOT/extensions/.continue-debug"
GEN_FILE="$USER_DATA_DIR/session.gen"
VITE_PID_FILE="$USER_DATA_DIR/vite.pid"
PORT=5870
GUI_PORT=5173

vscode_alive() {
  # Only the main window. Helper and crashpad processes keep the user-data
  # path in their arguments after the window is gone.
  pgrep -f -- "${MAIN_BIN}.*${USER_DATA_DIR}" >/dev/null
}

stop_vscode() {
  local pids
  # The main process uses "--user-data-dir <path>"; helpers use "--user-data-dir=<path>".
  pids="$(pgrep -f -- "${USER_DATA_DIR}" || true)"
  if [[ -n "$pids" ]]; then
    # shellcheck disable=SC2086
    kill $pids 2>/dev/null || true
  fi
}

gui_listening() {
  nc -z -G 1 127.0.0.1 "$GUI_PORT" >/dev/null 2>&1 \
    || nc -z -G 1 ::1 "$GUI_PORT" >/dev/null 2>&1 \
    || nc -z -G 1 localhost "$GUI_PORT" >/dev/null 2>&1
}

listener_pid() {
  lsof -nP -tiTCP:"$GUI_PORT" -sTCP:LISTEN 2>/dev/null | head -1 || true
}

stop_owned_vite() {
  local pid pgid ppid
  if [[ -f "$VITE_PID_FILE" ]]; then
    pid="$(cat "$VITE_PID_FILE")"
    if [[ -n "$pid" ]] && kill -0 "$pid" 2>/dev/null; then
      pgid="$(ps -o pgid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
      if [[ -n "$pgid" && "$pgid" == "$pid" ]]; then
        kill -TERM -- "-$pid" 2>/dev/null || true
      else
        ppid="$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ' || true)"
        kill -TERM "$pid" 2>/dev/null || true
        if [[ -n "$ppid" ]] && ps -o command= -p "$ppid" 2>/dev/null | grep -q npm; then
          kill -TERM "$ppid" 2>/dev/null || true
        fi
      fi
    fi
  fi
  pid="$(listener_pid)"
  if [[ -n "$pid" ]]; then
    kill -TERM "$pid" 2>/dev/null || true
  fi
  rm -f "$VITE_PID_FILE"
}

# The launch task's terminal closes when this script exits and sends SIGHUP
# to its process group. A new session is outside that group.
start_detached() {
  local logfile="$1"
  local pidfile="$2"
  shift 2
  python3 - "$logfile" "$pidfile" "$@" <<'PY'
import os
import sys

logfile = sys.argv[1]
pidfile = sys.argv[2]
command = sys.argv[3:]
if os.fork() > 0:
    os._exit(0)
os.setsid()
stdin = os.open(os.devnull, os.O_RDONLY)
os.dup2(stdin, 0)
log = os.open(logfile, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
os.dup2(log, 1)
os.dup2(log, 2)
if pidfile:
    with open(pidfile, "w", encoding="utf-8") as handle:
        handle.write(str(os.getpid()))
os.execvp(command[0], command)
PY
}

read_gen() {
  local value=0
  if [[ -f "$GEN_FILE" ]]; then
    value="$(cat "$GEN_FILE")"
  fi
  if [[ ! "$value" =~ ^[0-9]+$ ]]; then
    value=0
  fi
  echo "$value"
}

if [[ "${1:-}" == "stop" ]]; then
  stop_vscode
  stop_owned_vite
  exit 0
fi

if [[ "${1:-}" == "watch" ]]; then
  expected="$(read_gen)"
  if [[ -n "${2:-}" ]]; then
    expected="$2"
  fi
  appeared=0
  for _ in $(seq 1 90); do
    if [[ "$(read_gen)" != "$expected" ]]; then
      exit 0
    fi
    if vscode_alive; then
      appeared=1
      break
    fi
    sleep 1
  done
  if [[ "$appeared" -eq 0 ]]; then
    exit 0
  fi
  while vscode_alive; do
    if [[ "$(read_gen)" != "$expected" ]]; then
      exit 0
    fi
    sleep 1
  done
  if [[ "$(read_gen)" == "$expected" ]]; then
    stop_owned_vite
  fi
  exit 0
fi

if [[ ! -x "$CODE" ]]; then
  echo "VS Code CLI not found at $CODE" >&2
  exit 1
fi

# Cursor exports these. Left set, the CLI talks to Cursor or Electron
# starts as a Node process instead of a window.
unset VSCODE_IPC_HOOK VSCODE_IPC_HOOK_CLI ELECTRON_RUN_AS_NODE NODE_OPTIONS

mkdir -p "$CONTINUE_DIR" "$USER_DATA_DIR"

# A newer launch stands the previous watcher down before that watcher can
# stop the dev server out from under the new window.
gen="$(( $(read_gen) + 1 ))"
echo "$gen" >"$GEN_FILE"

if ! gui_listening; then
  echo "Starting the GUI dev server on port $GUI_PORT..."
  : >"$USER_DATA_DIR/vite.log"
  start_detached "$USER_DATA_DIR/vite.log" "$VITE_PID_FILE" npm --prefix "$ROOT/gui" run dev
  for _ in $(seq 1 30); do
    if gui_listening; then
      break
    fi
    sleep 1
  done
  if ! gui_listening; then
    echo "GUI dev server did not start. See extensions/.vscode-debug-user/vite.log" >&2
    exit 1
  fi
else
  listener_pid >"$VITE_PID_FILE"
fi

# A previous debug window keeps the inspect port. Replace it.
stop_vscode
sleep 0.5

: >"$USER_DATA_DIR/code.log"
start_detached "$USER_DATA_DIR/code.log" "" \
  "$CODE" \
  --new-window \
  --user-data-dir "$USER_DATA_DIR" \
  --disable-extension Continue.continue \
  --extensionDevelopmentPath="$ROOT/extensions/vscode" \
  --extensionEnvironment="{\"CONTINUE_GLOBAL_DIR\":\"$CONTINUE_DIR\"}" \
  --inspect-extensions="$PORT" \
  "$ROOT/manual-testing-sandbox" \
  "$ROOT/manual-testing-sandbox/test.js"

# Stops the dev server after this window closes. A later launch bumps the
# generation, so this watcher does not kill the server that launch adopts.
start_detached "$USER_DATA_DIR/watch.log" "" \
  bash "$0" watch "$gen"

echo "Waiting for the VS Code extension host on port $PORT..."
for _ in $(seq 1 90); do
  if nc -z -G 1 127.0.0.1 "$PORT" >/dev/null 2>&1; then
    echo "VS Code extension host is listening on $PORT"
    exit 0
  fi
  sleep 1
done

echo "Timed out waiting for port $PORT. Stopped the debug VS Code window." >&2
stop_vscode
exit 1
