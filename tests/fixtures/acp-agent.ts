const encoder = new TextEncoder();
let buffer = "";
async function send(value: unknown) {
  await Deno.stdout.write(encoder.encode(JSON.stringify(value) + "\n"));
}
for await (const bytes of Deno.stdin.readable) {
  buffer += new TextDecoder().decode(bytes);
  while (buffer.includes("\n")) {
    const end = buffer.indexOf("\n");
    const request = JSON.parse(buffer.slice(0, end));
    buffer = buffer.slice(end + 1);
    if (request.id === undefined) continue;
    let result: unknown = {};
    if (request.method === "initialize")
      result = {
        protocolVersion: 1,
        agentCapabilities: {
          loadSession: true,
          mcpCapabilities: { http: true },
        },
        authMethods: [],
      };
    if (request.method === "session/new")
      result = { sessionId: crypto.randomUUID() };
    if (request.method === "session/prompt") {
      await send({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: request.params.sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "fixture-complete" },
          },
        },
      });
      result = { stopReason: "end_turn" };
    }
    await send({ jsonrpc: "2.0", id: request.id, result });
  }
}
