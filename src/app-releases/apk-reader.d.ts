// Deklarasi minimal untuk @devicefarmer/adbkit-apkreader (paket tidak menyertakan tipe).
declare module '@devicefarmer/adbkit-apkreader' {
  interface ApkManifest {
    package: string;
    versionCode: number;
    versionName: string;
    [key: string]: unknown;
  }
  interface ApkReader {
    readManifest(): Promise<ApkManifest>;
  }
  const ApkReader: { open(file: string): Promise<ApkReader> };
  export default ApkReader;
}
