# Brodex agent-server image (polyglot).
#
# Brodex runs ENTIRELY inside the container as a long-lived server (HTTP + WS).
# The agent works in this Linux environment and on /workspace (the mounted
# volume). This image ships common language runtimes so the agent can build and
# run apps without an install dance:
#   - Bun        (runs the Brodex server itself)
#   - Python 3   + pip (install-enabled), venv, pipx
#   - Node.js    + npm
#   - Rust       + cargo
#   - build-essential, git, ripgrep, curl
#
# Code delivery: the entrypoint git-clones Brodex from $BRODEX_REPO if set,
# otherwise runs from source mounted at /brodex (dev fallback).

FROM oven/bun:1.3-debian

ENV DEBIAN_FRONTEND=noninteractive

# Base tools + Python + build toolchain.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        git \
        ripgrep \
        ca-certificates \
        curl \
        wget \
        procps \
        coreutils \
        build-essential \
        pkg-config \
        python3 \
        python3-pip \
        python3-venv \
        pipx \
    && rm -rf /var/lib/apt/lists/*

# Let pip install into the system environment (the container IS the sandbox), so
# `pip install fastapi` just works — no externally-managed-environment errors,
# no per-task venv required. The agent can still create venvs if it wants.
ENV PIP_BREAK_SYSTEM_PACKAGES=1
RUN python3 -m pip config set global.break-system-packages true 2>/dev/null || true
# Convenience: `python` and `pip` aliases.
RUN ln -sf /usr/bin/python3 /usr/local/bin/python \
    && ln -sf /usr/bin/pip3 /usr/local/bin/pip 2>/dev/null || true
# pipx apps on PATH.
ENV PATH="/root/.local/bin:${PATH}"

# Node.js (NodeSource LTS) + npm — a real Node runtime for JS/TS apps, separate
# from Bun which runs the Brodex server.
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Rust + cargo via rustup (default stable toolchain), on PATH for all users.
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal \
    && rustup --version && cargo --version

RUN mkdir -p /workspace /app
WORKDIR /workspace

ENV BRODEX_WORKSPACE=/workspace
ENV BRODEX_PORT=7000

COPY container/server-entrypoint.sh /usr/local/bin/brodex-server
RUN chmod +x /usr/local/bin/brodex-server

EXPOSE 7000
ENTRYPOINT ["/usr/local/bin/brodex-server"]
