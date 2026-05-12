// `qrcode-terminal` ships no types. Only the bits used by src/unplugin/tunnel.ts.
declare module 'qrcode-terminal' {
  interface GenerateOptions {
    small?: boolean;
  }
  function generate(input: string, options?: GenerateOptions): void;
  function generate(
    input: string,
    options: GenerateOptions,
    callback: (output: string) => void,
  ): void;
  const _default: { generate: typeof generate };
  export default _default;
}
