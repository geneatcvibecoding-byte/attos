# Hermes Agent integration design

Status: integration contract verified against the upstream Hermes ACP adapter; AttentionOS runtime integration is **not yet enabled**. Do not select `runner.engine: "hermes"` until the tool-isolation blocker below is solved and tested.

## Goal

Add Hermes Agent as an alternative runtime for AttentionOS model jobs without changing the Studio dashboard, database schema, modules, job definitions, media sidecar, or provider interfaces.

## Existing integration seam

- `packages/runner/src/run-job.ts` routes native jobs to `runNativeJob` and model jobs to `runLlmJob`.
- `packages/runner/src/llm.ts` owns run lifecycle, cancellation, timeout, structured output validation, skill loading, model resolution, event recording, tool policy, and approval status.
- `packages/runner/src/claude-cli.ts` demonstrates the existing subprocess-to-runner message adapter.
- `packages/core/src/config.ts` validates `runner.engine`; supported values remain `claude-code` and `api`.
- `createMcpServer` exposes AttentionOS tools with a run-scoped actor and an allow-list.

## Upstream interface verified

The current Hermes Agent repository exposes an ACP stdio adapter through `hermes acp` / `hermes-acp`. The adapter accepts an ACP `session/new` request with MCP server definitions and streams session updates during `session/prompt`. This is a real machine interface; the interactive terminal UI must not be parsed as a substitute.

However, accepting an MCP server does **not** by itself make Hermes safe for AttentionOS. The ACP server builds its own Hermes agent/tool surface and then adds ACP-provided MCP tools. AttentionOS must prove that Hermes-native filesystem, shell, browser, delegation, and messaging tools can be disabled or restricted for each run before the runtime can be enabled. A prompt saying “do not use those tools” is not a security boundary.

## Non-negotiable compatibility requirements

A Hermes adapter must not bypass any of the following:

1. Run-scoped actor identity and MCP tool allow-list, enforced at the AttentionOS MCP server boundary.
2. `toolless` job isolation: no MCP servers, native tools, workspace settings, or skill/tool leakage.
3. The runner's AbortSignal, timeout, and cancellation behavior.
4. Job output JSON schema validation and retry behavior. ACP does not provide a direct equivalent to the Claude SDK's `outputFormat`; the adapter must still validate output in AttentionOS.
5. Approval tools and the final pending-approval check.
6. Workspace-only data access and deterministic publishing validators.
7. Correct run/session IDs and usage/cost reporting; do not invent cost numbers. If Hermes does not return trustworthy per-run cost, report cost as unavailable/zero according to existing product semantics, never an estimate as fact.
8. No implicit public publishing or messaging without the existing approval gates.
9. Hermes-native tools must be restricted by configuration/API, not by prompt instructions alone.

## Implementation plan

1. Add a dedicated `packages/runner/src/hermes-acp.ts` adapter behind the runner's existing query interface. Keep Claude adapters untouched.
2. Pin/document the supported Hermes ACP contract and handle framed stdio JSON-RPC, session creation, streamed updates, errors, and cancellation. Do not parse interactive terminal output.
3. Pass the existing AttentionOS stdio MCP server to ACP, scoped to the current run and exact job allow-list. Reject unsupported MCP transports rather than silently dropping them.
4. For `toolless` jobs, use an isolated ACP session with no MCP server and a Hermes profile with all native tools disabled. If upstream cannot guarantee this, do not run those jobs on Hermes.
5. Only then add `hermes` to `runner.engine` and a configurable binary path. Keep existing Studio flows unchanged.
6. Add tests for ACP framing, prompt transport, JSON/schema output, cancellation, timeout, missing binary, MCP allow-list, no-tool isolation, failed exits, session metadata, and cost handling.
7. Document Windows native, WSL 2, and Docker setup; secrets belong in environment/workspace secret storage, never committed config.

## Acceptance checklist

- [ ] Existing `claude-code` and `api` tests pass unchanged.
- [ ] Tool-enabled jobs can call only their allowed AttentionOS MCP tools.
- [ ] Hermes-native tools cannot bypass the AttentionOS tool policy.
- [ ] Tool-less extraction jobs have no tools or MCP access.
- [ ] Approval-required jobs remain in `waiting_approval` until the existing approval flow resolves.
- [ ] Timeout and cancellation stop the Hermes process and close the run correctly.
- [ ] `attentionos doctor` explains missing or incompatible Hermes installations.
- [ ] Studio remains unchanged and can start, monitor, cancel, and approve runs.
- [ ] CI typecheck, lint, and tests pass.

## Why the engine enum remains unchanged

Adding `"hermes"` before tool isolation is proven would let users select a runtime that can bypass AttentionOS's existing safety boundaries. The ACP transport is verified, but native-tool restriction, structured output parity, session/cost reporting, and the runner lifecycle still require implementation and tests.