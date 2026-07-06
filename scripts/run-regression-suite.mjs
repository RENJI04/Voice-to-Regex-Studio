import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const fixtureUrl = new URL('../src/fixtures/regexRegressionFixtures.json', import.meta.url)
const fixtureSet = JSON.parse(await readFile(fixtureUrl, 'utf8'))
const fixturesById = new Map(
  fixtureSet.fixtures.map((fixture) => [fixture.id, fixture]),
)

const generatedOverrides = await readGeneratedOverrides()

const regressionCases = [
  {
    name: 'Hashtags',
    prompt: 'find all hashtags',
    fallbackPattern: '#[A-Za-z0-9_]+',
    flags: 'g',
    expectations: [
      {
        fixtureId: 'hashtag-and-social',
        include: ['#regex', '#AI2026'],
      },
      {
        fixtureId: 'emoji-graphemes',
        include: ['#regex'],
      },
      {
        fixtureId: 'empty-string',
        matchCount: 0,
      },
    ],
    samples: [
      {
        include: ['#release_2026'],
        text: 'ship #release_2026 today, ignore a lone #',
      },
    ],
  },
  {
    name: 'ISO dates',
    prompt: 'match ISO dates like 2026-07-07',
    fallbackPattern: '\\b\\d{4}-\\d{2}-\\d{2}\\b',
    flags: 'g',
    expectations: [
      {
        fixtureId: 'dates-and-numbers',
        exclude: ['07/07/2026', '2026/7/7'],
        include: ['2026-07-07'],
      },
      {
        fixtureId: 'empty-string',
        matchCount: 0,
      },
    ],
  },
  {
    name: 'Email addresses',
    prompt: 'match simple email addresses',
    fallbackPattern: '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,}',
    flags: 'g',
    expectations: [
      {
        fixtureId: 'email-url-noise',
        exclude: ['dev@@example'],
        include: ['dev@example.com'],
      },
      {
        fixtureId: 'hashtag-and-social',
        include: ['email@example.com'],
      },
    ],
  },
  {
    name: 'Capitalized names',
    prompt: 'match capitalized first names',
    fallbackPattern: '\\b[A-Z][a-z]+\\b',
    flags: 'g',
    samples: [
      {
        exclude: ['widget', '123'],
        include: ['Alice', 'Bob'],
        text: 'Alice and Bob reviewed widget-123.',
      },
    ],
  },
  {
    name: 'Double quoted strings',
    prompt: 'match double quoted strings on one line',
    fallbackPattern: '"[^"\\r\\n]*"',
    flags: 'g',
    expectations: [
      {
        fixtureId: 'quoted-strings',
        exclude: ["'single quoted'"],
        include: ['"quoted value"'],
      },
    ],
  },
]

const failures = []

for (const regressionCase of regressionCases) {
  const generated = generatedOverrides.get(regressionCase.prompt)
  const pattern = generated?.pattern ?? regressionCase.fallbackPattern
  const flags = generated?.flags ?? regressionCase.flags
  const source = generated ? 'override' : 'baseline'
  const caseFailures = runRegressionCase(regressionCase, pattern, flags)

  if (caseFailures.length > 0) {
    failures.push(...caseFailures)
    console.log(`FAIL ${regressionCase.name} (${source})`)
    for (const failure of caseFailures) {
      console.log(`  - ${failure}`)
    }
  } else {
    console.log(`PASS ${regressionCase.name} (${source})`)
  }
}

console.log(
  `\nChecked ${regressionCases.length} prompt behavior cases against ${fixtureSet.fixtures.length} curated fixtures.`,
)

if (failures.length > 0) {
  console.log(`${failures.length} regression expectation(s) failed.`)
  process.exitCode = 1
}

function runRegressionCase(regressionCase, pattern, flags) {
  const failures = []

  try {
    new RegExp(pattern, toGlobalFlags(flags))
  } catch (error) {
    return [
      `${regressionCase.prompt}: pattern did not compile in JavaScript: ${
        error instanceof Error ? error.message : String(error)
      }`,
    ]
  }

  for (const expectation of regressionCase.expectations ?? []) {
    const fixture = fixturesById.get(expectation.fixtureId)

    if (!fixture) {
      failures.push(`Missing fixture "${expectation.fixtureId}".`)
      continue
    }

    failures.push(
      ...checkTextExpectations({
        expectation,
        flags,
        label: fixture.label,
        pattern,
        text: fixture.text,
      }),
    )
  }

  for (const sample of regressionCase.samples ?? []) {
    failures.push(
      ...checkTextExpectations({
        expectation: sample,
        flags,
        label: `sample for "${regressionCase.prompt}"`,
        pattern,
        text: sample.text,
      }),
    )
  }

  for (const fixture of fixtureSet.fixtures) {
    const matches = collectMatches(pattern, flags, fixture.text)

    if (matches.some((match) => match === '')) {
      failures.push(
        `${regressionCase.prompt}: produced an empty match on "${fixture.label}".`,
      )
      break
    }
  }

  return failures
}

function checkTextExpectations({ expectation, flags, label, pattern, text }) {
  const failures = []
  const matches = collectMatches(pattern, flags, text)

  for (const expected of expectation.include ?? []) {
    if (!matches.includes(expected)) {
      failures.push(
        `${label}: expected to match "${expected}", got [${matches.join(', ')}].`,
      )
    }
  }

  for (const rejected of expectation.exclude ?? []) {
    if (matches.includes(rejected)) {
      failures.push(`${label}: should not have matched "${rejected}".`)
    }
  }

  if (
    typeof expectation.matchCount === 'number' &&
    matches.length !== expectation.matchCount
  ) {
    failures.push(
      `${label}: expected ${expectation.matchCount} matches, got ${matches.length}.`,
    )
  }

  return failures
}

function collectMatches(pattern, flags, text) {
  const regex = new RegExp(pattern, toGlobalFlags(flags))
  const matches = []
  let match

  while ((match = regex.exec(text)) !== null) {
    matches.push(match[0])

    if (match[0] === '') {
      regex.lastIndex += 1
    }

    if (matches.length > 500) {
      break
    }
  }

  return matches
}

function toGlobalFlags(flags) {
  const allowedFlags = new Set(['d', 'i', 'm', 's', 'u', 'v', 'y'])
  const outputFlags = new Set()

  for (const flag of flags) {
    if (allowedFlags.has(flag) && flag !== 'd' && flag !== 'y') {
      outputFlags.add(flag)
    }
  }

  outputFlags.add('g')

  return [...outputFlags].join('')
}

async function readGeneratedOverrides() {
  const inputFlagIndex = process.argv.indexOf('--input')

  if (inputFlagIndex === -1) {
    return new Map()
  }

  const inputPath = process.argv[inputFlagIndex + 1]

  if (!inputPath) {
    throw new Error('Expected a JSON file path after --input.')
  }

  const inputUrl = pathToFileURL(resolve(inputPath))
  const rawInput = JSON.parse(await readFile(inputUrl, 'utf8'))
  const generatedCases = Array.isArray(rawInput) ? rawInput : rawInput.cases

  if (!Array.isArray(generatedCases)) {
    throw new Error('Regression override input must be an array or { "cases": [] }.')
  }

  return new Map(
    generatedCases
      .filter(
        (item) =>
          item &&
          typeof item.prompt === 'string' &&
          typeof item.pattern === 'string' &&
          typeof item.flags === 'string',
      )
      .map((item) => [
        item.prompt,
        {
          flags: item.flags,
          pattern: item.pattern,
        },
      ]),
  )
}
