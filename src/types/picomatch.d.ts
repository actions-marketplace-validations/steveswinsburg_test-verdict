declare module 'picomatch' {
  interface PicomatchOptions {
    dot?: boolean;
  }
  function picomatch(
    glob: string | string[],
    options?: PicomatchOptions,
  ): (test: string) => boolean;
  export = picomatch;
}
