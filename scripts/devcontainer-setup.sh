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

log "Dev container setup complete"
