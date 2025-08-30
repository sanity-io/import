declare module 'file-url' {
  function getFileUrl(path: string, options?: {resolve?: boolean}): string
  export = getFileUrl
}

declare module 'p-map' {
  function pMap<T, R>(
    input: Iterable<T>,
    mapper: (element: T, index: number) => R | Promise<R>,
    options?: {concurrency?: number},
  ): Promise<R[]>
  export = pMap
}

declare module 'mississippi' {
  export function to(): any
}

declare module 'split2' {
  function split2(transform?: (line: string) => any): any
  export = split2
}
