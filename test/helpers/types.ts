/**
 * Type for the request passed to a test response handler
 */
export interface MockRequestEvent {
  context: {
    options: TestRequestOptions
  }
}

/**
 * Type for mock response returned by inject functions
 */
export interface MockResponse {
  body?: unknown
  headers?: Record<string, string>
  method?: string
  statusCode?: number
  statusMessage?: string
  url?: string
}

/**
 * Type for inject function used in test mocks
 */
export type InjectFunction = (
  event: MockRequestEvent,
  prevValue?: MockResponse,
) => MockResponse | void

/**
 * Type for mutation structure used in Sanity API tests
 */
export interface TestMutation {
  create?: {[key: string]: unknown; _id: string}
  createIfNotExists?: {[key: string]: unknown; _id: string}
  createOrReplace?: {[key: string]: unknown; _id: string}
  delete?: {id: string}
  patch?: {
    id: string
    set?: Record<string, unknown>
    setIfMissing?: Record<string, unknown>
  }
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
