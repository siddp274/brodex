# Brodex agent-server image.
#
# Brodex now runs ENTIRELY inside the container as a long-lived server. The agent
# loop, tools (native), sessions, permissions, and LLM calls all run here; the
# server exposes HTTP + WebSocket on a port that the launcher publishes to the
# host. Clients (the TUI now, phone/web later) connect over that port. The agent
# never touches the host — only /workspace (the mounted volume) and this Linux
# environment.
#
# Code delivery: the entrypoint git-clones Brodex from $BRODEX_REPO if set,
# otherwise runs from the source mounted at /brodex (dev fallback). Either way it
# installs deps and starts the server.

FROM oven/bun:1.3-debian

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ripgrep \
        ca-certificates \
        curl \
        procps \
        coreutils \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /workspace /app
WORKDIR /workspace

ENV BRODEX_WORKSPACE=/workspace
ENV BRODEX_PORT=7000

COPY container/server-entrypoint.sh /usr/local/bin/brodex-server
RUN chmod +x /usr/local/bin/brodex-server

EXPOSE 7000
ENTRYPOINT ["/usr/local/bin/brodex-server"]
