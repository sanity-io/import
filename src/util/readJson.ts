import {readFile} from 'node:fs/promises'

export async function readJson<T = unknown>(filePath: string): Promise<T> {
  const file = await readFile(filePath, 'utf8')
  return JSON.parse(file) as T
}
