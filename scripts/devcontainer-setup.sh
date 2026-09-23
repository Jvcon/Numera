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
