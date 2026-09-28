# Numera

Natural-language text cross-platform calculator.

## Agent skills

### Issue tracker

Issues and specs live as GitHub issues in `Jvcon/Numera`, driven via the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles map to the default labels: `needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` at the repo root plus `docs/adr/` for decisions. See `docs/agents/domain.md`.

### Interaction model

Navigation and interaction semantics are normative in `docs/interaction-model.md`
and its machine-readable form `contracts/interaction.json`. Visual tokens live in
`docs/design-spec.md`. Before changing any client navigation or UI, read the
interaction model and run the conformance tests; the review checklist is
`docs/agents/interaction-review.md`.
