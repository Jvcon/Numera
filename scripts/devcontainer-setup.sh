#!/usr/bin/env bash
# Post-create setup for the Numera dev container.
# Installs OpenCode, the oh-my-opencode-slim plugin, and the mattpocock/skills
# skill set so agents can drive GitHub issues via the `gh` CLI.
# Each step is independent: a failure is reported but does not abort the rest.

set -uo pipefail

log() { printf '\n==> %s\n' "$*"; }

# The npm cache is a named volume that Docker creates root-owned; npx cannot
# write to it until it is chowned to the container user.
if [ -d "$HOME/.npm" ] && [ ! -w "$HOME/.npm" ]; then
  log "Fixing ownership of $HOME/.npm"
  sudo chown -R "$(id -u):$(id -g)" "$HOME/.npm" || true
fi

# GitHub CLI: the devcontainer `github-cli` feature normally installs this, but
# the issue-tracker skills hard-depend on `gh`. Verify it and install it if the
# feature was skipped (e.g. a container built before the feature existed), so
# agent-driven issue workflows never start without it.
if command -v gh >/dev/null 2>&1; then
  log "GitHub CLI already present: $(gh --version | head -n1)"
else
  log "Installing GitHub CLI"
  gh_arch="$(uname -m)"
  case "$gh_arch" in
    x86_64) gh_arch=amd64 ;;
    aarch64 | arm64) gh_arch=arm64 ;;
  esac
  gh_version="$(curl -fsSL https://api.github.com/repos/cli/cli/releases/latest \
    | grep -oP '"tag_name":\s*"v\K[^"]+' | head -n1)"
  gh_version="${gh_version:-2.101.0}"
  tmp="$(mktemp -d)"
  if curl -fsSL -o "$tmp/gh.tar.gz" \
      "https://github.com/cli/cli/releases/download/v${gh_version}/gh_${gh_version}_linux_${gh_arch}.tar.gz" \
    && tar -xzf "$tmp/gh.tar.gz" -C "$tmp" \
    && sudo install -m 0755 "$tmp/gh_${gh_version}_linux_${gh_arch}/bin/gh" /usr/local/bin/gh; then
    log "GitHub CLI installed: $(gh --version | head -n1)"
  else
    log "WARNING: GitHub CLI install failed; issue-tracker skills will not work until gh is available"
  fi
  rm -rf "$tmp"
fi

# Rust cross-compile targets. The base Rust image ships only the host target,
# so the web and Android builds have nothing to link against until these are
# added. Listing all targets in one `rustup target add` keeps the step idempotent.
log "Installing Rust cross-compile targets (wasm32, Android)"
rustup target add wasm32-unknown-unknown aarch64-linux-android x86_64-linux-android || true

# cargo-ndk drives the Android NDK cross-compile in android/README.md. Guard so
# re-runs on an existing container do not pay the compile cost again.
if command -v cargo-ndk >/dev/null 2>&1; then
  log "cargo-ndk already present: $(cargo ndk --version 2>&1 | head -n1)"
else
  log "Installing cargo-ndk (compiles from source; may take several minutes)"
  cargo install cargo-ndk || true
fi

# wasm-bindgen CLI post-processes the wasm32 build in `npm run build:wasm`. The
# version must match the `wasm-bindgen` pin in the workspace Cargo.toml, or the
# CLI rejects the generated bindings, so derive it from Cargo.toml.
wasm_bindgen_version="$(grep -oP 'wasm-bindgen = "=\K[^"]+' Cargo.toml 2>/dev/null | head -n1)"
wasm_bindgen_version="${wasm_bindgen_version:-0.2.100}"
if command -v wasm-bindgen >/dev/null 2>&1 \
  && [ "$(wasm-bindgen --version | grep -oP 'wasm-bindgen \K[0-9.]+')" = "$wasm_bindgen_version" ]; then
  log "wasm-bindgen CLI already present: $(wasm-bindgen --version)"
else
  log "Installing wasm-bindgen-cli ${wasm_bindgen_version} (compiles from source; may take several minutes)"
  cargo install wasm-bindgen-cli --version "$wasm_bindgen_version" || true
fi

log "Installing OpenCode"
curl -fsSL https://opencode.ai/install | bash || true
export PATH="$HOME/.opencode/bin:$PATH"

# oh-my-opencode-slim: non-interactive install, bundled skills, no companion.
log "Installing oh-my-opencode-slim"
npx --yes oh-my-opencode-slim@latest install \
  --no-tui --skills=yes --companion=no --background-subagents=no || true

# mattpocock/skills: install every skill globally for OpenCode (.agents/skills).
log "Installing mattpocock/skills"
npx --yes skills@latest add mattpocock/skills \
  -g --agent opencode --skill '*' -y || true

# Workspace dependencies for `npm run dev` / `npm run build`. No lifecycle hook
# runs this, and the npm cache volume is writable only after the chown above.
log "Installing npm workspace dependencies"
npm install || true

log "Dev container setup complete"
