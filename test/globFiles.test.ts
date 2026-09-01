import {mkdir, mkdtemp, rm, symlink, writeFile} from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {afterAll, beforeAll, describe, expect, test} from 'vitest'

import {globFiles} from '../src/util/globFiles.js'

describe('#globFiles', () => {
  let cwd: string

  beforeAll(async () => {
    cwd = await mkdtemp(path.join(os.tmpdir(), 'sanity-import-globfiles-'))
    await mkdir(path.join(cwd, 'dir.ndjson'))
    await mkdir(path.join(cwd, 'export', 'sub'), {recursive: true})
    await mkdir(path.join(cwd, 'images', 'nested'), {recursive: true})
    await writeFile(path.join(cwd, 'data.ndjson'), '')
    await writeFile(path.join(cwd, '.hidden.ndjson'), '')
    await writeFile(path.join(cwd, 'export', 'export.ndjson'), '')
    await writeFile(path.join(cwd, 'export', 'sub', 'deep.ndjson'), '')
    await writeFile(path.join(cwd, 'images', 'a.png'), '')
    await writeFile(path.join(cwd, 'images', '.DS_Store'), '')
    await symlink(path.join(cwd, 'images', 'a.png'), path.join(cwd, 'images', 'link.png'))
    await symlink(path.join(cwd, 'images', 'nested'), path.join(cwd, 'images', 'dirlink'))
    await symlink(path.join(cwd, 'images', 'missing.png'), path.join(cwd, 'images', 'broken.png'))
  })

  afterAll(async () => {
    await rm(cwd, {force: true, recursive: true})
  })

  test('returns absolute paths to files matching the pattern', async () => {
    const files = await globFiles('*/*.ndjson', cwd)
    expect(files).toEqual([path.join(cwd, 'export', 'export.ndjson')])
  })

  test('excludes directories whose names match the pattern', async () => {
    const files = await globFiles('*.ndjson', cwd)
    expect(files).toEqual([path.join(cwd, 'data.ndjson')])
  })

  test('excludes dotfiles', async () => {
    const files = await globFiles('images/*', cwd)
    expect(files).not.toContain(path.join(cwd, 'images', '.DS_Store'))
  })

  test('includes symlinks to files, excludes symlinks to directories and broken symlinks', async () => {
    const files = await globFiles('images/*', cwd)
    expect(files.sort()).toEqual([
      path.join(cwd, 'images', 'a.png'),
      path.join(cwd, 'images', 'link.png'),
    ])
  })

  test('accepts multiple patterns', async () => {
    const files = await globFiles(['*.ndjson', '*/*.ndjson'], cwd)
    expect(files.sort()).toEqual([
      path.join(cwd, 'data.ndjson'),
      path.join(cwd, 'export', 'export.ndjson'),
    ])
  })

  test('returns an empty array when nothing matches', async () => {
    const files = await globFiles('files/*', cwd)
    expect(files).toEqual([])
  })
})
