interface PathItem {
  path: (string | number)[]
}

export function serializePath(item: PathItem): string {
  return item.path.reduce((target: string, part, i) => {
    const isIndex = typeof part === 'number'
    const isNumericStringKey = !isIndex && isFinite(Number(part))
    const seperator = i === 0 ? '' : '.'
    if (!isIndex && !isNumericStringKey) {
      return `${target}${seperator}${part}`
    }

    const add = isIndex ? `[${part}]` : `["${part}"]`
    return `${target}${add}`
  }, '')
}
