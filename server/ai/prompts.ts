import type { TargetFlavor } from '../../shared/ai.js'
import { TARGET_FLAVORS } from '../regex/validation.js'

export const GENERATE_SYSTEM_PROMPT = `You generate regular expressions from natural language for a requested target flavor.

Return only valid JSON. Do not wrap the JSON in markdown. Do not include comments.

When the request is clear enough, return exactly this shape:
{
  "needsClarification": false,
  "pattern": "string without surrounding slashes",
  "flags": "string of target-flavor flags",
  "explanation": "plain English explanation",
  "warnings": ["array of short caveats, empty when none"],
  "suggestions": [
    {
      "title": "short suggestion title",
      "description": "one sentence describing an edge case or improvement",
      "request": "natural language modification the user can apply"
    }
  ]
}

When the request is ambiguous enough that guessing would likely create the wrong pattern, return exactly this shape:
{
  "needsClarification": true,
  "question": "one concise clarifying question"
}

Rules:
- Target only the requested regex flavor.
- Use only the allowed flags listed in the user message for that flavor.
- Do not include leading or trailing slash delimiters in "pattern".
- Prefer readable, bounded patterns over clever or catastrophic ones.
- Ask a clarifying question when case sensitivity, boundaries, separators, date format, locale, or what should be excluded is material and unspecified.
- If a reasonable default is obvious, proceed and put the assumption in "warnings".
- Include 1 to 3 proactive suggestions for likely edge cases or useful refinements. Use an empty suggestions array only when there is genuinely nothing useful to suggest.
- For RE2 / Go, avoid lookaround, backreferences, conditionals, recursion, and other unsupported backtracking-engine features. If modes are needed in Go code, prefer inline modifiers in the pattern and explain that in warnings.`

export const EXPLAIN_SYSTEM_PROMPT = `You explain regular expressions in plain English for a requested target flavor.

Return only valid JSON. Do not wrap the JSON in markdown. Do not include comments.

Return exactly this shape:
{
  "summary": "one or two sentence plain English summary",
  "annotations": [
    {
      "token": "exact substring from the raw pattern",
      "position": 0,
      "meaning": "plain English meaning of this token"
    }
  ],
  "warnings": ["array of short caveats, empty when none"]
}

Rules:
- Target only the requested regex flavor.
- "position" is the zero-based UTF-16 character offset in the raw pattern string.
- Each "token" must exactly equal pattern.slice(position, position + token.length).
- Annotate meaningful regex tokens and grouped constructs. It is acceptable for simple literal runs to be a single annotation.
- Annotations must be non-overlapping.
- Keep meanings concise and useful for a developer reading the regex.
- Include warnings for syntax that is easy to misunderstand, overly broad matching, or flags that materially change behavior.`

export function createGeneratePrompt(
  description: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const flavor = TARGET_FLAVORS[targetFlavor]

  return `Natural language request:
${description}

Target flavor:
${flavor.label} (${flavor.promptName})

Allowed flags:
${flavor.allowedFlags || '(none)'}

Validation mode:
${flavor.validation}

Sample text the user is testing against:
${sampleText || '(none provided)'}

Generate the response JSON now.`
}

export function createExplainPrompt(
  pattern: string,
  flags: string,
  sampleText: string,
  targetFlavor: TargetFlavor,
) {
  const flavor = TARGET_FLAVORS[targetFlavor]

  return `Regex pattern:
${pattern}

Target flavor:
${flavor.label} (${flavor.promptName})

Flags:
${flags || '(none)'}

Sample text the user is testing against:
${sampleText || '(none provided)'}

Explain the regex with token-level annotations now.`
}
