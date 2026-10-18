import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { hermesAcpQuery } from "../src/hermes-acp.ts";

const oldHermesHome = process.env.HERMES_HOME;
afterEach(() => {
  if (oldHermesHome === undefined) delete process.env.HERMES_HOME;
  else process.env.HERMES_HOME = oldHermesHome;
});

function fixture(script: string) {
  const root = mkdtempSync(join(tmpdir(), "aos-hermes-"));
  process.env.HERMES_HOME = root;
  const profile = join(root, "profiles", "attentionos");
  mkdirSync(profile, { recursive: true });
  writeFileSync(join(profile, "config.yaml"), "platform_toolsets:\n  acp: [no_mcp]\n");
  const bin = join(root, "hermes");
  writeFileSync(bin, `#!/usr/bin/env node\n${script}\n`);
  chmodSync(bin, 0o755);
  return { bin, root };
}

describe("hermesAcpQuery", () => {
  it("streams ACP assistant text and returns a compatible result", async () => {
    const { bin } = fixture(`
      const readline = require("node:readline");
      const out = (m) => process.stdout.write(JSON.stringify(m) + "\\n");
      readline.createInterface({ input: process.stdin }).on("line", (line) => {
        const m = JSON.parse(line);
        if (m.method === "initialize") out({ jsonrpc: "2.0", id: m.id, result: { protocolVersion: 1 } });
        if (m.method === "session/new") out({ jsonrpc: "2.0", id: m.id, result: { sessionId: "s-1" } });
        if (m.method === "session/prompt") {
          out({ jsonrpc: "2.0", method: "session/update", params: { sessionId: "s-1", update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Hello from Hermes" } } } });
          out({ jsonrpc: "2.0", id: m.id, result: { stopReason: "end_turn" } });
        }
      });
    `);
    const seen: Array<{ type: string; result?: string }> = [];
    for await (const message of hermesAcpQuery({ bin, profile: "attentionos" })({
      prompt: "Say hello",
      options: { cwd: process.cwd(), tools: [], persistSession: true, mcpServers: {} } as never,
    })) {
      const value = message as { type: string; result?: string };
      seen.push(value);
    }
    expect(seen.some((m) => m.type === "assistant")).toBe(true);
    expect(seen.at(-1)).toMatchObject({ type: "result", subtype: "success", result: "Hello from Hermes" });
  });

  it("refuses a profile with native ACP toolsets enabled", async () => {
    const { bin, root } = fixture("process.exit(0);");
    writeFileSync(join(root, "profiles", "attentionos", "config.yaml"), "platform_toolsets:\n  acp: [terminal, file]\n");
    const run = async () => {
      for await (const _message of hermesAcpQuery({ bin, profile: "attentionos" })({
        prompt: "hello",
        options: { cwd: process.cwd(), tools: [], persistSession: true, mcpServers: {} } as never,
      })) { /* drain */ }
    };
    await expect(run()).rejects.toThrow(/not tool-restricted/);
  });

  it("refuses to attach MCP servers to a tool-less run", async () => {
    const { bin } = fixture("process.exit(0);");
    const run = async () => {
      for await (const _message of hermesAcpQuery({ bin, profile: "attentionos" })({
        prompt: "untrusted input",
        options: { cwd: process.cwd(), tools: [], persistSession: false, mcpServers: { attentionos: { type: "stdio", command: "node" } } } as never,
      })) { /* drain */ }
    };
    await expect(run()).rejects.toThrow(/Refusing to attach MCP tools/);
  });
});
