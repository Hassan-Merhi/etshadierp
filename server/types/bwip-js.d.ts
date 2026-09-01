declare module "bwip-js" {
  export interface ToBufferOptions {
    bcid: string;
    text: string;
    [key: string]: string | number | boolean | undefined;
  }

  export function toBuffer(options: ToBufferOptions): Promise<Buffer>;
}
