# Corine Agent Kit — documentation

**The safe-by-construction agent runtime for Solana.** Every trade — one-shot, CLI, or agent — goes through one guarded execution spine. There is no public path that executes a trade any other way.

- Package: [`@h4rsharma/corine-core`](../../packages/core) · CLI: [`@h4rsharma/corine-cli`](../../packages/cli)
- License: Apache-2.0 · Node >= 18

## Start here

1. [Quickstart](quickstart.md) — install → configure with your keys → first guarded trade in under 5 minutes.
2. [Core concepts](core-concepts.md) — the runtime, the safety spine (gate by gate), the seven pluggable seams, agents.
3. [Safety model](safety-model.md) — what the gates guarantee, what they don't, and the honest custody disclosure. **Read before shipping.**
4. [API reference](api-reference.md) — every public export, typed.

## Guides

- [Build a custom agent type](guides/build-a-custom-agent-type.md)
- [Plug a data source](guides/plug-a-data-source.md)
- [Durable store](guides/durable-store.md)
- [Deploy and monitor](guides/deploy-and-monitor.md)
- [Integrate a frontend](guides/integrate-a-frontend.md)

## Agent-native

- [SKILL.md](SKILL.md) — how an LLM/agent calls this SDK as a tool.
- [llms.txt](llms.txt) / [llms-full.txt](llms-full.txt) — machine-readable index + full reference.
- [MCP](mcp.md) — expose the guarded actions over the Model Context Protocol.

## Boundaries

- [What's open vs hosted](whats-open.md) — the runtime is fully open; billing/Dodo/hosted infra are not, and no keys ship.

## Examples

Runnable examples live in [`packages/core/examples`](../../packages/core/examples): a DCA agent in ~10 lines, a guarded swap, a custom agent type, and a custom data source.
