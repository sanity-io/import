import {createClient} from '@sanity/client'
import {createMockFetch, type MockResponseDef, type RecordedRequest} from 'get-it/mock'

import {type InjectFunction, type MockResponse, type TestRequestOptions} from './types.js'

process.on('unhandledRejection', (reason) => {
  console.error('UNHANDLED REJECTION', reason)
})

const defaultClientOptions = {
  apiVersion: '1',
  dataset: 'bar',
  projectId: 'foo',
  token: 'abc123',
  useCdn: false,
}

export function fragmentBuffer(buffer: Buffer, chunkSize = 64): Buffer[] {
  return Array.from({length: Math.ceil(buffer.length / chunkSize)}, (_, index) =>
    buffer.subarray(index * chunkSize, (index + 1) * chunkSize),
  )
}

export const getSanityClient = (
  inject: InjectFunction = () => {
    /* Default no-op inject function for testing */
  },
  opts: Record<string, unknown> = {},
) => {
  const mock = createMockFetch()
  let currentRequest: RecordedRequest | undefined
  let currentResponse: MockResponse | undefined

  const getResponse = (): MockResponse => {
    const request = mock.getRequests().at(-1)
    if (!request) return {}

    // Mock response getters run after get-it/mock records the matching request.
    // Cache the callback result so every getter uses the same response.
    if (request !== currentRequest) {
      currentRequest = request
      currentResponse = inject({context: {options: toTestRequestOptions(request)}}) ?? {}
    }

    return currentResponse ?? {}
  }

  const response: MockResponseDef = {
    get body() {
      return getResponse().body ?? ''
    },
    get headers() {
      return getResponse().headers ?? {}
    },
    get status() {
      return getResponse().statusCode ?? 200
    },
    get statusText() {
      return getResponse().statusMessage ?? 'OK'
    },
  }

  mock.onAny(() => true).respondPersist(response)
  const clientOptions = {
    ...defaultClientOptions,
    resolveFetch: () => mock.fetch,
    ...opts,
  }
  const client = createClient(clientOptions)
  return client
}

function toTestRequestOptions(request: RecordedRequest): TestRequestOptions {
  const headers: Record<string, string> = {}
  for (const [key, value] of request.headers) {
    headers[key] = value
  }

  const options: TestRequestOptions = {
    headers,
    method: request.method,
    url: request.fullUrl,
  }
  if (typeof request.init?.body === 'string') {
    options.body = request.init.body
  }
  return options
}
