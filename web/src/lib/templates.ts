/**
 * Scenario templates — self-describing `.numr` documents plus the tiny
 * annotation parser that powers input/result highlighting.
 *
 * A template is plain source text. Lightweight `# @...` comments encode
 * metadata the editor uses without changing evaluation semantics:
 *
 *   # @money            file-level: render annotated results as currency
 *   # @input  <label>   the NEXT line is an input assignment
 *   # @result <label>   the NEXT line is a result assignment
 *
 * Everything else (ordinary comments, blank lines) is ignored. The
 * engine treats all of these as comments, so a template stays a valid
 * Numera document on its own.
 */

export interface Template {
  /** Unique id, e.g. `mortgage`. */
  id: string;
  /** Human-readable name, e.g. `Mortgage Calculator`. */
  name: string;
  /** One-line description. */
  description: string;
  /** `.numr` source text (self-describing, with annotation comments). */
  content: string;
}

export interface Annotations {
  /** True when the file-level `# @money` marker is present. */
  money: boolean;
  /** 1-based line numbers of input assignment lines (ascending). */
  inputs: number[];
  /** 1-based line numbers of result assignment lines (ascending). */
  results: number[];
  /** First input assignment line, or null when there are none. */
  firstInputLine: number | null;
}

/** Neutral annotations for empty/global documents. */
export const EMPTY_ANNOTATIONS: Annotations = {
  money: false,
  inputs: [],
  results: [],
  firstInputLine: null,
};

/**
 * Scan template source for `# @money` / `# @input` / `# @result`
 * annotations.
 *
 * A comment line is any line whose trimmed form starts with `#`. For an
 * `@input`/`@result` marker, the annotated line is the immediately
 * following line (`index + 2` in 1-based terms). Markers that trail the
 * document (no following line) are ignored.
 */
export function parseAnnotations(content: string): Annotations {
  const lines = content.split('\n');
  const inputs: number[] = [];
  const results: number[] = [];
  let money = false;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trimStart();
    if (!trimmed.startsWith('#')) continue;

    // Drop the leading `#` and surrounding whitespace.
    const body = trimmed.slice(1).trim();

    if (body === '@money') {
      money = true;
      continue;
    }

    const isInput = body === '@input' || body.startsWith('@input ');
    const isResult = body === '@result' || body.startsWith('@result ');
    if (!isInput && !isResult) continue;

    const nextLine = i + 2; // 1-based line number of the following line
    if (nextLine > lines.length) continue;
    if (isInput) {
      inputs.push(nextLine);
    } else {
      results.push(nextLine);
    }
  }

  return {
    money,
    inputs,
    results,
    firstInputLine: inputs.length > 0 ? inputs[0] : null,
  };
}

export interface InstantiatedTemplate {
  /** Workspace path, e.g. `Mortgage Calculator-1.numr`. */
  path: string;
  /** Display name, e.g. `Mortgage Calculator-1`. */
  displayName: string;
}

/**
 * Pick the first non-colliding `<name>-<n>.numr` path for a template,
 * starting at n = 1. `existingPaths` is treated as a set.
 */
export function instantiateTemplate(
  template: Template,
  existingPaths: string[],
): InstantiatedTemplate {
  const base = template.name;
  const existing = new Set(existingPaths);
  let n = 1;
  while (existing.has(`${base}-${n}.numr`)) {
    n += 1;
  }
  return { path: `${base}-${n}.numr`, displayName: `${base}-${n}` };
}

/**
 * Built-in templates (v1 ships exactly one: the mortgage calculator).
 *
 * NOTE: the formulas intentionally avoid `round()` — numr-core's `round`
 * is a single-argument integer rounding helper.
 */
export const BUILT_IN_TEMPLATES: Template[] = [
  {
    id: 'mortgage',
    name: 'Mortgage Calculator',
    description: 'Compare equal-payment and equal-principal monthly payments and total interest',
    content: `# @money
# Mortgage Calculator — equal payment vs equal principal

# @input Loan principal
loan = 3000000
# @input Annual rate
annual_rate = 3.1%
# @input Loan term (years)
years = 30

monthly_rate = annual_rate / 12
months = years * 12

# Equal payment (annuity)
# @result Monthly payment (equal payment)
monthly = loan * monthly_rate * (1 + monthly_rate)^months / ((1 + monthly_rate)^months - 1)
# @result Total interest (equal payment)
interest_annuity = monthly * months - loan
# @result Total repayment (equal payment)
total_annuity = monthly * months

# Equal principal
principal_per_month = loan / months
# @result First month payment (equal principal)
first_payment = principal_per_month + loan * monthly_rate
# @result Last month payment (equal principal)
last_payment = principal_per_month + principal_per_month * monthly_rate
# @result Total interest (equal principal)
interest_equal = months * monthly_rate * (loan + principal_per_month) / 2
# @result Total repayment (equal principal)
total_equal = loan + interest_equal
`,
  },
];
