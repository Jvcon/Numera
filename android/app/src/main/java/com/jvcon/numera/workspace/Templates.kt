package com.jvcon.numera.workspace

/**
 * Scenario templates — self-describing `.numr` documents plus the tiny
 * annotation parser that powers input/result highlighting.
 *
 * Faithful Kotlin port of `web/src/lib/templates.ts`. A template is plain
 * source text; lightweight `# @...` comments encode metadata the editor uses
 * without changing evaluation semantics (see [parseAnnotations]).
 */

/** A built-in scenario template. */
data class Template(
    /** Unique id, e.g. `mortgage`. */
    val id: String,
    /** Human-readable name, e.g. `Mortgage Calculator`. */
    val name: String,
    /** One-line description. */
    val description: String,
    /** `.numr` source text (self-describing, with annotation comments). */
    val content: String,
)

/**
 * Pick the first non-colliding `<name>-<n>.numr` path for a template,
 * starting at n = 1. `existingPaths` is treated as a set.
 *
 * Mirrors `instantiateTemplate` in `web/src/lib/templates.ts`; the caller
 * derives the display name from the path basename (minus `.numr`).
 */
fun instantiateTemplate(template: Template, existingPaths: Collection<String>): String {
    val existing = existingPaths.toSet()
    var n = 1
    while (existing.contains("${template.name}-$n.numr")) {
        n += 1
    }
    return "${template.name}-$n.numr"
}

/**
 * Built-in templates (v1 ships exactly one: the mortgage calculator).
 *
 * NOTE: the formulas intentionally avoid `round()` — numr-core's `round`
 * is a single-argument integer rounding helper.
 */
val BUILT_IN_TEMPLATES: List<Template> = listOf(
    Template(
        id = "mortgage",
        name = "Mortgage Calculator",
        description = "Compare equal-payment and equal-principal monthly payments and total interest",
        content = """# @money
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
""",
    ),
)
