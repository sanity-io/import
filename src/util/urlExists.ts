import {createRequester, type FetchFunction} from 'get-it'

const MAX_RETRIES = 5
const request = createRequester({httpErrors: false})

async function getStatusCodeForUrl(url: string, fetch?: FetchFunction): Promise<number> {
  const requester = fetch ? createRequester({fetch, httpErrors: false}) : request
  const response = await requester({method: 'HEAD', url})
  return response.status
}

async function getAssetUrlStatus(url: string, fetch?: FetchFunction): Promise<number> {
  let error: Error = new Error('Max retries exceeded')
  let lastStatus: number | undefined
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const status = await getStatusCodeForUrl(url, fetch)
      if (status < 500) {
        return status
      }
      lastStatus = status
    } catch (err) {
      error = err as Error
    }

    // Wait one second before retrying the request
    await new Promise<void>((resolve) => setTimeout(resolve, 1000))
  }

  if (lastStatus !== undefined) {
    return lastStatus
  }
  throw error
}

async function urlExists(url: string, fetch?: FetchFunction): Promise<boolean> {
  return (await getAssetUrlStatus(url, fetch)) === 200
}

export {getAssetUrlStatus, urlExists}
