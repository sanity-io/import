import fs from 'node:fs'
import path from 'node:path'

import {describe, expect, test} from 'vitest'

import {isTar} from '../src/util/isTar.js'

describe('#isTar', () => {
  test('should return true if the buffer is a tar file', () => {
    expect(isTar(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'fixture.tar')))).toBe(
      true,
    )
  })

  test('should return false if the buffer is not a tar file', () => {
    expect(
      isTar(fs.readFileSync(path.join(import.meta.dirname, 'fixtures', 'references.ndjson'))),
    ).toBe(false)
  })
})
