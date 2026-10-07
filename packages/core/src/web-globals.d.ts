// `core` is compiled without the DOM and Node typings so that it cannot depend on either by
// accident. These are the few web-standard globals it does use; they exist in Node, browsers
// and Cloudflare Workers alike.

declare class TextEncoder {
  encode(input: string): Uint8Array;
}

declare const crypto: {
  subtle: {
    digest(algorithm: "SHA-256", data: Uint8Array): Promise<ArrayBuffer>;
  };
};
