import {describe, expect, test, vi} from 'vitest'

import {retryOnFailure} from '../src/util/retryOnFailure.js'

describe('retry on failure utility', () => {
  test('does not retry on initial success', async () => {
    const fn = vi.fn()
    fn.mockReturnValueOnce(Promise.resolve('hei'))

    expect(await retryOnFailure(fn)).toEqual('hei')
    expect(fn).toHaveBeenCalledTimes(1)
  })

  test('retries on failure up to maximum of 3 attempts', async () => {
    const error = new Error('nope')
    const fn = vi.fn()
    fn.mockReturnValue(Promise.reject(error))

    await expect(retryOnFailure(fn)).rejects.toEqual(error)

    expect(fn).toHaveBeenCalledTimes(3)
  })

  test('retries on failure up to maximum of configured attempts', async () => {
    const start = Date.now()

    const error = new Error('nope')
    const fn = vi.fn()
    fn.mockReturnValue(Promise.reject(error))

    await expect(retryOnFailure(fn, {maxTries: 5})).rejects.toEqual(error)

    expect(fn).toHaveBeenCalledTimes(5)
    expect(Date.now() - start).toBeGreaterThanOrEqual(150 * 5)
  })

  test('succeeds if second attempt succeeds', async () => {
    const fn = vi.fn()
    fn.mockReturnValueOnce(Promise.reject(new Error('nope')))
    fn.mockReturnValueOnce(Promise.resolve('moop'))

    expect(await retryOnFailure(fn)).toEqual('moop')

    expect(fn).toHaveBeenCalledTimes(2)
  })

  test('respects Retry-After header on 429 errors', async () => {
    const start = Date.now()
    const fn = vi.fn()

    const rateLimitError = Object.assign(new Error('Rate limit exceeded'), {
      response: {statusCode: 429},
      retryAfter: 1, // 1 second
    })

    fn.mockReturnValueOnce(Promise.reject(rateLimitError))
    fn.mockReturnValueOnce(Promise.resolve('success'))

    expect(await retryOnFailure(fn)).toEqual('success')
    expect(fn).toHaveBeenCalledTimes(2)
    // Should wait at least 1000ms (Retry-After value), not the default 150ms
    expect(Date.now() - start).toBeGreaterThanOrEqual(900)
  })
})
