import fixtureData from '../fixtures/regexRegressionFixtures.json'

type FixtureTargetFlavor = 'javascript' | 'python' | 'pcre' | 're2-go'

type RegexFixture = {
  id: string
  label: string
  text: string
  tags: string[]
  flavors: FixtureTargetFlavor[]
  maxMatchesBeforeWarning?: number
  surprisingIfMatched?: string
}

type FixtureFile = {
  version: number
  fixtures: RegexFixture[]
}

export type FixtureAuditSource = 'explanation' | 'generation'

export type FixtureAuditFinding = {
  details: string
  fixtureId: string
  fixtureLabel: string
  matchCount: number
  matchPreview: string
  samplePreview: string
  severity: 'info' | 'warning'
  title: string
}

export type FixtureAuditReport = {
  checkedAt: number
  findings: FixtureAuditFinding[]
  fixturesChecked: number
  skippedReason?: string
  source: FixtureAuditSource
  status: 'passed' | 'skipped' | 'warning'
  targetFlavor: FixtureTargetFlavor
}

const FIXTURE_SET = fixtureData as FixtureFile
const ALWAYS_RELEVANT_TAGS = new Set([
  'edge-whitespace',
  'emoji',
  'empty',
  'long',
  'stress',
  'unicode',
])
const JS_AUDIT_FLAGS = new Set(['i', 'm', 's', 'u', 'v'])
const MAX_AUDIT_MATCHES = 250
const MAX_VISIBLE_FINDINGS = 8

export function auditPatternAgainstFixtures({
  flags,
  pattern,
  source,
  targetFlavor,
}: {
  flags: string
  pattern: string
  source: FixtureAuditSource
  targetFlavor: FixtureTargetFlavor
}): FixtureAuditReport {
  const auditFlags = getJavaScriptAuditFlags(flags)
  const patternTags = inferPatternTags(pattern, flags)
  const relevantFixtures = FIXTURE_SET.fixtures.filter((fixture) =>
    isRelevantFixture(fixture, patternTags, targetFlavor),
  )

  try {
    // Compile once so non-JS-compatible patterns produce one clear skip reason.
    new RegExp(pattern, auditFlags)
  } catch (error) {
    return {
      checkedAt: Date.now(),
      findings: [],
      fixturesChecked: 0,
      skippedReason:
        error instanceof Error
          ? `Fixture audit skipped because the pattern cannot run in the browser preview engine: ${error.message}`
          : 'Fixture audit skipped because the pattern cannot run in the browser preview engine.',
      source,
      status: 'skipped',
      targetFlavor,
    }
  }

  const findings = relevantFixtures
    .flatMap((fixture) =>
      buildFixtureFindings(
        fixture,
        collectMatches(pattern, auditFlags, fixture.text),
      ),
    )
    .slice(0, MAX_VISIBLE_FINDINGS)

  return {
    checkedAt: Date.now(),
    findings,
    fixturesChecked: relevantFixtures.length,
    source,
    status: findings.length > 0 ? 'warning' : 'passed',
    targetFlavor,
  }
}

function getJavaScriptAuditFlags(flags: string) {
  const uniqueFlags = new Set<string>()

  for (const flag of flags) {
    if (JS_AUDIT_FLAGS.has(flag)) {
      uniqueFlags.add(flag)
    }
  }

  uniqueFlags.add('g')

  return [...uniqueFlags].join('')
}

function inferPatternTags(pattern: string, flags: string) {
  const tags = new Set<string>()

  if (/\\[dD]/.test(pattern) || /\[[^\]]*0-9/.test(pattern)) {
    tags.add('numeric')
    tags.add('date')
  }

  if (/\\[sS]/.test(pattern) || pattern.includes('\\t')) {
    tags.add('whitespace')
    tags.add('edge-whitespace')
  }

  if (/\\[wW]/.test(pattern) || pattern.includes('\\b')) {
    tags.add('word')
    tags.add('boundary')
  }

  if (pattern.includes('(?=') || pattern.includes('(?!')) {
    tags.add('lookahead')
  }

  if (pattern.includes('(?<=') || pattern.includes('(?<!')) {
    tags.add('lookbehind')
  }

  if (pattern.includes('\\p{') || flags.includes('u') || flags.includes('v')) {
    tags.add('unicode')
    tags.add('emoji')
  }

  if (pattern.includes('#')) {
    tags.add('hashtag')
  }

  if (pattern.includes('@')) {
    tags.add('email')
    tags.add('social')
  }

  if (pattern.includes('"') || pattern.includes("'") || pattern.includes('`')) {
    tags.add('quotes')
  }

  if (
    pattern.includes('.*') ||
    pattern.includes('.+') ||
    pattern.includes('[^]') ||
    pattern.includes('[\\s\\S]')
  ) {
    tags.add('long')
    tags.add('stress')
  }

  if (/\([^)]*[+*][^)]*\)[+*{]/.test(pattern)) {
    tags.add('nested-quantifier')
    tags.add('stress')
  }

  return tags
}

function isRelevantFixture(
  fixture: RegexFixture,
  patternTags: Set<string>,
  targetFlavor: FixtureTargetFlavor,
) {
  if (!fixture.flavors.includes(targetFlavor)) {
    return false
  }

  return fixture.tags.some(
    (tag) => ALWAYS_RELEVANT_TAGS.has(tag) || patternTags.has(tag),
  )
}

type CollectedMatches = {
  emptyMatchCount: number
  firstMatch: string
  hasZeroWidth: boolean
  matchCount: number
  truncated: boolean
}

function collectMatches(
  pattern: string,
  flags: string,
  text: string,
): CollectedMatches {
  const regex = new RegExp(pattern, flags)
  let match: RegExpExecArray | null
  let matchCount = 0
  let emptyMatchCount = 0
  let firstMatch = ''
  let hasZeroWidth = false
  let truncated = false

  while ((match = regex.exec(text)) !== null) {
    matchCount += 1

    if (firstMatch === '') {
      firstMatch = match[0]
    }

    if (match[0] === '') {
      emptyMatchCount += 1
      hasZeroWidth = true
      regex.lastIndex += 1
    }

    if (matchCount >= MAX_AUDIT_MATCHES) {
      truncated = true
      break
    }
  }

  return {
    emptyMatchCount,
    firstMatch,
    hasZeroWidth,
    matchCount,
    truncated,
  }
}

function buildFixtureFindings(
  fixture: RegexFixture,
  matches: CollectedMatches,
) {
  if (matches.matchCount === 0) {
    return []
  }

  const notes = new Set<string>()

  if (fixture.surprisingIfMatched) {
    notes.add(fixture.surprisingIfMatched)
  }

  if (matches.emptyMatchCount > 0 && fixture.id !== 'empty-string') {
    notes.add(
      'This pattern creates empty or zero-width matches on non-empty fixture text.',
    )
  }

  const maxMatchesBeforeWarning = fixture.maxMatchesBeforeWarning ?? 20

  if (matches.matchCount > maxMatchesBeforeWarning || matches.truncated) {
    notes.add(
      `This fixture produced ${matches.matchCount}${matches.truncated ? '+' : ''} matches, which may indicate an overly broad pattern.`,
    )
  }

  if (fixture.tags.includes('long') && matches.firstMatch.length > 80) {
    notes.add(
      'The first match is very long; confirm the pattern is not swallowing more text than intended.',
    )
  }

  return [...notes].map((details, index): FixtureAuditFinding => ({
    details,
    fixtureId: fixture.id,
    fixtureLabel: fixture.label,
    matchCount: matches.matchCount,
    matchPreview: formatPreview(matches.firstMatch),
    samplePreview: formatPreview(fixture.text),
    severity: 'warning',
    title:
      index === 0
        ? `${fixture.label} matched`
        : `${fixture.label} needs review`,
  }))
}

function formatPreview(value: string) {
  if (value === '') {
    return '(empty string)'
  }

  const visible = value
    .replace(/\r/g, '\\r')
    .replace(/\n/g, '\\n\n')
    .replace(/\t/g, '\\t')

  return visible.length > 180 ? `${visible.slice(0, 180)}...` : visible
}
