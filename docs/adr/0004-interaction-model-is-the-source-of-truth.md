# The interaction model is the source of truth; web is a reference implementation

Navigation and interaction semantics are normative in `docs/interaction-model.md`
and its machine-readable form `contracts/interaction.json`. `docs/design-spec.md`
is demoted to a **visual token specification** (color, typography, shape,
elevation, motion, density, placement geometry). Every client — web, Android,
and eventually iOS — is a port of the interaction model, not of another client.

`design-spec.md` had named web's CSS and component sources as the "source of
truth" and web as "the reference for the Android client". That framing produced
the drift this decision corrects: because web is itself still growing (Settings,
Command, templates, encryption), and because its DOM structure differs from a
native toolkit, Android re-invented navigation — a duplicated Globals entry, a
back arrow where web used Close, an inline file filter where web used an
overlay. Web is now a **reference implementation** of the model: useful to
consult, but not authoritative.

## Consequences

- New navigation behavior changes `docs/interaction-model.md` and
  `contracts/interaction.json` **first**, then the clients. A client change that
  contradicts the fixture is a bug.
- A pure navigation-model module per platform reads the fixture, and each
  platform's UI tests assert against that model, so drift fails that platform's
  existing test command.
- `design-spec.md` cross-references the interaction model and must not restate
  or contradict its rules; its §13 retains only adaptive *geometry*.
- iOS (deferred) will read the same fixture rather than transcribing web.
- Vocabulary is shared through `CONTEXT.md`; terms listed under _Avoid_ are
  forbidden as synonyms in code, docs, and test names.
