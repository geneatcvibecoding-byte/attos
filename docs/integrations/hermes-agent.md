# Hermes Agent runtime integration

Status: runtime adapter and runner configuration are implemented on the integration branch. The adapter uses Hermes ACP over newline-delimited JSON-RPC, passes AttentionOS's run-scoped stdio MCP server, streams assistant text, supports session continuation, and stops the subprocess on cancellation. Automated tests have been added, but the repository's full typecheck/test suite has not yet been run in this environment.

## Requirements

- Node.js 22.18 or newer and the AttentionOS dependencies installed.
- Hermes Agent installed and the `hermes` command available (or set `runner.hermesBin`).
- A separate named Hermes profile for AttentionOS, with a working provider/model configured in that profile.
- In that profile's `config.yaml`, explicitly disable Hermes-native ACP toolsets:

```yaml
platform_toolsets:
  acp: [no_mcp]
```

The runtime checks this setting and fails closed if the profile is missing or any native ACP toolset is enabled. AttentionOS supplies the per-run MCP server separately. Do not use the default Hermes profile.

## AttentionOS config

```ts
export default defineConfig({
  runner: {
    engine: "hermes",
    hermesProfile: "attentionos",
    // Optional if the executable is not on PATH:
    // hermesBin: "C:/path/to/hermes.exe",
  },
});
```

Create/configure the named profile using Hermes' own profile commands, then set up its provider credentials and default model there. Do not commit profile credentials. The Hermes profile's model/provider configuration is used; ACP currently does not expose reliable per-run cost reporting to AttentionOS. Hermes runs therefore record zero reported cost, not an estimate, and AttentionOS's Anthropic API budget cap does not meter Hermes provider spend.

## Runtime boundaries

- AttentionOS passes only its run-scoped stdio MCP server with the job's allow-list and actor identity.
- Tool-less jobs receive no MCP servers; the profile check also requires Hermes-native ACP toolsets to be disabled.
- AttentionOS retains output schema validation, timeout/cancellation, run lifecycle, and approval checks.
- The adapter does not claim exact provider spend because ACP does not report trustworthy per-run cost in the response.
- Hermes ACP receives AttentionOS context as prompt text because ACP has no portable system-prompt field; tool restrictions are enforced by profile configuration and the MCP server, not by that text.

## Validation

Run these from the repository root:

```bash
pnpm install
pnpm --filter @attentionos/runner typecheck
pnpm test -- packages/runner/test/hermes-acp.test.ts
pnpm check
```

The runtime is committed on `feat/hermes-agent-integration`; it should not be described as fully verified until these checks pass and a real Hermes profile is exercised end-to-end.
