import {request} from 'node:https'

const MAX_RETRIES = 5

function getStatusCodeForUrl(url: string): Promise<number> {
  const parsedUrl = new URL(url)
  const options = {
    hostname: parsedUrl.hostname,
    method: 'HEAD' as const,
    path: parsedUrl.pathname + parsedUrl.search,
    port: parsedUrl.port,
    protocol: parsedUrl.protocol,
  }
  return new Promise((resolve, reject) => {
    const req = request(options, (res) => {
      res.resume()
      resolve(res.statusCode!)
    })
    req.on('error', reject)
    req.end()
  })
}

async function getAssetUrlStatus(url: string): Promise<number> {
  let error: Error = new Error('Max retries exceeded')
  let lastStatus: number | undefined
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const status = await getStatusCodeForUrl(url)
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

async function urlExists(url: string): Promise<boolean> {
  return (await getAssetUrlStatus(url)) === 200
}

export {getAssetUrlStatus, urlExists}
