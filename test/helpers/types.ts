import type {HttpContext, MiddlewareResponse} from 'get-it'

import type {SanityDocument} from '../../src/types.js'

/**
 * Type for the inject function parameter structure used in get-it middleware
 */
export interface MockRequestEvent {
  context: HttpContext
}

/**
 * Type for mock response returned by inject functions
 */
export type MockResponse = Partial<MiddlewareResponse> | void

/**
 * Type for inject function used in test mocks
 */
export type InjectFunction = (
  event: MockRequestEvent,
  prevValue?: MiddlewareResponse,
) => MockResponse

/**
 * Type for parsed NDJSON documents array
 */
export type ParsedDocuments = SanityDocument[]

/**
 * Type for mutation structure used in Sanity API tests
 */
export interface TestMutation {
  patch?: {id: string}
  create?: {_id: string}
  createIfNotExists?: {_id: string}
  createOrReplace?: {_id: string}
  delete?: {id: string}
}

/**
 * Type for request options that include uri/url (test-specific extension)
 */
export interface TestRequestOptions {
  uri?: string
  url?: string
  body?: string
  [key: string]: unknown
}

/**
 * Type for mock mutations response body
 */
export interface MockMutationsBody {
  mutations: TestMutation[]
}
