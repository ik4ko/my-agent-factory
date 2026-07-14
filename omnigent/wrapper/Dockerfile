# Omnigent trigger wrapper + runner/host, on one persistent container.
# This is the piece Vercel can't be (stateless functions can't hold the
# runner's long-lived WS tunnel) — see docs/omnigent-integration-plan.md §4.
# Deployed live as Render service omnigent-wrapper (srv-d984jnt7vvec738v4j5g),
# built from branch omnigent-wrapper-deploy with autoDeploy off — deploys are
# triggered explicitly via the Render API/dashboard, never by a push alone.

FROM node:22-slim

# uv (Omnigent's own installer) + Python 3.12 it manages internally.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git bubblewrap \
    && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
RUN uv tool install --python 3.12 omnigent

# Gated sprint CLIs for the Autonomous Loop Engine. Both authenticate via
# their own subscription login (one-time, interactive, via the Render shell) —
# this image never bakes in or proxies a credential. Auth state lives on the
# persistent disk mounted at /var/data (dsk-d9aoehd8nd3s739fmcl0) so logins
# survive redeploys; both CLIs honor these env overrides for their state dirs.
RUN npm install -g @anthropic-ai/claude-code @openai/codex
ENV CLAUDE_CONFIG_DIR=/var/data/claude-config
ENV CODEX_HOME=/var/data/codex-home

WORKDIR /app
COPY server.mjs ./server.mjs
COPY telegram-gate.mjs ./telegram-gate.mjs
COPY market-hours.mjs ./market-hours.mjs
COPY cron.mjs ./cron.mjs
COPY watcher.mjs ./watcher.mjs

# WRAPPER_AUTH_TOKEN_FILE / OMNIGENT_API_TOKEN(-equivalent) are supplied at
# deploy time as platform secrets, never baked into the image.
ENV WRAPPER_PORT=7900
EXPOSE 7900

# Registers this container as a host against the (separately deployed)
# Omnigent server, then starts the wrapper. OMNIGENT_SERVER_URL and
# WRAPPER_AUTH_TOKEN_FILE (or WRAPPER_AUTH_TOKEN) must be set at deploy time.
#
# `omnigent host` has no built-in supervisor — verified live that killing
# its daemon process leaves it offline indefinitely with no auto-restart
# (re-registration afterward is a plain re-run of the same command, same
# host_id, but nothing does that automatically). The `while true` loop here
# is that supervision — without it, any crash of just the host connection
# (container itself staying up) would silently go unrepaired.
# The Telegram watcher (read-only event loop) runs ONLY when its env is
# present, under the same while-true supervision the host loop uses. The
# watcher itself additionally refuses to start without
# TELEGRAM_OPERATOR_CHAT_ID (allowlist-first), so a token without an
# allowlist stays inert.
CMD sh -c '\
  export PYTHONIOENCODING=utf-8 PYTHONUTF8=1 && \
  mkdir -p "$CLAUDE_CONFIG_DIR" "$CODEX_HOME" && \
  (while true; do omnigent host "$OMNIGENT_SERVER_URL"; sleep 2; done) & \
  ( [ -n "$TELEGRAM_BOT_TOKEN" ] && while true; do node watcher.mjs; sleep 2; done ) & \
  exec node server.mjs \
'
