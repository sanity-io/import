import {describe, expect, test} from 'vitest'

import {
  checkStringForReplacementChar,
  findReplacementCharInObject,
  validateAssetMapForReplacementChars,
  validateLineForReplacementChar,
} from '../src/util/validateReplacementCharacters.js'

describe('checkStringForReplacementChar', () => {
  test('returns null for string without replacement character', () => {
    expect(checkStringForReplacementChar('hello world')).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(checkStringForReplacementChar('')).toBeNull()
  })

  test('returns index for string with replacement character', () => {
    expect(checkStringForReplacementChar('hello\uFFFDworld')).toBe(5)
  })

  test('returns first index when multiple replacement characters exist', () => {
    expect(checkStringForReplacementChar('\uFFFDhello\uFFFD')).toBe(0)
  })
})

describe('findReplacementCharInObject', () => {
  test('returns null for object without replacement characters', () => {
    const obj = {name: 'test', nested: {value: 'hello'}}
    expect(findReplacementCharInObject(obj)).toBeNull()
  })

  test('returns null for empty object', () => {
    expect(findReplacementCharInObject({})).toBeNull()
  })

  test('returns path for simple string field with replacement character', () => {
    const obj = {name: 'test\uFFFD'}
    expect(findReplacementCharInObject(obj)).toBe('name')
  })

  test('returns path for nested field with replacement character', () => {
    const obj = {outer: {inner: 'bad\uFFFDvalue'}}
    expect(findReplacementCharInObject(obj)).toBe('outer.inner')
  })

  test('returns path for array element with replacement character', () => {
    const obj = {items: ['good', 'bad\uFFFD', 'also good']}
    expect(findReplacementCharInObject(obj)).toBe('items[1]')
  })

  test('returns path for object in array with replacement character', () => {
    const obj = {items: [{name: 'good'}, {name: 'bad\uFFFD'}]}
    expect(findReplacementCharInObject(obj)).toBe('items[1].name')
  })

  test('handles object keys with replacement character', () => {
    const obj = {'key\uFFFD': 'value'}
    expect(findReplacementCharInObject(obj)).toBe('["key\uFFFD"]')
  })

  test('returns null for non-string primitives', () => {
    const obj = {num: 123, bool: true, nil: null}
    expect(findReplacementCharInObject(obj)).toBeNull()
  })

  test('handles deeply nested structures', () => {
    const obj = {a: {b: {c: {d: {e: 'bad\uFFFD'}}}}}
    expect(findReplacementCharInObject(obj)).toBe('a.b.c.d.e')
  })
})

describe('validateLineForReplacementChar', () => {
  test('returns null for clean line', () => {
    expect(validateLineForReplacementChar('{"_id": "test", "_type": "doc"}', 1)).toBeNull()
  })

  test('returns error message for line with replacement character', () => {
    const result = validateLineForReplacementChar('{"title": "bad\uFFFD"}', 5)
    expect(result).toBe(
      'Unicode replacement character (U+FFFD) found on line 5. This usually indicates encoding issues in the source data.',
    )
  })
})

describe('validateAssetMapForReplacementChars', () => {
  test('does not throw for clean assetMap', () => {
    const assetMap = {
      'https://example.com/image.png': {
        _id: 'image-abc',
        _type: 'sanity.imageAsset',
        originalFilename: 'image.png',
      },
    }
    expect(() => validateAssetMapForReplacementChars(assetMap)).not.toThrow()
  })

  test('throws for assetMap with replacement character in key', () => {
    const assetMap = {
      'https://example.com/bad\uFFFD.png': {_id: 'image-abc'},
    }
    expect(() => validateAssetMapForReplacementChars(assetMap)).toThrow(
      'Unicode replacement character (U+FFFD) found at assetMap["https://example.com/bad\uFFFD.png"] (in key)',
    )
  })

  test('throws for assetMap with replacement character in value', () => {
    const assetMap = {
      'https://example.com/image.png': {
        _id: 'image-abc',
        originalFilename: 'bad\uFFFDname.png',
      },
    }
    expect(() => validateAssetMapForReplacementChars(assetMap)).toThrow(
      'Unicode replacement character (U+FFFD) found at assetMap["https://example.com/image.png"].originalFilename',
    )
  })

  test('throws for assetMap with replacement character in array value', () => {
    const assetMap = {
      'https://example.com/image.png': ['good', 'bad\uFFFD'],
    }
    expect(() => validateAssetMapForReplacementChars(assetMap)).toThrow(
      'Unicode replacement character (U+FFFD) found at assetMap["https://example.com/image.png"][1]',
    )
  })

  test('throws for assetMap with replacement character in direct string value', () => {
    const assetMap = {
      'https://example.com/data': 'bad\uFFFD',
    }
    expect(() => validateAssetMapForReplacementChars(assetMap)).toThrow(
      'Unicode replacement character (U+FFFD) found at assetMap["https://example.com/data"]',
    )
  })
})
