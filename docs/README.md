# Kora Documentation

Project documentation. The main entry point is the [root README](../README.md).

| Document | Description |
|---|---|
| [ARCHITECTURE.md](ARCHITECTURE.md) | How the project works: the two processes, the agent's ReAct loop, the tool registry, IPC channels, security layers, the LLM gateway, persistence and voice |
| [FIXES.md](FIXES.md) | Chronological journal of bug fixes, security hardening, performance work and code cleanups |
| [SECURITY_AUDIT.md](SECURITY_AUDIT.md) | Independent security audit report (September 13, 2026) |
| [SECURITY_FIXES.md](SECURITY_FIXES.md) | Security and architecture fixes applied after the audit (August 27, 2026) |
| [CODE_REVIEW.md](CODE_REVIEW.md) | Overall code review summary |

## Reading order

1. **New to the project?** Start with the [root README](../README.md), then [ARCHITECTURE.md](ARCHITECTURE.md).
2. **Reviewing security?** Read [SECURITY_AUDIT.md](SECURITY_AUDIT.md) and [SECURITY_FIXES.md](SECURITY_FIXES.md).
3. **Curious about history?** [FIXES.md](FIXES.md) and [CODE_REVIEW.md](CODE_REVIEW.md).

## Note

The audit documents (`SECURITY_AUDIT.md`, `SECURITY_FIXES.md`, `CODE_REVIEW.md`) are dated snapshots
written at a point in time. Some issues they list were fixed afterwards — the authoritative, chronological
record of what changed is [FIXES.md](FIXES.md).

