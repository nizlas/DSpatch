---
id: DSP-166
title: Gemini as an agent provider through ACP and the official Gemini CLI
status: Blocked
assignee: []
created_date: '2026-11-03 22:50'
updated_date: '2026-11-03 22:56'
labels:
  - provider
  - gemini
dependencies: []
ordinal: 92000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas, 3 November 2026: add Gemini as a provider, DSpatch → ACP → official Gemini CLI → the user's Google account, so a friend with Google AI Pro can use DSpatch on the subscription. No direct Gemini API/Vertex integration, no API key, no separate billing, no silent switch of authentication. DSpatch keeps chat, loop orchestration, review and history; Gemini CLI keeps its agent run and tools.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 The integration route is proved by a small real ACP probe before the user flow is built
- [ ] #2 Gemini is chosen, prepared and signed in like the other providers, with honest capability answers
- [ ] #3 Chat streams with tool activity, follow-ups and Stop; history and reattach through the existing host send nothing twice
- [ ] #4 Loop steps and review/code walks go through the same adapter where support suffices
- [ ] #5 Missing install, expired login, refused tools, quota errors, process exit and connection errors read clearly
- [ ] #6 Verified with a real Google sign-in in an isolated profile and disposable project; unverified combinations are marked
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
Current focus (3 November 2026): checking the official Gemini CLI distribution and ACP support before any implementation. Finding: the Gemini CLI team's announcements (github.com/google-gemini/gemini-cli discussions #27274, 19 May 2026, and #28017, 18 June 2026) say Gemini CLI stopped serving Google AI Pro, Google AI Ultra and free-tier individual accounts on 18 June 2026; Gemini Code Assist licenses and API keys are unaffected; individual subscribers are directed to Antigravity CLI, which has no official ACP support. The decided route therefore cannot serve a Google AI Pro account. Niclas's decision is needed before building anything further.

Probe (3 November 2026): official @google/gemini-cli 0.66.0 (npm latest), installed into a disposable folder (%LOCALAPPDATA%\Temp\dsp-gemini-cli). gemini --acp answers initialize with protocolVersion 1, agentCapabilities loadSession true, prompt image/audio/embeddedContext, MCP http/sse, and authMethods oauth-personal (Log in with Google), gemini-api-key, vertex-ai, gateway. Offering oauth-personal does not say the server serves an account: whether a Google AI Pro account is refused after sign-in is to be observed with Niclas's sign-in. Prepared: disposable project %LOCALAPPDATA%\Temp\dsp-gemini-verify\project (a failing node --test) and an empty isolated profile folder beside it, for node scripts/dev.mjs --isolated-profile.

Change of next step (Niclas, 3 November 2026): Gemini CLI through ACP is no longer the planned route for individual accounts. Next: a bounded investigation of the official Antigravity CLI as a possible provider (SDK, protocol or documented headless interface behind AgentAdapter and the standalone host), with isolated installation and bounded probes. Research only: no product implementation, no community bridge, no private backend API, no disabled permission checks, no API key or separate billing.

Antigravity CLI investigation (3 November 2026). Research only; nothing installed, no account used, nothing implemented.

Official interfaces (documented, read 3 November 2026):
- Antigravity CLI (`agy`), repository github.com/google-antigravity/antigravity-cli, CHANGELOG up to 1.4.12. Install scripts antigravity.google/cli/install.ps1 / install.sh / install.cmd. The README documents no machine interface. The CHANGELOG documents a headless print mode (`-p` / `--prompt`, `--print`), `--output-format` with machine-readable output (statuses including `print_timeout` and `interrupted` as of 1.4.11), `--json-schema`, `--continue`/resume of conversations, `--model` and `--effort`, permission modes (`--mode auto`, Auto mode on Windows 11 24H2+ for personal accounts as of 1.4.4), a terminal sandbox, hooks (`hooks.json`, `PreInvocation`, `PostToolUse`), exit code 3 with an `AGY_ERROR` line on API failure, quota errors reported at once (1.3.3), `/usage`, and Windows/Linux binaries. Third-party guides describe `--output-format stream-json` and `--input-format stream-json`; not confirmed from an official page here.
- No official ACP: no official page mentions it; community adapters (agy-acp and others) state that agy does not support ACP natively; a Zed discussion reports maintainers consider it unlikely.
- Antigravity SDK: PyPI `google-antigravity` 0.1.23 (28 October 2026), published by Google LLC, Apache-2.0, Python 3.10+, wheels for Windows/Linux/macOS. Authentication documented: Gemini API key (`GEMINI_API_KEY`) and Vertex AI / Gemini Enterprise Agent Platform (Express API key or ADC). No personal Google sign-in or Google AI Pro subscription.

Account and subscription (official statements):
- Antigravity FAQ (antigravity.google/docs/faq, no date shown): "Using third-party software, tools, or services to access Antigravity is a violation of our Terms of Service"; it "can result in suspension or termination of your account"; wrapping `agy` inside third-party coding agents or applications, or automating account rotation, is not supported under consumer plans; "Antigravity CLI headless mode (`agy -p`) is intended for direct scripting and CI workflows"; "To use a third-party coding agent with Gemini, we recommend using a Gemini Enterprise or Google AI Studio API key."
- Google AI Developers Forum, thread 189905 (16 October 2026): a reply speaking for Google (no staff badge shown on the page) says invoking the official agy binary as a local subprocess from a third-party coding agent is not allowed on consumer plans, even unmodified and without token extraction. Thread 183051 holds a September 2026 community reply saying the opposite, with no staff role; it predates the FAQ wording and is not authoritative.
- Gemini CLI (earlier finding): stopped serving Google AI Pro, Ultra and free individual accounts on 18 June 2026 (discussions #27274, #28017); Gemini Code Assist licenses and API keys unaffected.

Technical possibility vs documented support: the headless print mode with structured output and resume could technically sit behind AgentAdapter and the standalone host, the way the Claude Code CLI does. That is a technical possibility only. DSpatch is a third-party application wrapping agy, which the FAQ names as not supported on consumer plans and as a Terms of Service matter. Not tried, by design: no install, no sign-in, no probe.

Fit for DSpatch if a supported account route existed (from the CHANGELOG, not observed): model choice yes (`--model`, model listing not confirmed as machine output); follow-ups and resume yes (`--continue`, conversation ids in JSON output); streamed text and tool events only through stream-json, unofficially described; Stop: interrupted status on Ctrl+C, signal handling for subprocesses fixed in 1.2.x; permissions: interactive prompts and Auto mode, no documented non-interactive per-call permission callback for a host to answer; hooks exist and could carry DSpatch's controls; read-only review mode not documented; running under DSpatch's host while the client is closed: plausible (a daemon and remote-control exist), unverified; Windows and Linux binaries exist; quota errors and /usage exist.

Conclusion:
- The Google AI Pro goal cannot be met through any officially supported route without separate API billing: Gemini CLI no longer serves individual subscriptions, the Antigravity CLI must not be wrapped by a third-party application on consumer plans, and the Antigravity SDK authenticates only with an API key or Vertex/Enterprise.
- Supported routes that remain all mean a Gemini API key (AI Studio, free tier or paid) or a Gemini Enterprise / Gemini Code Assist license: Gemini CLI through ACP (handshake proved here, protocol 1, loadSession) or the Antigravity SDK (Python runtime, no ACP).
- Recommendation: park the Google integration for Google AI Pro. If Niclas later accepts an API-key or Enterprise route, Gemini CLI through ACP is the smaller step for DSpatch (an ACP adapter beside the existing ones, a TypeScript stack, stdio JSON-RPC, documented loadSession, permission requests and cancel), estimated at roughly the size of the Copilot adapter work (DSP-148 order: adapter, provider setup and sign-in, policies and hooks, tests, real verification), with the main gaps being ACP permission-request mapping to DSpatch's policy, a read-only review mode, and quota/usage reporting. The Antigravity SDK would add a Python runtime to the host.

Status: blocked on Niclas's decision (park, or choose an API-key/Enterprise route). Nothing was installed for Antigravity; the Gemini CLI 0.66.0 install from the earlier probe stays in %LOCALAPPDATA%\Temp\dsp-gemini-cli.
<!-- SECTION:NOTES:END -->
