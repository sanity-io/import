interface PathItem {
  path: (number | string)[]
}

export function serializePath(item: PathItem): string {
  let target = ''
  for (let i = 0; i < item.path.length; i++) {
    const part = item.path[i]!
    const isIndex = typeof part === 'number'
    const isNumericStringKey = !isIndex && Number.isFinite(Number(part))
    const seperator = i === 0 ? '' : '.'
    if (!isIndex && !isNumericStringKey) {
      target = `${target}${seperator}${part}`
    } else {
      const add = isIndex ? `[${part}]` : `["${part}"]`
      target = `${target}${add}`
    }
  }

  return target
}
