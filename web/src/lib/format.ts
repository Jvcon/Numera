/**
 * Formatting helpers that turn engine `LineOutcome` values into
 * display strings honouring the user's `NumeraSettings` (locale,
 * precision and grouping preferences).
 *
 * `formatOutcome` reads the `kind` / `rawValue` fields that the
 * engine exposes on `LineOutcome`. They are accessed through a loose
 * structural shape rather than imported types so this module compiles
 * both before and after the engine lands those fields, and so legacy
 * outcomes (no `kind`) degrade gracefully to `outcome.display`.
 */

import type { LineOutcome } from './engine';
import type { NumeraSettings, Region } from './settings';

/** Value categories the engine reports via the `kind` field. */
type OutcomeKind = 'number' | 'date' | 'string' | 'empty' | 'error';

/** Loose structural view of the engine's `kind`/`rawValue` metadata. */
interface OutcomeMeta {
  kind: OutcomeKind | undefined;
  rawValue: unknown;
}

/**
 * Largest fraction-digit count we ever ask Intl for when full
 * precision is requested. Keeps a number's full double-precision
 * representation instead of Intl's default 3-digit truncation.
 */
const MAX_FULL_PRECISION_DIGITS = 20;

/** Upper bound accepted by `Intl.NumberFormat` for fraction digits. */
const INTL_MAX_FRACTION_DIGITS = 100;

/** Matches a pure `YYYY-MM-DD` date with no time component. */
const PURE_DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Matches a bare decimal literal (optionally signed / scientific). The
 * engine maps currency, percentage and unit-bearing values to
 * `kind: 'number'` too, but their `display` carries the symbol/unit
 * (`$1,800`, `20%`); only outcomes whose display is a *plain* number
 * may be re-formatted with Intl, so prefixed/suffixed values keep the
 * engine's original rendering.
 */
const PLAIN_NUMBER_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * Map a `Region` to a BCP-47 locale tag. `'system'` means "no
 * explicit locale" and maps to `undefined` so Intl uses the runtime's
 * default locale.
 */
export function regionToLocale(region: Region): string | undefined {
  return region === 'system' ? undefined : region;
}

function readOutcomeMeta(outcome: LineOutcome): OutcomeMeta {
  const maybeKind = (outcome as unknown as { kind?: unknown }).kind;
  const kind: OutcomeKind | undefined =
    maybeKind === 'number' ||
    maybeKind === 'date' ||
    maybeKind === 'string' ||
    maybeKind === 'empty' ||
    maybeKind === 'error'
      ? maybeKind
      : undefined;
  const rawValue = (outcome as unknown as { rawValue?: unknown }).rawValue;
  return { kind, rawValue };
}

/** Format a finite-safe number per the math settings. */
function formatNumber(value: number, math: NumeraSettings['calculator']['math']): string {
  const { region, resultPrecisionEnabled, precisionDigits, showGroupingSeparators } = math;
  const locale = regionToLocale(region);

  let minimumFractionDigits: number;
  let maximumFractionDigits: number;
  if (resultPrecisionEnabled) {
    const digits = Number.isFinite(precisionDigits)
      ? Math.min(INTL_MAX_FRACTION_DIGITS, Math.max(0, Math.trunc(precisionDigits)))
      : 0;
    minimumFractionDigits = digits;
    maximumFractionDigits = digits;
  } else {
    // Full precision: never truncate to Intl's default 3 fraction digits.
    minimumFractionDigits = 0;
    maximumFractionDigits = MAX_FULL_PRECISION_DIGITS;
  }

  const options: Intl.NumberFormatOptions = {
    useGrouping: showGroupingSeparators,
    minimumFractionDigits,
    maximumFractionDigits,
  };

  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // Defensive: a pathological option set must never break the editor.
    return new Intl.NumberFormat(locale, { useGrouping: showGroupingSeparators }).format(value);
  }
}

/**
 * Parse an ISO date string into a local-time `Date`.
 *
 * A pure `YYYY-MM-DD` value must NOT go through `new Date(str)` —
 * that parses as UTC midnight and shifts a day in negative-offset time
 * zones. Such values are parsed manually and built in local time.
 * Values carrying a time part are handed to `Date` directly.
 * Returns `null` for unparseable / invalid values.
 */
function parseDate(raw: string): Date | null {
  const trimmed = raw.trim();
  const pure = PURE_DATE_RE.exec(trimmed);

  if (pure !== null) {
    const year = Number(pure[1]);
    const month = Number(pure[2]); // 1-12
    const day = Number(pure[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) {
      return null;
    }
    // Start from the epoch, then set the calendar fields in *local*
    // time so the resulting date never shifts across time zones.
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    // Re-check fields to catch calendar rollover (e.g. Feb 31 → Mar 3).
    if (
      date.getFullYear() !== year ||
      date.getMonth() !== month - 1 ||
      date.getDate() !== day
    ) {
      return null;
    }
    return date;
  }

  const date = new Date(trimmed);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatDate(date: Date, region: Region): string {
  try {
    return new Intl.DateTimeFormat(regionToLocale(region)).format(date);
  } catch {
    return new Intl.DateTimeFormat().format(date);
  }
}

/**
 * Render an engine outcome as a display string using the given
 * settings. Every branch gracefully falls back to `outcome.display`
 * when `rawValue` is missing, null or unusable.
 */
export function formatOutcome(outcome: LineOutcome, settings: NumeraSettings): string {
  const { kind, rawValue } = readOutcomeMeta(outcome);
  const display = outcome.display;
  const math = settings?.calculator?.math;

  if (kind === 'number') {
    if (
      math !== undefined &&
      typeof rawValue === 'number' &&
      // Only re-format when the engine's display is a plain decimal;
      // currency/percentage/unit values keep their symbol/unit intact.
      PLAIN_NUMBER_RE.test(display.trim())
    ) {
      return formatNumber(rawValue, math);
    }
    return display;
  }

  if (kind === 'date') {
    if (math !== undefined && typeof rawValue === 'string') {
      const date = parseDate(rawValue);
      if (date !== null) {
        return formatDate(date, math.region);
      }
    }
    return display;
  }

  if (kind === 'string') {
    if (display !== '') {
      return display;
    }
    return typeof rawValue === 'string' ? rawValue : display;
  }

  // 'empty' and 'error' outcomes carry no rendered value — their
  // display string is empty by contract. Unknown/missing kinds also
  // fall back to whatever the engine already formatted.
  return display;
}
