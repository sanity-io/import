 
import debug from 'debug'
import {defaults} from 'lodash-es'

const log = debug('sanity:import')

interface RetryOptions {
  delay?: number
  maxTries?: number
  isRetriable?: (error: Error) => boolean
}

export async function retryOnFailure<T>(op: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const options = defaults({}, opts, {delay: 150, maxTries: 3, isRetriable: () => true})

  for (let attempt = 1; attempt <= options.maxTries; attempt++) {
    try {
      return await op()
    } catch (err) {
      const error = err as Error
      if (!options.isRetriable(error)) {
        log('Encountered error which is not retriable, giving up')
        throw error
      }

      if (attempt === options.maxTries) {
        log('Error encountered, max retries hit - giving up (attempt #%d)', attempt)
        throw error
      } else {
        const ms = options.delay * attempt
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
