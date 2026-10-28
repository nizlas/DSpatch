---
id: DSP-151
title: Open external reviews from Gerrit and GitHub
status: To Do
assignee: []
created_date: '2026-10-28 22:01'
labels:
  - review
  - integration
dependencies:
  - DSP-150
priority: medium
ordinal: 87000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
A person pastes a Gerrit change or GitHub pull request link and reviews it in DSpatch with the existing diff view, review status and code walks.

### Why

Much of the code a person reviews at work arrives as a Gerrit change or a GitHub pull request, not as two commits in a local clone. VISION.md section 3.3 makes review standalone: a repository and a chosen diff are enough. This story makes such a change a source of that input, so the DSP-150 diff review, its line marks and the existing walks apply to it unchanged.

### Flow

- **Two ways in, one function.** *Open review from URL…* in the review flow takes a pasted link. A request in the chat ("open this change") reaches the same host function; the chat does not fetch anything itself.
- **Identification.** From the link DSpatch identifies the server, the repository, the change or PR, and the patchset or revisions. A link it cannot read, or to an unknown kind of server, is said to be so.
- **Fetching.** What the review needs is fetched on the host, without touching the person's working copy, current branch, index or stash.
- **The review.** It opens in the existing diff window. The source and the exact reviewed version are shown, with a link back to the change or PR in Gerrit or GitHub.
- **Walks.** The existing code-walk functionality applies to the fetched pair. This story builds no separate walk generator.

### Authentication

- Gerrit and GitHub are both supported, including company installations (self-hosted Gerrit, GitHub Enterprise Server).
- Investigate the host's existing authentication and reuse it where it works.
- Git fetching and the service's API may need different authentication. Browser single sign-on is not assumed to be reusable.
- Connections are kept per server and per account. Missing access leads to a clear next step, never to a half-opened review.
- Secrets never reach the chat, logs, review records or workspace files.
- This authentication is separate from the SSH connection to the DSpatch host (DSP-111) and from the AI provider's authentication.
- The existing provider permission rules and content exclusion ([DSPATCH_CONTENT_EXCLUSION_CONTRACT.md](../../docs/DSPATCH_CONTENT_EXCLUSION_CONTRACT.md)) apply to fetched material as to local material.

### Versions and review state

- A review is bound to the exact repository and revision pair or patchset.
- Newer versions are detected and offered, never switched to silently.
- Comparison between Gerrit patchsets, and between versions of a GitHub PR, is considered.
- The decided rules for coverage, history and changed code apply (DSP-150; REVIEW_COVERAGE_AND_CODE_WALKS.md section 7). Changed lines do not inherit earlier approvals.

### Out of scope

The first version fetches, shows and lets the person review. It publishes nothing to Gerrit or GitHub: no comments, votes, approvals or changes.

### To investigate when implementation is planned

These are deliberately not chosen here:

- **Transport.** Git over HTTPS or SSH, the service's REST API, or both; and how each Gerrit and GitHub Enterprise installation is reached from the host, including through a proxy.
- **Credentials.** Where they are stored (the OS credential store, Git's credential helper, the `gh` CLI's store or another) and how a person adds, changes and removes one per server and account. A token's scope must be enough to read and no more.
- **Fetched objects.** Where they live (a separate cache or mirror, or refs in an existing clone, without altering it) and how long they are kept.
- **Identity details.** Gerrit change-id against change number, patchset parents and rebases; a GitHub PR's merge base when the base branch has moved, and force-pushes that leave an earlier head unreachable.
- **Content exclusion.** How exclusion applies to repositories that are not in the workspace.
- **Remote hosts.** How this works when DSpatch's host runs on a remote machine (DSP-111).

### Dependencies

DSP-150: the diff review, the revision-pair record and the walk windows this story opens into. Related, not blocking: DSP-111 (a remote host), DSP-148 (Copilot at work and the work computer's policies).
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [ ] #1 Open review from URL… in the review flow and a request in the chat both open a review through one host function; the two ways in reach the same review for the same link
- [ ] #2 Gerrit: a change link, on a public Gerrit and on a company installation, opens the diff of a named patchset against its parent; the window names the server, project, change number and patchset, with a link back to the change
- [ ] #3 GitHub: a pull request link, on github.com and on a GitHub Enterprise Server installation, opens the diff of the PR's head against its base as the commits at the time of opening; the window names the server, repository, PR number and the two commits, with a link back to the PR
- [ ] #4 Every review is bound to the exact repository and full commit hashes (and Gerrit patchset or GitHub head commit); the identity shown and stored is the one reviewed
- [ ] #5 Opening a change or PR leaves the person's working copy, current branch, index and stash unchanged, before and after, including when the change is in the same repository as the open workspace
- [ ] #6 When a newer patchset or PR version exists, the review says so and offers it; the review on screen never switches by itself, and a person can compare two patchsets or two PR versions
- [ ] #7 Marks, requirements and position are kept per reviewed revision pair as in DSP-150, survive reopening the same link and a restart, and a newer version starts with nothing inherited for changed lines
- [ ] #8 Missing or rejected access (no credential, expired, wrong account, no permission for the repository, Git fetch allowed but API refused, or the reverse) is reported in plain words with what to do next, per server and account, and nothing half-opened is shown as the review
- [ ] #9 No secret appears in the chat, the conversation file, a log, a review record or any workspace file; the service credentials are separate from the SSH connection to the DSpatch host and from the AI provider's credentials
- [ ] #10 Fetched material is subject to the same provider permissions and content-exclusion rules as local material; nothing is published back: no comment, vote, approval or push to Gerrit or GitHub
- [ ] #11 Verification is labelled: SIMULATED against local fixtures that model Gerrit and GitHub (hosts, API answers, refs) for the flows and failures above, and LIVE against a real Gerrit and a real GitHub only with Niclas's explicit go-ahead and accounts; live checks are not reported as done from simulated ones
<!-- AC:END -->
