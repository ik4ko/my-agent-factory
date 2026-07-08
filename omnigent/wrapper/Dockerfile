# Omnigent trigger wrapper + runner/host, on one persistent container.
# This is the piece Vercel can't be (stateless functions can't hold the
# runner's long-lived WS tunnel) — see docs/omnigent-integration-plan.md §4.
# FOR REVIEW ONLY — not deployed. Build/push/deploy is a separate decision.

FROM node:22-slim

# uv (Omnigent's own installer) + Python 3.12 it manages internally.
RUN apt-get update && apt-get install -y --no-install-recommends \
      curl ca-certificates git bubblewrap \
    && rm -rf /var/lib/apt/lists/*
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"
RUN uv tool install --python 3.12 omnigent

WORKDIR /app
COPY server.mjs ./server.mjs

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
CMD sh -c '\
  export PYTHONIOENCODING=utf-8 PYTHONUTF8=1 && \
  (while true; do omnigent host "$OMNIGENT_SERVER_URL"; sleep 2; done) & \
  exec node server.mjs \
'
