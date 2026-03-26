import debug from 'debug'

const log = debug('sanity:import')

interface RetryOptions {
  delay?: number
  isRetriable?: (error: Error) => boolean
  maxTries?: number
}

export async function retryOnFailure<T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const options = {delay: 150, isRetriable: () => true, maxTries: 3, ...opts}

  for (let attempt = 1; attempt <= options.maxTries; attempt++) {
    try {
      return await op()
    } catch (err) {
      const error = err as Error & {retryAfter?: number}
      if (!options.isRetriable(error)) {
        log('Encountered error which is not retriable, giving up')
        throw error
      }

      if (attempt === options.maxTries) {
        log('Error encountered, max retries hit - giving up (attempt #%d)', attempt)
        throw error
      } else {
        const retryAfterMs = error.retryAfter ? error.retryAfter * 1000 : 0
        const ms = Math.max(options.delay * attempt, retryAfterMs)
        log('Error encountered, waiting %d ms before retrying (attempt #%d)', ms, attempt)
        log('Error details: %s', error.message)
        await delay(ms)
      }
    }
  }

  // This should never be reached, but TypeScript requires a return
  throw new Error('Unexpected end of retry loop')
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
