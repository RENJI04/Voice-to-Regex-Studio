type RegexWorkerRequest = {
  flags: string
  maxMatches: number
  pattern: string
  sampleText: string
}

type RegexWorkerMatch = {
  id: string
  index: number
  end: number
  text: string
  groups: Array<string | undefined>
  namedGroups: Record<string, string | undefined>
  isZeroWidth: boolean
}

type RegexWorkerResponse =
  | {
      matches: RegexWorkerMatch[]
      truncated: boolean
      type: 'success'
    }
  | {
      error: string
      type: 'error'
    }

self.addEventListener('message', (event: MessageEvent<RegexWorkerRequest>) => {
  const { flags, maxMatches, pattern, sampleText } = event.data

  try {
    const regex = new RegExp(pattern, flags)
    const matches: RegexWorkerMatch[] = []
    let truncated = false
    let rawMatch: RegExpExecArray | null

    while ((rawMatch = regex.exec(sampleText)) !== null) {
      const isZeroWidth = rawMatch[0].length === 0
      const end = rawMatch.index + rawMatch[0].length

      matches.push({
        id: `${rawMatch.index}-${matches.length}`,
        index: rawMatch.index,
        end,
        text: rawMatch[0],
        groups: rawMatch.slice(1),
        namedGroups: rawMatch.groups ?? {},
        isZeroWidth,
      })

      if (matches.length >= maxMatches) {
        truncated = true
        break
      }

      if (isZeroWidth) {
        regex.lastIndex += 1
      }
    }

    self.postMessage({
      matches,
      truncated,
      type: 'success',
    } satisfies RegexWorkerResponse)
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error ? error.message : 'Unable to evaluate this pattern.',
      type: 'error',
    } satisfies RegexWorkerResponse)
  }
})

export {}
