# nabuco

**A team of AI agent "employees" for Claude Code and OpenAI Codex that learns from the mistakes it fixes.**

A Manager agent coordinates nine specialists (Dev, Debugger, Designer, DevOps, Docs, Architect, Reviewer, Security and Tester) with three rules it never bends:

1. **An approved plan before any code.** Medium and sensitive tasks stop at the plan and wait for a human.
2. **One writer at a time.** Checkers are read-only and review only the diff of the current task.
3. **An evidence gate.** Nothing is "done" without the command that proves it, and a hook blocks the Manager from closing a task without that proof.

[Leia em português](README.pt-BR.md) · the agents, commands and docs speak Brazilian Portuguese.

> Node ≥ 20, zero runtime dependencies, 470+ tests across 28 suites (`node:test`). Version 0.9.0.

---

## Why it exists

Coding agents repeat the same mistakes across sessions, and they report work as finished when nothing was run. nabuco treats both as engineering problems:

- **Repetition is a memory problem.** Every fixed error becomes a *case*, recurring cases become *lessons*, and trusted lessons get promoted to *rules* enforced by hooks, lint or tests.
- **False "done" is a verification problem.** Completion is decided by evidence the gate can check, never by the model saying so.

## The brain: cases → lessons → rules

| Layer | Where | What it holds |
|---|---|---|
| **Cases** | `~/.nabuco/casos/<role>/` | A diary of resolved errors, always with the command that proved the fix |
| **Lessons** | `~/.nabuco/licoes/<role>.md` (global) or `.nabuco/licoes/` (project) | Distilled patterns, at most 30 per agent. The Manager hands each writer at most 3 relevant ones and records whether they helped |
| **Rules** | hooks, lint, tests | Lessons trusted enough to be enforced mechanically |

- **When a case becomes a lesson:** on the first occurrence if a checker caught it or there was an early warning sign, without waiting for it to repeat. If an error returns after its lesson was delivered, it is automatically flagged as a recurrence.
- **Seniority is measured, not declared.** Writers are scored on first-pass acceptance, recurrence and escapes; checkers on findings that became fixes and problems that slipped past them. A level appears only after 3 tasks.
- **Nothing in the brain changes without human approval**, item by item. The brain is a git repo of its own and can sync across machines through a private remote, merging two existing brains safely or refusing with an explanation.

## What's in the box

| Command (Claude Code / Codex) | What it does |
|---|---|
| `/nabuco:tarefa` / `$tarefa` | Run a task: classify, plan, approve, implement, check, gate |
| `/nabuco:fila` / `$fila` | Queue several requests and run them one after another. The queue never skips an approval, and a failed item stops it |
| `/nabuco:retro` / `$retro` | Retrospective: turn resolved failures into cases and lessons |
| `/nabuco:licoes` / `$licoes` | Browse, edit, retire and promote lessons; view seniority metrics |
| `/nabuco:painel` / `$painel` | Local live dashboard: one monitor per agent, the active task, the gate and a live timeline |
| `/nabuco:release` / `$release` | Audit a release: tasks closed, versions consistent, commands green, changelog present |
| `/nabuco:vigia` / `$vigia` | Security watch: risky permissions, hooks and MCP configs, secrets in git history, known-vulnerable dependencies (npm audit + OSV) |
| `/nabuco:contratar` / `$contratar` | "Hire" a new agent through a short interview, with a full preview before anything is written |
| `/nabuco:relatorio` / `$relatorio` | Report on what the team did in a period, including token usage and data-quality warnings |
| `/nabuco:status` / `$status` | Team, models, installation problems and the active task |

## Design decisions worth reading

- **"Could not check" is never "clean."** A network failure in the dependency audit is reported as *not verified*, not as *no vulnerabilities*. A period with no events is reported as *no events*, never as a clean report.
- **Checkers can't write.** Read-only agents are given read-only tools (`Read, Grep, Glob, WebFetch, WebSearch`, no shell), and the setup tests that this holds in both harnesses.
- **Diff-scoped review.** Each task records its git base when it starts (`git stash create` or `HEAD`, without touching your files), so checkers review exactly that task's diff, even when a queue accumulates changes without committing.
- **Never `git add -A`.** Per-item commits include only the files that item changed. An unreliable file list becomes a question to the human.
- **The dashboard is local and read-only.** It binds to `127.0.0.1`, is protected by a key in the URL, and works offline with no dependencies.
- **Secrets are never shown in full.** The security watch prints the first 4 characters only, and never rewrites history or force-pushes; a leaked key means rotate it at the provider.
- **Agents are generated, not hand-edited.** Role definitions in `papeis/` plus `modelos.json` are built into Claude Code and Codex agents, and `build:check` fails if the generated files drift.

## Install

**Claude Code**
```
/plugin marketplace add Andgomes11/nabuco
/plugin install nabuco@nabuco
/nabuco:setup
```

**Codex**
```
codex plugin marketplace add Andgomes11/nabuco
codex plugin add nabuco@nabuco
```
Then run `$setup` and `/hooks` to trust nabuco's hooks. Windows notes are in the [Portuguese README](README.pt-BR.md#instalação).

Requirements: Node 20+ and git.

## Development

```
npm test            # node:test, no dependencies
npm run build       # regenerate agents from papeis/ + modelos.json
npm run build:check # fail if generated agents are out of date
```

Layout: `papeis/` (role definitions) · `skills/` (the commands above) · `scripts/` (task, queue, brain, gate, dashboard, release, security-watch CLIs) · `hooks/` (the evidence gate and event capture) · `tests/`.

## How this was built

I built nabuco with the coding agents it coordinates, and I used it on real work while building it. That loop is the point: every rule in the gate and the brain exists because an agent got something wrong in a way a test would not have caught.

## License

[FSL-1.1-ALv2](LICENSE.md) — the Functional Source License. Read it, study it, modify it and use it internally; you may not use it to compete with the licensor. Each version becomes Apache 2.0 two years after its release.

Copyright 2026 Anderson Gomes.
