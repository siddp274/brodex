# Brodex agent-server image — a capable HEADLESS Linux workstation.
#
# Brodex runs entirely inside the container as a long-lived server (HTTP + WS).
# The agent works in this Linux environment and on /workspace (the mounted
# volume). The image is built on Ubuntu 24.04 — the best-supported base for
# installing and running arbitrary headless applications — and ships:
#   - Bun        (runs the Brodex server itself)
#   - Python 3   + pip (install-enabled), venv, pipx
#   - Node.js    + npm
#   - Rust       + cargo
#   - Playwright + headless Chromium (browser automation / scraping)
#   - Media:     ffmpeg, imagemagick
#   - Documents: pandoc, poppler (pdf), libreoffice (headless)
#   - Graphics/font libraries many headless apps need
#
# There is NO GUI/display — apps run headless. (A visible desktop would need an
# Xvfb + VNC stack; unnecessary for automation, which only needs the engine.)
#
# Code delivery: the entrypoint git-clones Brodex from $BRODEX_REPO if set,
# otherwise runs from source mounted at /brodex (dev fallback).

FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8 LC_ALL=C.UTF-8

# --- Base tools, build toolchain, Python ---
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl wget git unzip xz-utils \
        ripgrep procps coreutils less \
        build-essential pkg-config \
        python3 python3-pip python3-venv pipx \
    && rm -rf /var/lib/apt/lists/*

# --- Media tools ---
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ffmpeg imagemagick \
    && rm -rf /var/lib/apt/lists/*

# --- Document / office (headless) ---
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        pandoc poppler-utils \
        libreoffice-core libreoffice-writer libreoffice-calc --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# --- Common graphics/font libraries headless apps need ---
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libcairo2 libpango-1.0-0 libpangocairo-1.0-0 libgdk-pixbuf-2.0-0 \
        libjpeg-turbo8 libpng16-16 librsvg2-2 \
        fontconfig fonts-liberation fonts-dejavu-core \
    && rm -rf /var/lib/apt/lists/*

# --- pip: allow system installs (the container IS the sandbox) ---
ENV PIP_BREAK_SYSTEM_PACKAGES=1
RUN python3 -m pip config set global.break-system-packages true 2>/dev/null || true
RUN ln -sf /usr/bin/python3 /usr/local/bin/python \
    && ln -sf /usr/bin/pip3 /usr/local/bin/pip 2>/dev/null || true
ENV PATH="/root/.local/bin:${PATH}"

# --- Bun (runs the Brodex server) ---
ENV BUN_INSTALL=/usr/local/bun
ENV PATH="/usr/local/bun/bin:${PATH}"
RUN curl -fsSL https://bun.sh/install | bash \
    && bun --version

# --- Node.js (NodeSource LTS) + npm ---
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# --- Rust + cargo ---
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
      | sh -s -- -y --no-modify-path --profile minimal \
    && cargo --version

# --- Playwright + headless Chromium (with its OS deps) ---
ENV PLAYWRIGHT_BROWSERS_PATH=/usr/local/share/playwright
RUN python3 -m pip install --no-cache-dir playwright \
    && python3 -m playwright install --with-deps chromium \
    && python3 -c "from playwright.sync_api import sync_playwright; print('playwright ok')"
RUN npm install -g playwright @playwright/test 2>/dev/null || true

RUN mkdir -p /workspace /app
WORKDIR /workspace

ENV BRODEX_WORKSPACE=/workspace
ENV BRODEX_PORT=7000

COPY container/server-entrypoint.sh /usr/local/bin/brodex-server
RUN chmod +x /usr/local/bin/brodex-server

EXPOSE 7000
ENTRYPOINT ["/usr/local/bin/brodex-server"]
