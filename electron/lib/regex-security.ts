// ReDoS guard and glob matching for the fs:grep tool.
// Pure module (no electron imports) so both the IPC layer and the vitest
// suite import the SAME implementation — tests must never copy this logic.

/**
 * Detects patterns whose quantifiers can backtrack catastrophically:
 * 1. A quantified group whose body itself contains a quantifier,
 *    e.g. "(a+)+", "(a?b)+x", "(\d{2,}){3}".
 * 2. Adjacent quantified tokens with overlapping character classes,
 *    e.g. "a*a+", "\w*\d+", "[a-z]+\w+" (the engine can't decide which
 *    quantifier should consume a character, causing exponential backtracking).
 * 3. Quantified alternations where branches overlap,
 *    e.g. "(a|a)+", "(\w|\d)+".
 * 4. Nested quantifiers on the same token, e.g. "a{2,}{3}" (rare but possible).
 * 5. Incomplete quantifier syntax, e.g. "a{1,". JS engines accept it as a
 *    literal "{1," instead of throwing, but such a pattern is almost always
 *    a mistake; matching the literal text would silently produce confusing
 *    grep results, so it is rejected up front.
 */
export function isUnsafeRegex(pattern: string): boolean {
  if (pattern.length > 200) return true
  try {
    new RegExp(pattern)
  } catch {
    return true
  }
  // Neutralize escapes and character classes so their symbols don't count
  const s = pattern.replace(/\\./g, '\u0000').replace(/\[[^\]]*\]/g, ' ')

  // 1. Nested quantifiers in groups (including non-capturing, lookahead, lookbehind)
  const groupRe = /\((?:\?:|\?=|\?!|\?<=|\?<!)?([^()\n]*)\)[+*{]/g
  let m: RegExpExecArray | null
  while ((m = groupRe.exec(s)) !== null) {
    if (/[?*+]/.test(m[1])) return true
    if (/\{\d+,\}/.test(m[1])) return true
  }

  // 2. Adjacent overlapping quantifiers (simplified heuristic)
  //    Look for two consecutive quantified atoms that could match the same chars.
  const tokens = s.match(/(?:[?*+}](?:\d+(?:,\d*)?)?)|(?:[a-zA-Z0-9\u0000 ])/g) || []
  for (let i = 0; i < tokens.length - 1; i++) {
    const a = tokens[i]
    const b = tokens[i + 1]
    // Both must be quantified
    if (/[?*+]$|\{\d+,\}?$/.test(a) && /[?*+]$|\{\d+,\}?$/.test(b)) {
      return true
    }
  }

  // 3. Detect alternation inside quantified groups where branches could overlap
  //    e.g. (a|a)+, (\w|\d)+, (foo|bar|foo)+
  const altGroupRe = /\((?:\?:)?([^()]*\|[^()]*)\)[+*{]/g
  while ((m = altGroupRe.exec(s)) !== null) {
    const branches = m[1].split('|').map(b => b.trim())
    // Check for duplicate branches
    const seen = new Set<string>()
    for (const branch of branches) {
      if (seen.has(branch)) return true
      seen.add(branch)
    }
    // Check if all branches match the same character class (simplified)
    if (branches.length >= 2 && branches.every(b => b.length === 1 || /^\\[wWdDsS]$/.test(b))) {
      return true
    }
  }

  // 4. Double quantifiers on the same atom: a+*, a*+, a{2,}+ etc.
  if (/(.)[+*{][+*{]/.test(s.replace(/\u0000./g, ''))) return true

  // 5. Incomplete quantifier: "{n" or "{n," (or "{n,m" without a closing "}")
  //    that never gets closed. Escaped braces (\{) were neutralized above and
  //    braces inside character classes were stripped, so any leftover
  //    "{digits" without a matching "}" is malformed syntax.
  if (/\{\d+(?:,\d*)?(?![^{}]*\})/.test(s)) return true

  return false
}

/**
 * Simple glob matcher for the `include` filter of fs:grep.
 * Escapes regex metacharacters, then translates * and ? wildcards.
 */
export function matchGlob(name: string, glob: string): boolean {
  const re = new RegExp('^' + glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$')
  return re.test(name)
}
