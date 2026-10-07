import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { extname, join, normalize, sep } from "node:path";

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
};

export interface StaticServer {
  origin: string;
  close: () => Promise<void>;
}

/** Minimal static file server for tests, bound to the loopback interface on a free port. */
export async function serveDirectory(root: string): Promise<StaticServer> {
  const server: Server = createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
    const file = normalize(join(root, pathname === "/" ? "index.html" : pathname));
    if (!file.startsWith(root + sep)) {
      response.writeHead(403).end();
      return;
    }
    readFile(file).then(
      (body) => {
        response
          .writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "text/plain" })
          .end(body);
      },
      () => {
        response.writeHead(404, { "content-type": "text/html" }).end("<h1>Not found</h1>");
      },
    );
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The test server is not listening on a TCP port");
  }

  return {
    origin: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
