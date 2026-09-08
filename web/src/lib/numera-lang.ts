/**
 * Numera language — minimal CodeMirror 6 StreamLanguage that highlights:
 *   - line comments (`#`, `//`)
 *   - numbers (int, decimal, currency-prefixed, percentage)
 *   - the `global.X` namespace as a single token
 *   - bare identifiers
 *
 * The grammar is intentionally narrow; the goal is to give users
 * colour cues without committing to a full parser. Per-line evaluation
 * lives in the editor's decoration plugin, not here.
 */

import { StreamLanguage } from '@codemirror/language';

interface NumeraState {
  inComment: boolean;
}

const NUMERA_KEYWORDS: ReadonlySet<string> = new Set([
  'in',
  'to',
  'of',
]);

export const numeraLanguage = StreamLanguage.define<NumeraState>({
  startState(): NumeraState {
    return { inComment: false };
  },

  token(stream, state): string | null {
    if (state.inComment) {
      stream.skipToEnd();
      state.inComment = false;
      return 'lineComment';
    }

    if (stream.eatSpace()) return null;

    const ch = stream.next();
    if (ch === undefined) return null;

    // Line comments
    if (ch === '#' || (ch === '/' && stream.peek() === '/')) {
      stream.skipToEnd();
      return 'lineComment';
    }

    // Currency prefix
    if (ch === '$' || ch === '€' || ch === '£' || ch === '¥') {
      if (stream.match(/[\d,.]+/, false)) {
        stream.match(/[\d,.]+/);
        return 'number';
      }
      return null;
    }

    // Numbers / percentages
    if (/\d/.test(ch)) {
      stream.match(/[\d,.]*/);
      if (stream.peek() === '%') {
        stream.next();
      }
      return 'number';
    }

    // Identifier / keyword
    if (/[A-Za-z_]/.test(ch)) {
      let word = ch;
      while (true) {
        const next = stream.peek();
        if (next === undefined || !/[A-Za-z0-9_]/.test(next)) break;
        word += stream.next();
      }

      // `global.<ident>` namespace marker.
      if (word === 'global' && stream.peek() === '.') {
        stream.next();
        let ident = '';
        while (true) {
          const next = stream.peek();
          if (next === undefined || !/[A-Za-z0-9_]/.test(next)) break;
          ident += stream.next();
        }
        return 'namespace';
      }

      if (NUMERA_KEYWORDS.has(word.toLowerCase())) {
        return 'keyword';
      }
      return 'variableName';
    }

    // Operators
    if ('+-*/^=<>()[]{}.,%'.includes(ch)) {
      return 'operator';
    }

    return null;
  },

  languageData: {
    commentTokens: { line: '#' },
    autocomplete: undefined,
  },
});
