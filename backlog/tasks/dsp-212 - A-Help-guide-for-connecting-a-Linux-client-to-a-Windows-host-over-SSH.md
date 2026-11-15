---
id: DSP-212
title: A Help guide for connecting a Linux client to a Windows host over SSH
status: Review
assignee: []
created_date: '2026-11-15 23:00'
updated_date: '2026-11-15 23:30'
labels:
  - remote
  - windows
  - docs
dependencies:
  - DSP-211
ordinal: 108000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's assignment of 15 November 2026: a colleague should be able to install DSpatch on a Linux laptop and connect to a Windows host on the work network with instructions found in the app's Help. The standard case only: Linux client, Windows host, one internal network. What runs where; that projects, agent processes, provider sign-ins and history are on the host; the Windows app versus the host package the client installs without any installer on the Windows screen; both computers on and awake. Windows: OpenSSH Server install and automatic start (administrator PowerShell), user name, address and interface, a narrow firewall rule instead of the broad automatic one, no network profile change without its consequence, the organisation's IT rules. Key sign-in: an existing key or a new one without overwriting, only the public key, its place and permissions for standard and administrator accounts, administrators_authorized_keys and why ssh-copy-id is not a general answer, the host key fingerprint checked on Windows first, placeholders, cmd.exe and PowerShell. Linux and DSpatch: the package, plain ssh first, Remote Session, the automatic transfer, check, install, start and tunnel, Advanced not needed, reuse and the replace question, the first provider setup, the approved provider at work. Troubleshooting kept apart.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 Help → Connect to a Windows Host over SSH… opens the guide in a window of its own; code blocks have a Copy button; https links open in the browser, nothing else navigates
- [x] #2 The guide covers the points above with every command marked by computer and shell, placeholders only, and troubleshooting apart; Windows commands checked against Microsoft's current OpenSSH documentation and the product's own texts
- [x] #3 A test keeps the guide parsing into shell-marked code blocks and free of real addresses and keys
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
15 November 2026. The guide is `app/src/renderer/help/remote-windows-host.md`, built into the renderer (`?raw`) and shown by `HelpWindow.tsx` (`?window=help&topic=remote-windows-host`); the menu item and window are `openHelpGuide` in `app/src/main/main.ts`; `Markdown` takes `copyCode`; the window zooms as kind `help`. INSTALL.md points to it. Checked against Microsoft Learn: *Get started with OpenSSH Server for Windows* (Get-WindowsCapability / Add-WindowsCapability, sshd start and automatic start, the automatic `OpenSSH-Server-In-TCP` rule) and *Key-based authentication in OpenSSH for Windows* (authorized_keys for standard users, administrators_authorized_keys with icacls for Administrators and SYSTEM, SIDs on non-English Windows, no key sign-in for Entra ID accounts). Product texts checked in StartPage.tsx, ssh-connection.ts and HostLink.tsx.

Checked: `npm run typecheck`; `tests/help-guides.test.ts` 2/2 with `markdown.test.ts`; `npm run build` carries the guide and the menu item. Not checked: the window on screen (Niclas looks at it); the commands on a work-managed Windows; the firewall rule on a domain profile.
<!-- SECTION:NOTES:END -->
