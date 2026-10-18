# Hermes Agent integration design

Status: implementation plan / compatibility contract. This document deliberately does not claim that Hermes is a supported runner engine yet.

## Goal

Add Hermes Agent as an alternative runtime for AttentionOS model jobs without changing the Studio dashboard, database schema, modules, job definitions, media sidecar, or provider interfaces.

## Existing integration seam

- `packages/runner/src/run-job.ts` routes native jobs to `runNativeJob` and model jobs to `runLlmJob`.
- `packages/runner/src/llm.ts` owns run lifecycle, cancellation, timeout, structured output validation, skill loading, model resolution, event recording, tool policy, and approval status.
- `packages/runner/src/claude-cli.ts` demonstrates the existing subprocess-to-runner message adapter.
- `packages/core/src/config.ts` validates `runner.engine`; today the supported values are `claude-code` and `api`.
- `createMcpServer` exposes AttentionOS tools with a run-scoped actor and an allow-list.

## Non-negotiable compatibility requirements

A Hermes adapter must not bypass any of the following:

1. Run-scoped actor identity and MCP tool allow-list.
2. `toolless` job isolation: no MCP servers, tools, workspace settings, or skill/tool leakage.
3. The runner's AbortSignal, timeout, and cancellation behavior.
4. Job output JSON schema validation and retry behavior.
5. Approval tools and the final pending-approval check.
6. Workspace-only data access and deterministic publishing validators.
7. Correct run/session IDs and usage/cost reporting; do not invent cost numbers.
8. No implicit public publishing or messaging without the existing approval gates.

## Recommended implementation shape

1. Add a dedicated `packages/runner/src/hermes-*` adapter behind a small runtime interface. Keep the Claude adapters untouched.
2. Establish the supported Hermes invocation/API contract from the pinned Hermes Agent version. Do not guess CLI flags or parse interactive terminal output.
3. For tool-enabled jobs, expose the existing AttentionOS MCP server using a transport Hermes actually supports, and enforce the job-specific tool allow-list at the server boundary. Do not hand Hermes an unrestricted server.
4. For `toolless` jobs, use a separate invocation with no tools or MCP, then validate the result through the existing Zod schema path.
5. Extend `runner.engine` only after the adapter supports both tool-enabled and tool-less jobs. Add a Hermes binary/path setting only if the chosen Hermes interface requires it.
6. Add tests for prompt transport, JSON/schema output, cancellation, timeouts, missing binary, MCP allow-list enforcement, no-tool isolation, failed exits, and session/usage metadata.
7. Document installation and configuration for Windows/WSL 2 and Docker. Secrets belong in the workspace `.env`, never in committed config.

## Acceptance checklist

- [ ] Existing `claude-code` and `api` tests continue to pass unchanged.
- [ ] All model jobs work on Hermes, including jobs that need MCP tools.
- [ ] Tool-less extraction jobs have no tools or MCP access.
- [ ] Approval-required jobs remain in `waiting_approval` until the existing approval flow resolves.
- [ ] Timeout and cancellation stop the Hermes process and close the run correctly.
- [ ] `attentionos doctor` explains missing or incompatible Hermes installations.
- [ ] Studio remains unchanged and can start, monitor, cancel, and approve runs.
- [ ] CI typecheck, lint, and tests pass.

## Why the engine enum should not be changed prematurely

Simply adding `"hermes"` to the configuration enum would let users select an engine that the runner cannot execute safely. Hermes invocation, MCP transport, and structured-output behavior must be verified against the actual Hermes Agent CLI/API before the option becomes selectable.
