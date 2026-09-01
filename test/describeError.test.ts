import {expect, test} from 'vitest'

import {describeError} from '../src/util/describeError.js'

test('returns the message of a plain error', () => {
  expect(describeError(new Error('Something broke'))).toBe('Something broke')
})

test('appends the cause, which is where fetch hides the actual reason', () => {
  const err = new TypeError('fetch failed', {cause: new Error('connect ECONNREFUSED 127.0.0.1:80')})
  expect(describeError(err)).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:80')
})

test('unwraps the empty AggregateError undici uses for failed connections', () => {
  const attempts = new AggregateError([new Error('connect ECONNREFUSED ::1:80')], '')
  expect(describeError(new TypeError('fetch failed', {cause: attempts}))).toBe(
    'fetch failed: connect ECONNREFUSED ::1:80',
  )
})

test('does not repeat a message already covered further up the chain', () => {
  const err = new Error('Upload failed: disk full', {cause: new Error('disk full')})
  expect(describeError(err)).toBe('Upload failed: disk full')
})

test('stops walking a self-referencing cause chain', () => {
  const err: Error & {cause?: unknown} = new Error('Loops forever')
  err.cause = err
  expect(describeError(err)).toBe('Loops forever')
})

test('falls back to stringifying values that are not errors', () => {
  expect(describeError('just a string')).toBe('just a string')
})
