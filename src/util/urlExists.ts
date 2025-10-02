import {request} from 'node:https'
import {parse as parseUrl} from 'node:url'

const MAX_RETRIES = 5

function getStatusCodeForUrl(url: string): Promise<number> {
  const options = {...parseUrl(url), method: 'HEAD' as const}
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      res.resume()
      resolve(res.statusCode!)
    })
    req.on('error', reject)
    req.end()
  })
}

async function urlExists(url: string): Promise<boolean> {
  let error: Error = new Error('Max retries exceeded')
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const statusCode = await getStatusCodeForUrl(url)
      return statusCode === 200
    } catch (err) {
      error = err as Error

      // Wait one second before retrying the request
      await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    }
  }

  throw error
}

export {urlExists}
