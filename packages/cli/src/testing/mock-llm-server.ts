import { createServer } from "node:http";
import { z } from "zod";

const requestSchema = z.looseObject({
  model: z.string(),
  messages: z.array(z.object({ role: z.string(), content: z.string() })),
});

export interface MockLlmRequest {
  model: string;
  system: string;
  user: string;
  /** The full request body, to assert on provider-specific fields. */
  body: Record<string, unknown>;
}

export type MockLlmReply =
  /** Text returned as the assistant message of a successful completion. */
  string | { status: number; error: string; headers?: Record<string, string> };

export interface MockLlm {
  /** Pass as the OpenAI-compatible base URL. */
  baseURL: string;
  requests: MockLlmRequest[];
  close: () => Promise<void>;
}

/** A local stand-in for an OpenAI-compatible chat completions endpoint. */
export async function serveMockLlm(
  reply: (request: MockLlmRequest, index: number) => MockLlmReply,
): Promise<MockLlm> {
  const requests: MockLlmRequest[] = [];

  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const body = requestSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      const recorded: MockLlmRequest = {
        model: body.model,
        system: body.messages.find((message) => message.role === "system")?.content ?? "",
        user: body.messages.find((message) => message.role === "user")?.content ?? "",
        body,
      };
      requests.push(recorded);

      const answer = reply(recorded, requests.length - 1);
      if (typeof answer !== "string") {
        response
          .writeHead(answer.status, { "content-type": "application/json", ...answer.headers })
          .end(JSON.stringify({ error: { message: answer.error } }));
        return;
      }
      response.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          id: `mock-${requests.length}`,
          object: "chat.completion",
          created: 0,
          model: body.model,
          choices: [
            { index: 0, message: { role: "assistant", content: answer }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
        }),
      );
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("The mock LLM server is not listening on a TCP port");
  }

  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

/** A well-formed model answer. */
export function suggestionJson(after: string | null): string {
  return JSON.stringify({
    explanation: "Mock explanation.",
    affects: "Mock audience.",
    patch: after === null ? null : { after },
    confidence: 0.8,
  });
}
