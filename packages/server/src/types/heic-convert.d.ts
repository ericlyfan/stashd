declare module 'heic-convert' {
  interface ConvertOptions {
    buffer: ArrayBuffer;
    format: 'JPEG' | 'PNG';
    quality?: number;
  }
  function heicConvert(options: ConvertOptions): Promise<ArrayBuffer>;
  export = heicConvert;
}
