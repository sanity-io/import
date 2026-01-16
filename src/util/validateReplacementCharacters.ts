const REPLACEMENT_CHAR = '\uFFFD'

export class ReplacementCharError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ReplacementCharError'
  }
}

/**
 * Check if a string contains a Unicode replacement character (U+FFFD).
 * Returns the index of the first occurrence, or null if not found.
 */
export function checkStringForReplacementChar(str: string): number | null {
  const index = str.indexOf(REPLACEMENT_CHAR)
  return index === -1 ? null : index
}

/**
 * Recursively search an object for strings containing U+FFFD.
 * Returns the path to the first occurrence, or null if not found.
 */
export function findReplacementCharInObject(obj: unknown, currentPath: string = ''): string | null {
  if (obj === null || obj === undefined) {
    return null
  }

  if (typeof obj === 'string') {
    const index = checkStringForReplacementChar(obj)
    if (index === null) {
      return null
    }
    return currentPath
  }

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const result = findReplacementCharInObject(obj[i], `${currentPath}[${i}]`)
      if (result !== null) {
        return result
      }
    }
    return null
  }

  if (typeof obj === 'object') {
    for (const key of Object.keys(obj)) {
      // Check the key itself for replacement characters
      if (checkStringForReplacementChar(key) !== null) {
        const keyPath = currentPath ? `${currentPath}["${key}"]` : `["${key}"]`
        return keyPath
      }

      // Build the path for this key
      const needsBracketNotation = !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(key)
      let keyPath: string
      if (!currentPath) {
        keyPath = key
      } else if (needsBracketNotation) {
        keyPath = `${currentPath}["${key}"]`
      } else {
        keyPath = `${currentPath}.${key}`
      }

      const result = findReplacementCharInObject((obj as Record<string, unknown>)[key], keyPath)
      if (result !== null) {
        return result
      }
    }
  }

  return null
}

/**
 * Validate that a raw NDJSON line doesn't contain U+FFFD.
 * Returns an error message if found, or null if clean.
 */
export function validateLineForReplacementChar(line: string, lineNumber: number): string | null {
  const index = checkStringForReplacementChar(line)
  if (index !== null) {
    return `Unicode replacement character (U+FFFD) found on line ${lineNumber}. This usually indicates encoding issues in the source data.`
  }
  return null
}

/**
 * Validate that an assetMap doesn't contain U+FFFD in any string values.
 * Throws an error if found.
 */
export function validateAssetMapForReplacementChars(assetMap: Record<string, unknown>): void {
  // Check keys first
  for (const key of Object.keys(assetMap)) {
    if (checkStringForReplacementChar(key) !== null) {
      throw new ReplacementCharError(
        `Unicode replacement character (U+FFFD) found at assetMap["${key}"] (in key). This usually indicates encoding issues in the source data.`,
      )
    }
  }

  // Check values
  for (const [key, value] of Object.entries(assetMap)) {
    const path = findReplacementCharInObject(value, '')
    if (path !== null) {
      let fullPath: string
      if (!path) {
        fullPath = `assetMap["${key}"]`
      } else if (path.startsWith('[')) {
        fullPath = `assetMap["${key}"]${path}`
      } else {
        fullPath = `assetMap["${key}"].${path}`
      }
      throw new ReplacementCharError(
        `Unicode replacement character (U+FFFD) found at ${fullPath}. This usually indicates encoding issues in the source data.`,
      )
    }
  }
}
