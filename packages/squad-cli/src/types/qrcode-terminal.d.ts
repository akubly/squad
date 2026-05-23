/**
 * Minimal ambient type declaration for the optional qrcode-terminal package.
 * This is intentionally minimal — only the surface used by rc.ts and start.ts.
 */
declare module 'qrcode-terminal' {
  interface QRCodeOptions {
    small?: boolean;
  }
  function generate(text: string, options: QRCodeOptions, callback: (qrcode: string) => void): void;
  export default { generate };
}
