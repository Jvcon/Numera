# Interaction Review Checklist

Use when reviewing any change that touches client navigation or top-bar chrome.
The contract is `docs/interaction-model.md` + `contracts/interaction.json`;
`docs/design-spec.md` is visual-only. A violation here is blocking.

## Model

- [ ] Any new surface has a `kind` (destination / editing target / overlay) and
      an entry in `contracts/interaction.json`.
- [ ] `globals` and `draft` are **not** rendered as file-list, drawer, or
      Command-result rows.
- [ ] A non-list editing target's exit is `exit-editing-target` and returns to
      the previously active `file`.

## Top bar

- [ ] The leading slot exposes **at most one** affordance (never hamburger +
      exit).
- [ ] Leading is exactly `menu` (drawer present), `none`, or `up` (destination).
- [ ] `exit-editing-target` is a **trailing** action, icon **Close (X)** — not
      an up/back arrow, not leading.
- [ ] Trailing actions match `topBar.trailing` for the active editing target.

## Back

- [ ] A back gesture resolves in the contract order:
      `dismiss-overlay → close-drawer → exit-editing-target → root-exit`.
- [ ] No step is skipped (e.g. an editing target is not exited while an overlay
      is open).
- [ ] Platform differences are limited to the **input** that triggers an action;
      the action, slot, icon, and precedence are identical across clients.

## Command

- [ ] The surface is named **Command** — no `palette`, `command-palette`, or
      `search` in UI strings, identifiers, events, or test names.
- [ ] Entries are `fab:command` and `keybinding:cmd+k`.
- [ ] No inline file-filter is presented as, or named, Command.

## Evidence

- [ ] `interaction.json` is updated **before** the client code, if behavior
      changes.
- [ ] The platform navigation-model test reads the fixture and passes.
- [ ] Web `npm test` / Android `./gradlew test` green.

If a rule genuinely does not fit, change `docs/interaction-model.md` and
`contracts/interaction.json` first, then the clients.
