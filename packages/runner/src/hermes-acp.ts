import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createInterface } from "node:readline";
import type { Options, SDKMessage, SDKResultMessage } from "@anthropic-ai/claude-agent-sdk";
import type { QueryFn } from "./llm.ts";

type HermesCliOptions = { bin?: string; profile: string };
type McpServer = { type?: string; command?: string; args?: string[]; env?: Record<string, string> };
type RpcMessage = { id?: string | number; method?: string; params?: Record<string, unknown>; result?: unknown; error?: { message?: string; code?: number } };

const textFrom = (value: unknown): string => {
  if (!value || typeof value !== "object") return "";
  const v = value as Record<string, unknown>;
  const content = v.content && typeof v.content === "object" ? v.content as Record<string, unknown> : v;
  return typeof content.text === "string" ? content.text : "";
};

/**
 * Hermes Agent ACP adapter. Uses the documented newline-delimited JSON-RPC stdio transport.
 * Hermes ACP sessions are deliberately isolated per AttentionOS run; only the AttentionOS MCP
 * server is supplied by this adapter. Use a dedicated Hermes profile configured with
 * platform_toolsets.acp: ["no_mcp"] so Hermes-native toolsets are not enabled.
 */
export function hermesAcpQuery(cli: HermesCliOptions): QueryFn {
  if (!cli.profile?.trim() || cli.profile === "default") throw new Error("Hermes integration requires a named, dedicated Hermes profile (not the default profile).");
  return async function* query({ prompt, options = {} }): AsyncIterable<SDKMessage> {
    const profileRoot = process.env.HERMES_HOME?.trim() || join(homedir(), ".hermes");
    const profileHome = join(profileRoot, "profiles", cli.profile);
    const profileConfig = join(profileHome, "config.yaml");
    if (!existsSync(profileConfig)) {
      throw new Error(`Hermes profile config not found at ${profileConfig}. Create the dedicated profile first and configure its ACP toolsets.`);
    }
    let profileSettings: unknown;
    try { profileSettings = parseYaml(readFileSync(profileConfig, "utf8")); }
    catch (error) { throw new Error(`Could not read Hermes profile config: ${error instanceof Error ? error.message : String(error)}`); }
    const platformToolsets = (profileSettings as { platform_toolsets?: Record<string, unknown> } | null)?.platform_toolsets;
    const acpToolsets = platformToolsets?.acp;
    if (!Array.isArray(acpToolsets) || acpToolsets.length !== 1 || acpToolsets[0] !== "no_mcp") {
      throw new Error(`Hermes profile "${cli.profile}" is not tool-restricted. Set platform_toolsets.acp: ["no_mcp"] in ${profileConfig}; AttentionOS will attach only the run-scoped MCP server.`);
    }
    const bin = cli.bin ?? "hermes";
    const args = ["-p", cli.profile, "acp"];
    const child = spawn(bin, args, {
      cwd: options.cwd,
      env: options.env as NodeJS.ProcessEnv | undefined,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    child.stdin.on("error", () => {});
    const stderr: string[] = [];
    child.stderr.on("data", (chunk: Buffer) => {
      const line = chunk.toString();
      stderr.push(line);
      options.stderr?.(line);
    });

    let nextId = 1;
    const pending = new Map<number, { resolve: (value: RpcMessage) => void; reject: (error: Error) => void }>();
    const updates: RpcMessage[] = [];
    let wake: (() => void) | undefined;
    let ended = false;
    let transportError: Error | undefined;
    const notify = () => { wake?.(); wake = undefined; };
    const stdout = createInterface({ input: child.stdout });
    stdout.on("line", (line) => {
      let msg: RpcMessage;
      try { msg = JSON.parse(line) as RpcMessage; } catch { return; }
      if (msg.id !== undefined && (typeof msg.id === "number") && pending.has(msg.id)) {
        const slot = pending.get(msg.id)!;
        pending.delete(msg.id);
        if (msg.error) slot.reject(new Error(msg.error.message ?? `Hermes ACP error ${msg.error.code ?? "unknown"}`));
        else slot.resolve(msg);
      } else if (msg.method) {
        updates.push(msg);
        notify();
      }
    });
    stdout.on("close", () => { ended = true; notify(); });
    child.once("error", (error) => { transportError = error; ended = true; notify(); });

    const request = (method: string, params: Record<string, unknown> = {}): Promise<RpcMessage> => {
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n", (error) => {
          if (error) { pending.delete(id); reject(error); }
        });
      });
    };
    const sendNotification = (method: string, params: Record<string, unknown>) => {
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
    };
    const abort = () => {
      // ACP cancellation is session-scoped; send it when a session has been created.
      if (sessionId) sendNotification("session/cancel", { sessionId });
      child.kill("SIGTERM");
    };
    options.abortController?.signal.addEventListener("abort", abort, { once: true });
    let sessionId: string | undefined;
    let output = "";
    let response: RpcMessage | undefined;
    try {
      await request("initialize", {
        protocolVersion: 1,
        clientInfo: { name: "AttentionOS", version: "0.1.0" },
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false } },
      });
      const configuredServers = Object.entries((options.mcpServers ?? {}) as Record<string, McpServer>)
        .filter(([, server]) => server.type === "stdio")
        .map(([name, server]) => ({
          name,
          command: server.command ?? "",
          args: server.args ?? [],
          env: Object.entries(server.env ?? {}).map(([envName, value]) => ({ name: envName, value })),
        }));
      if (options.persistSession === false && configuredServers.length) {
        // Tool-less jobs never receive MCP servers; never silently downgrade an attempted tool-less run.
        throw new Error("Refusing to attach MCP tools to a tool-less Hermes job.");
      }
      const created = await request(options.resume ? "session/load" : "session/new", {
        cwd: options.cwd ?? process.cwd(),
        ...(options.resume ? { sessionId: options.resume } : {}),
        mcpServers: configuredServers,
      });
      const result = created.result as Record<string, unknown> | undefined;
      sessionId = typeof result?.sessionId === "string" ? result.sessionId : undefined;
      if (!sessionId) throw new Error("Hermes ACP did not return a session ID.");
      const systemPrompt = options.systemPrompt;
      const systemText = typeof systemPrompt === "string"
        ? systemPrompt
        : systemPrompt && typeof systemPrompt === "object" && "append" in systemPrompt
          ? String((systemPrompt as { append?: unknown }).append ?? "")
          : "";
      const acpPrompt = systemText ? `${systemText}\n\n--- AttentionOS task ---\n${prompt}` : prompt;
      const promptPromise = request("session/prompt", {
        sessionId,
        prompt: [{ type: "text", text: acpPrompt }],
      });
      while (!response) {
        while (updates.length) {
          const update = updates.shift()!;
          if (update.method !== "session/update" || !update.params) continue;
          const params = update.params;
          if (params.sessionId !== sessionId) continue;
          const updateBody = params.update && typeof params.update === "object"
            ? params.update as Record<string, unknown> : {};
          const kind = String(updateBody.sessionUpdate ?? "");
          if (kind === "agent_message_chunk") {
            const text = textFrom(updateBody.content);
            if (!text) continue;
            output += text;
            const msg = {
              type: "assistant",
              parent_tool_use_id: null,
              message: { role: "assistant", content: [{ type: "text", text }], model: options.model ?? "hermes" },
              session_id: sessionId,
            };
            yield msg as SDKMessage;
          } else if (kind === "tool_call") {
            const title = String(updateBody.title ?? updateBody.kind ?? "AttentionOS tool");
            options.stderr?.(`Hermes ACP tool activity: ${title}\n`);
          }
        }
        if (ended) {
          if (transportError) throw transportError;
          throw new Error(`Hermes ACP exited before completing the prompt.${stderr.length ? " " + stderr.join("").trim().split("\n").slice(-3).join(" ") : ""}`);
        }
        // Wait for either a protocol update or the prompt response. Request response is consumed by the stdout
        // handler and held in this promise; the loop wakes on each notification and checks completion below.
        const check = promptPromise.then((value) => { response = value; notify(); return value; });
        await Promise.race([check, new Promise<void>((resolve) => { wake = resolve; })]);
      }
      const promptResult = response.result as Record<string, unknown> | undefined;
      const stopReason = String(promptResult?.stopReason ?? "end_turn");
      const failure = stopReason === "cancelled" || stopReason === "cancel";
      const resultMessage = {
        type: "result",
        subtype: failure ? "error_during_execution" : "success",
        is_error: failure,
        result: output,
        session_id: sessionId,
        num_turns: 1,
        total_cost_usd: 0,
        ...(failure ? { errors: ["Hermes ACP prompt was cancelled."] } : {}),
      };
      yield resultMessage as SDKResultMessage;
    } finally {
      options.abortController?.signal.removeEventListener("abort", abort);
      for (const slot of pending.values()) slot.reject(new Error("Hermes ACP process closed."));
      pending.clear();
      if (child.exitCode === null) child.kill("SIGTERM");
      child.stdin.end();
    }
  };
}
