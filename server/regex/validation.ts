import { spawnSync } from 'node:child_process'
import type { TargetFlavor } from '../../shared/ai.js'

export const TARGET_FLAVORS = {
  javascript: {
    label: 'JavaScript',
    promptName: 'JavaScript RegExp',
    allowedFlags: 'dgimsuvy',
    validation: 'native JavaScript RegExp',
  },
  python: {
    label: 'Python / re',
    promptName: 'Python re',
    allowedFlags: 'imsxau',
    validation: 'Python re.compile',
  },
  pcre: {
    label: 'PCRE',
    promptName: 'PCRE-compatible regular expression',
    allowedFlags: 'imsxuUADJ',
    validation: 'PCRE flag and structural checks',
  },
  're2-go': {
    label: 'RE2 / Go',
    promptName: 'RE2 syntax for Go regexp',
    allowedFlags: 'imsU',
    validation: 'RE2 compatibility checks',
  },
} as const satisfies Record<
  TargetFlavor,
  {
    allowedFlags: string
    label: string
    promptName: string
    validation: string
  }
>

export function normalizeTargetFlags(
  flags: string,
  targetFlavor: TargetFlavor,
) {
  const normalizedFlags = flags.replace(/\s/g, '')
  const seen = new Set<string>()
  const allowedFlags = TARGET_FLAVORS[targetFlavor].allowedFlags

  for (const flag of normalizedFlags) {
    if (!allowedFlags.includes(flag)) {
      throw new Error(
        `Unsupported ${TARGET_FLAVORS[targetFlavor].label} flag "${flag}".`,
      )
    }

    if (seen.has(flag)) {
      throw new Error(`Duplicate flag "${flag}" is not allowed.`)
    }

    seen.add(flag)
  }

  return normalizedFlags
}

function validateBalancedRegexShape(pattern: string) {
  let escaped = false
  let inCharacterClass = false
  const stack: number[] = []

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]

    if (escaped) {
      escaped = false
      continue
    }

    if (character === '\\') {
      escaped = true
      continue
    }

    if (character === '[' && !inCharacterClass) {
      inCharacterClass = true
      continue
    }

    if (character === ']' && inCharacterClass) {
      inCharacterClass = false
      continue
    }

    if (inCharacterClass) {
      continue
    }

    if (character === '(') {
      stack.push(index)
      continue
    }

    if (character === ')') {
      if (stack.length === 0) {
        throw new Error(`Unmatched closing parenthesis at index ${index}.`)
      }

      stack.pop()
    }
  }

  if (escaped) {
    throw new Error('Pattern ends with a dangling escape.')
  }

  if (inCharacterClass) {
    throw new Error('Pattern has an unterminated character class.')
  }

  if (stack.length > 0) {
    throw new Error(`Unmatched opening parenthesis at index ${stack[0]}.`)
  }
}

function validatePythonPattern(pattern: string, flags: string) {
  const script = `
import json
import re
import sys

payload = json.loads(sys.stdin.read())
flag_map = {
    "i": re.IGNORECASE,
    "m": re.MULTILINE,
    "s": re.DOTALL,
    "x": re.VERBOSE,
    "a": re.ASCII,
    "u": re.UNICODE,
}
compiled_flags = 0
for flag in payload["flags"]:
    compiled_flags |= flag_map[flag]
re.compile(payload["pattern"], compiled_flags)
`

  const result = spawnSync('python', ['-c', script], {
    encoding: 'utf8',
    input: JSON.stringify({ pattern, flags }),
    timeout: 3000,
  })

  if (result.error) {
    throw new Error('Python regex validation could not run.')
  }

  if (result.status !== 0) {
    throw new Error('Python re.compile rejected this pattern.')
  }
}

function validateRe2Pattern(pattern: string) {
  validateBalancedRegexShape(pattern)

  const unsupportedChecks = [
    { pattern: /\\[1-9]/, message: 'RE2 does not support backreferences.' },
    { pattern: /\(\?<?[=!]/, message: 'RE2 does not support lookaround.' },
    { pattern: /\\k<[^>]+>/, message: 'RE2 does not support named backreferences.' },
    { pattern: /\(\?>/, message: 'RE2 does not support atomic groups.' },
    { pattern: /\(\?R\)/, message: 'RE2 does not support recursive patterns.' },
    { pattern: /[*+?}]\+/, message: 'RE2 does not support possessive quantifiers.' },
  ]

  const failure = unsupportedChecks.find((check) => check.pattern.test(pattern))

  if (failure) {
    throw new Error(failure.message)
  }
}

export function validateTargetPattern(
  pattern: string,
  flags: string,
  targetFlavor: TargetFlavor,
) {
  const normalizedFlags = normalizeTargetFlags(flags, targetFlavor)

  switch (targetFlavor) {
    case 'javascript':
      new RegExp(pattern, normalizedFlags)
      break
    case 'python':
      validatePythonPattern(pattern, normalizedFlags)
      break
    case 'pcre':
      validateBalancedRegexShape(pattern)
      break
    case 're2-go':
      validateRe2Pattern(pattern)
      break
  }

  return normalizedFlags
}
