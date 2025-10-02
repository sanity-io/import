import {createClient, requester as defaultRequester} from '@sanity/client'
import {injectResponse} from 'get-it/middleware'

import type {InjectFunction} from './types.js'

process.on('unhandledRejection', (reason) => {
   
  console.error('UNHANDLED REJECTION', reason)
})

const defaultClientOptions = {
  apiVersion: '1',
  projectId: 'foo',
  dataset: 'bar',
  token: 'abc123',
  useCdn: false,
}

export const getSanityClient = (
  inject: InjectFunction = () => {
    /* Default no-op inject function for testing */
  },
  opts: Record<string, unknown> = {},
) => {
  const requester = defaultRequester.clone()
  const middleware = injectResponse({inject})
  requester.use(middleware)
  const req = {requester}
  const clientOptions = {...defaultClientOptions, ...req, ...opts}
  const client = createClient(clientOptions)
  return client
}
