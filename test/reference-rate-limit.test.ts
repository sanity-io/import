import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest'

import {strengthenReferences} from '../src/references.js'
import {uploadAssets} from '../src/uploadAssets.js'
import {validateOptions} from '../src/validateOptions.js'
import {getSanityClient} from './helpers/helpers.js'
import {type MockMutationsBody, type MockResponse, type TestMutation} from './helpers/types.js'

function rateLimit(headers: Record<string, string> = {}): MockResponse {
  return {
    statusCode: 429,
    headers,
    body: {error: 'API rate limit exceeded'},
  }
}

function mutationServer(reject?: (attempt: number) => MockResponse | undefined) {
  const attempts: number[] = []
  const restored = new Map<string, NonNullable<TestMutation['patch']>>()
  const client = getSanityClient(({context: {options}}) => {
    if (options.url?.includes('/data/query')) {
      return {
        body: {
          result: {_id: 'image-existing-1x1-png', url: 'https://assets.invalid/image.png'},
        },
      }
    }
    if (!options.url?.includes('/data/mutate')) {
      throw new Error(`Unexpected request: ${options.url}`)
    }

    const now = Date.now()
    attempts.push(now)
    const failure = reject?.(attempts.length)
    if (failure) return failure
    if (attempts.filter((time) => time > now - 1000).length > 25) return rateLimit()

    const {mutations} = JSON.parse(options.body!) as MockMutationsBody
    for (const {patch} of mutations) {
      if (patch) restored.set(patch.id, patch)
    }
    return {
      body: {results: mutations.map(({patch}) => ({id: patch!.id, operation: 'update'}))},
    }
  })
  return {client, attempts, restored}
}

const stages = ['asset references', 'strong references'] as const
type Stage = (typeof stages)[number]

function runStage(
  stage: Stage,
  client: ReturnType<typeof mutationServer>['client'],
  count: number,
) {
  const options = validateOptions([], {
    client,
    tag: 'sanity.import.test',
    assetFetch: async () => new Response('fixture', {status: 200}),
  })
  const documents = Array.from({length: count}, (_, i) => `document-${i}`)
  return stage === 'strong references'
    ? strengthenReferences(
        documents.map((documentId) => ({documentId, references: ['related']})),
        options,
      )
    : uploadAssets(
        documents.map((documentId) => ({
          documentId,
          path: 'hero',
          type: 'image',
          url: 'https://assets.invalid/source.png',
        })),
        options,
      )
}

async function flushTimers(assertion: Promise<unknown>) {
  const results = await Promise.allSettled([assertion, vi.runAllTimersAsync()])
  for (const result of results) {
    if (result.status === 'rejected') throw result.reason
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-02T00:00:00Z'))
})
afterEach(() => vi.useRealTimers())

describe.each(stages)('%s', (stage) => {
  test('restores every reference without exceeding 20 mutation requests per second', async () => {
    const {client, attempts, restored} = mutationServer()
    // More than 30 batches for both stages, reproducing the original request burst.
    await flushTimers(expect(runStage(stage, client, 1600)).resolves.toBeDefined())

    expect(restored.size).toBe(1600)
    expect(restored.get('document-1599')).toMatchObject(
      stage === 'strong references'
        ? {unset: ['related._weak']}
        : {set: {'hero.asset': {_ref: 'image-existing-1x1-png', _type: 'reference'}}},
    )
    for (const time of attempts) {
      expect(
        attempts.filter((attempt) => attempt > time - 1000 && attempt <= time).length,
      ).toBeLessThanOrEqual(20)
    }
  })

  test('recovers after three rate-limited attempts with at least one second between retries', async () => {
    const {client, attempts, restored} = mutationServer((attempt) =>
      attempt <= 3 ? rateLimit() : undefined,
    )
    await flushTimers(expect(runStage(stage, client, 1)).resolves.toBeDefined())
    expect(attempts).toHaveLength(4)
    expect(restored.size).toBe(1)
    for (let i = 1; i < attempts.length; i++) {
      expect(attempts[i]! - attempts[i - 1]!).toBeGreaterThanOrEqual(1000)
    }
  })

  test.each(['seconds', 'date'])('honors the Retry-After header as %s', async (format) => {
    let retryAt = 0
    const {client, attempts} = mutationServer((attempt) => {
      if (attempt !== 1) return undefined
      retryAt = Date.now() + 4000
      if (format === 'date') retryAt = Math.floor(retryAt / 1000) * 1000
      return rateLimit({
        'retry-after': format === 'seconds' ? '4' : new Date(retryAt).toUTCString(),
      })
    })
    await flushTimers(expect(runStage(stage, client, 1)).resolves.toBeDefined())
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toBeGreaterThanOrEqual(retryAt)
  })

  test('stops after five attempts and propagates the error', async () => {
    const {client, attempts, restored} = mutationServer(() => rateLimit({'retry-after': 'invalid'}))
    await flushTimers(expect(runStage(stage, client, 1)).rejects.toMatchObject({statusCode: 429}))
    expect(attempts).toHaveLength(5)
    expect(restored.size).toBe(0)
    expect(attempts.at(-1)! - attempts[0]!).toBeGreaterThanOrEqual(10_000)
  })
})

test('reference strengthening does not retry revision conflicts', async () => {
  const {client, attempts} = mutationServer(() => ({
    statusCode: 409,
    body: {error: 'revision conflict'},
  }))
  await flushTimers(
    expect(runStage('strong references', client, 1)).rejects.toMatchObject({statusCode: 409}),
  )
  expect(attempts).toHaveLength(1)
})
