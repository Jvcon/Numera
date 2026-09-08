import { LitElement, html, css } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers, highlightActiveLine, highlightActiveLineGutter, keymap } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { numeraLanguage } from '../lib/numera-lang';
import { numeraSyntax, numeraTheme } from '../lib/editor-theme';
import { outcomeDecorations, setOutcomes } from '../lib/editor-decorations';
import type { WorkspaceStore, WorkspaceFile } from '../lib/workspace';

@customElement('numera-editor')
export class NumeraEditor extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      height: 100%;
      overflow: hidden;
      background-color: var(--md-sys-color-surface);
    }

    .editor-host {
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .empty {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: var(--md-sys-spacing-inline);
      height: 100%;
      padding: var(--md-sys-spacing-section);
      text-align: center;
      color: var(--md-sys-color-on-surface-variant);
    }

    .empty-icon {
      color: var(--md-sys-color-on-surface-variant);
      opacity: 0.5;
      margin-bottom: var(--md-sys-spacing-inline-tight);
    }

    .empty-title {
      font-family: var(--md-sys-typescale-title-medium-font);
      font-size: var(--md-sys-typescale-title-medium-size);
      line-height: var(--md-sys-typescale-title-medium-line);
      font-weight: var(--md-sys-typescale-title-medium-weight);
      letter-spacing: var(--md-sys-typescale-title-medium-tracking);
      color: var(--md-sys-color-on-surface);
    }

    .empty-body {
      max-width: 24rem;
      font-family: var(--md-sys-typescale-body-medium-font);
      font-size: var(--md-sys-typescale-body-medium-size);
      line-height: var(--md-sys-typescale-body-medium-line);
      font-weight: var(--md-sys-typescale-body-medium-weight);
      letter-spacing: var(--md-sys-typescale-body-medium-tracking);
    }
  `;

  @property({ attribute: false }) store: WorkspaceStore | null = null;

  @state() private currentFile: WorkspaceFile | null = null;

  @state() private editingGlobals = false;

  private view: EditorView | null = null;
  private unsubscribe: (() => void) | null = null;
  private currentOutcomes: readonly import('../lib/engine').LineOutcome[] = [];
  private currentIdentity: string | null = null;

  connectedCallback(): void {
    super.connectedCallback();
    if (this.store) {
      this.subscribe(this.store);
    }
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.view?.destroy();
    this.view = null;
  }

  updated(changed: Map<string, unknown>): void {
    if (changed.has('store') && this.store) {
      this.unsubscribe?.();
      this.subscribe(this.store);
    }
  }

  private subscribe(store: WorkspaceStore) {
    this.unsubscribe = store.subscribe((state) => {
      const previousIdentity = this.currentIdentity;
      const previousOutcomes = this.currentOutcomes;

      const editingGlobals = state.editingTarget === 'globals';
      const activeFile =
        state.files.find((f) => f.id === state.activeFileId) ?? null;
      // Display identity: the globals document, or the active file. The
      // CodeMirror doc is only swapped when this identity changes, so
      // snapshot updates while the user is typing never reset the doc.
      const identity = editingGlobals
        ? 'globals'
        : (activeFile?.id ?? null);
      const displayContent = editingGlobals
        ? state.globalsContent
        : (activeFile?.content ?? '');

      this.editingGlobals = editingGlobals;
      this.currentFile = activeFile;
      this.currentIdentity = identity;
      this.currentOutcomes = state.outcomes;

      const view = this.view;
      const host = this.renderRoot.querySelector<HTMLDivElement>('.editor-host');
      if (!host) return;

      // Empty-state placeholder: only when not editing globals and there
      // is no active file.
      if (!editingGlobals && !activeFile) {
        view?.destroy();
        this.view = null;
        return;
      }

      if (!view) {
        this.view = new EditorView({
          state: this.buildState(displayContent),
          parent: host,
          dispatch: this.dispatch,
        });
        return;
      }

      // Swap the doc when the display target changed OR the store's
      // content diverges from what we're showing. The latter happens on
      // hydrate: the editor mounts on the default fixtures before the
      // async IndexedDB read resolves, and the file id doesn't change,
      // so reacting to the identity alone would leave stale content on
      // screen. During normal typing the editor's doc already matches
      // the store (setActiveContent runs after view.update), so this
      // extra check never resets the cursor mid-keystroke.
      const currentDoc = view.state.doc.toString();
      if (previousIdentity !== identity || currentDoc !== displayContent) {
        view.dispatch({
          changes: { from: 0, to: currentDoc.length, insert: displayContent },
        });
      }

      // Push the latest outcomes into editor state so the gutter's
      // `lineMarkerChange` re-renders the result column.
      if (previousOutcomes !== state.outcomes) {
        view.dispatch({
          effects: setOutcomes.of({ outcomes: state.outcomes }),
        });
      }
    });
  }

  private buildState(content: string): EditorState {
    const engine = this.store?.getEngine();
    return EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        history(),
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        numeraLanguage,
        numeraSyntax,
        numeraTheme,
        EditorView.lineWrapping,
        outcomeDecorations((line) => engine?.expressionPrefixUtf16Len(line) ?? line.length),
      ],
    });
  }

  private dispatch = (tr: import('@codemirror/state').Transaction): void => {
    if (!this.view || !this.store) return;
    this.view.update([tr]);
    if (tr.docChanged) {
      const text = tr.state.doc.toString();
      this.store.setActiveContent(text);
    }
  };

  render() {
    if (!this.editingGlobals && !this.currentFile) {
      return html`
        <div class="empty">
          <div class="empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="40" height="40" fill="currentColor">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 7V3.5L18.5 9H13z" />
            </svg>
          </div>
          <div class="empty-title">No file selected</div>
          <div class="empty-body">
            Pick a file from the sidebar, or press Ctrl+K to open the command palette.
          </div>
        </div>
      `;
    }

    return html`<div class="editor-host"></div>`;
  }
}
