/**
 * Check if a buffer is a tar file
 *
 * @param buffer - The buffer to check
 * @returns boolean
 *
 * Credit to https://github.com/kevva/is-tar
 */
export function isTar(buf: Buffer): boolean {
  if (!buf || buf.length < 262) {
    return false
  }

  return (
    buf[257] === 0x75 &&
    buf[258] === 0x73 &&
    buf[259] === 0x74 &&
    buf[260] === 0x61 &&
    buf[261] === 0x72
  )
}
