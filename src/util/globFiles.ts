import {glob, stat} from 'node:fs/promises'
import path from 'node:path'

/**
 * Finds files matching the given glob pattern(s), resolved relative to `cwd`.
 *
 * Only files are returned - directories are skipped, and symbolic links are followed so that
 * links pointing at files are included while links pointing at directories (or nowhere) are not.
 * Dotfiles are not matched by `*`, in line with regular glob semantics.
 *
 * @param patterns - Glob pattern(s) to match, relative to `cwd`
 * @param cwd - Absolute path to the directory to search within
 * @returns Absolute paths of matching files
 */
export async function globFiles(patterns: string | string[], cwd: string): Promise<string[]> {
  const files: string[] = []
  for await (const entry of glob(patterns, {cwd, withFileTypes: true})) {
    const filePath = path.join(entry.parentPath, entry.name)
    if (entry.isFile() || (entry.isSymbolicLink() && (await isFile(filePath)))) {
      files.push(filePath)
    }
  }
  return files
}

async function isFile(filePath: string): Promise<boolean> {
  try {
    const stats = await stat(filePath)
    return stats.isFile()
  } catch {
    return false
  }
}
