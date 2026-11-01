declare module 'lzma' {
  /** LZMA-JS: returns a string for text payloads, a byte array otherwise. */
  export function decompress(data: Uint8Array | number[]): string | number[];
  const lzma: { decompress: typeof decompress };
  export default lzma;
}
