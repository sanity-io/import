import {createClient, requester as defaultRequester} from '@sanity/client'
import {injectResponse} from 'get-it/middleware'

// eslint-disable-next-line no-empty-function
const noop = () => {}

process.on('unhandledRejection', (reason) => {
  // eslint-disable-next-line no-console
  console.error('UNHANDLED REJECTION', reason)
})

const defaultClientOptions = {
  apiVersion: '1',
  projectId: 'foo',
  dataset: 'bar',
  token: 'abc123',
  useCdn: false,
}

export const getSanityClient = (inject = noop, opts = {}) => {
  const requester = defaultRequester.clone()
  requester.use(injectResponse({inject}))
  const req = {requester: requester}
  const client = createClient(Object.assign(defaultClientOptions, req, opts))
  return client
}
