import https from 'https'
import {parse as parseUrl} from 'url'

const MAX_RETRIES = 5

function getStatusCodeForUrl(url: string): Promise<number> {
  const options = {...parseUrl(url), method: 'HEAD' as const}
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      res.resume()
      resolve(res.statusCode!)
    })
    req.on('error', reject)
    req.end()
  })
}

async function urlExists(url: string): Promise<boolean> {
  let error: Error
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const statusCode = await getStatusCodeForUrl(url)
      return statusCode === 200
    } catch (err) {
      error = err as Error

      // Wait one second before retrying the request
      // eslint-disable-next-line no-await-in-loop
      await new Promise<void>((resolve) => setTimeout(resolve, 1000))
    }
  }

  throw error!
}

export default urlExists
