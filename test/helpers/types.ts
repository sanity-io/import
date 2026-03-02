import {type HttpContext, type MiddlewareResponse} from 'get-it'

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
 * Type for mutation structure used in Sanity API tests
 */
export interface TestMutation {
  create?: {[key: string]: unknown; _id: string}
  createIfNotExists?: {[key: string]: unknown; _id: string}
  createOrReplace?: {[key: string]: unknown; _id: string}
  delete?: {id: string}
  patch?: {id: string}
}

/**
 * Type for request options that include uri/url (test-specific extension)
 */
export interface TestRequestOptions {
  [key: string]: unknown

  body?: string
  uri?: string
  url?: string
}

/**
 * Type for mock mutations response body
 */
export interface MockMutationsBody {
  mutations: TestMutation[]
}

/**
 * Type for mutation with required create property (used in test match functions)
 */
export interface TestMutationWithCreate {
  create: {[key: string]: unknown; _id: string}
}
