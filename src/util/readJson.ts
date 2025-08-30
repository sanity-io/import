import {readFile} from 'fs/promises'

export default async function readJson<T = any>(filePath: string): Promise<T> {
  const file = await readFile(filePath, 'utf8')
  return JSON.parse(file) as T
}
