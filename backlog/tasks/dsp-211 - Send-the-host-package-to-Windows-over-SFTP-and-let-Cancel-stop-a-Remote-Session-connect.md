---
id: DSP-211
title: >-
  Send the host package to Windows over SFTP, and let Cancel stop a Remote
  Session connect
status: Review
assignee: []
created_date: '2026-11-15 22:10'
updated_date: '2026-11-15 22:10'
labels:
  - remote
  - windows
dependencies:
  - DSP-153
  - DSP-182
priority: high
ordinal: 107000
---

## Description

<!-- SECTION:DESCRIPTION:BEGIN -->
Niclas's first Remote Session from the Linux client (1.0.0 built from 7c2e2376d8a7) to his Windows machine over SSH, 15 November 2026, stopped at "Installing host 0%".

Observed (read-only, 15 November 2026): the Windows host recorded in `%APPDATA%\DSpatch\host-running.json` (pid 70624) was no longer running, so Connect correctly went on to install. The installing step `receive` runs Windows PowerShell 5.1 with `[Console]::OpenStandardInput()` copying stdin to `%LOCALAPPDATA%\DSpatch\host\incoming\<package>.part`. The SSH master had sent about 2.35 MB and stopped; the `.part` file stayed at 0 bytes. Reproduced without writing anything: the same PowerShell form received 10, 1 000 and 4 096 bytes, and stalled with 5 000 bytes and more, random or text, also with `-InputFormat None`; `find /c` through the same sshd and cmd.exe received 3 MB. So Windows sshd and cmd.exe pass the data, and Windows PowerShell's standard-input reading does not. Later the stuck attempt's file had grown to 135 168 bytes in about 30 minutes, so PowerShell's reading after the first 4 KB is extremely slow rather than stopped. Why is not established (one hypothesis: its console host reading the redirected input itself). A blocked remote PowerShell did not end when its SSH session was killed.

Also observed: Cancel in the Remote Session dialog only closed the dialog; the connect went on, and its ssh master and step stayed running locally and its PowerShell on Windows.

Change: send the package to Windows over SFTP on the same SSH connection, configuration and authentication as the other steps (PowerShell only prepares the folder and names the path); keep the checksum check and the atomic unpack and rename of `install`; keep the POSIX path. Cancel stops the connect and ends its own ssh and sftp processes, with a plain status.
<!-- SECTION:DESCRIPTION:END -->

## Acceptance Criteria
<!-- AC:BEGIN -->
- [x] #1 The Windows package transfer uses SFTP; no step reads the package from PowerShell's standard input; checksum check, `.part` handling and atomic install unchanged
- [x] #2 SSH config, keys, askpass and the POSIX client's shared connection apply to the transfer as to the other steps
- [x] #3 Cancel stops a connect in progress and ends its own ssh/sftp processes; a transfer failure says so plainly
- [x] #4 Targeted tests pass; the real transfer of the Windows host package from this Linux client to the Windows machine is verified
- [x] #5 A Linux .deb with matching host packages is prepared without publishing; INSTALL.md says what was verified and what remains
<!-- AC:END -->

## Implementation Notes

<!-- SECTION:NOTES:BEGIN -->
15 November 2026, Linux, on main 7c2e237. Built:
- `app/src/shared/host-bootstrap.ts`: `receive` is POSIX only; `receiveOnWindows(file, attempt)` prepares `incoming`, removes leftover `*.part` files where nothing holds them, and names the attempt's own file as an SFTP path (`windowsPartName`); `sftpPut` quotes the batch; `install` takes the attempt's file on Windows. The checksum check, the unpack beside the versions and the rename are unchanged.
- `app/src/main/ssh-connection.ts`: `putInPlace` sends to Windows with `sftp -b -` (option `sftpProgram`, default `sftp`), with `-o BatchMode=no` first so askpass still answers, the connection's own options (config file, `StrictHostKeyChecking=ask`, timeouts, `ClearAllForwardings`, `RemoteCommand=none`) and on a POSIX client the shared master (`ControlPath`, `ControlMaster=no`). Every ssh and sftp of a connection is tracked, and `close` ends them; a step ended that way says "Connect was cancelled." A failed transfer says the target and sftp's last line, and that nothing was installed. The status line says the size being sent, then "checking and unpacking".
- Cancel: `dspatch:ssh-cancel` (preload `sshCancel`) closes the connect in progress; in the Remote Session form, Cancel while connecting stops it and the form shows the answer, and Cancel otherwise closes the form as before (`StartPage.tsx`).

Each Windows attempt has a file of its own because the stuck attempt's PowerShell (pid 31784, started 21:26:53) still held the old `.part` file open, which would otherwise have stopped the next Connect.

Verified:
- `npm run typecheck` clean; `tests/ssh-connection.test.ts` 28/28, including five new tests: the Windows step reads nothing from standard input, uses a file per attempt and install takes it; the SFTP batch quoting; the sftp arguments (BatchMode=no before -b, config, host key checking, no -T); a failed transfer's sentence; Cancel ends a transfer in progress and its process.
- The real transfer, with the built product code (`SshConnection`: shared master, identify, `receiveOnWindows`, `sendToWindows`) from this Linux client to nicla@192.168.50.174: the 1.0.0-7c2e2376d8a7 win32 host package, 112 514 185 bytes, sent in 4.5 s and again in 4.3 s, under test names; on Windows the file had that size and SHA-256 d4a8ccd39042ecdca576d1bdb386f9c5981398113a8ed3797b2083dc694c5c41, and was then removed. The second run was made while the stuck attempt's file was still held. No install and no start were done; `versions` stayed empty.

Clean-up of the investigation's own processes: twelve Windows PowerShell processes started by the read-only stdin tests (identified by their exact command line and a start time between 21:33 and 21:40) were stopped; no other process was touched.

Prepared, not published (local build of 08de9ac, same contract e79215b20268b2ba as the Windows client at 7c2e237): `~/dspatch-08de9ac/` on the Linux client with `dspatch_1.0.0_amd64.deb` (sha256 3b8de477b09edf955a9f9005f5c376edbaaf34bf673df25b7fe4ef90c3b05738; its bundled manifest equals the host packages' and it carries both), `host/dspatch-host-1.0.0-08de9ace6b68-linux-x64.tar.gz` (a92daf72…) and `-win32-x64.tar.gz` (5f6bfc2b…), `host/host-manifest.json` and `SHA256SUMS`; build identity 08de9ac, no dirty files.

Not shown: the install, start and tunnel of an ordinary Connect to Windows with the corrected client; that the host outlives the SSH connection there; Cancel in a real window; a Windows client sending to Windows.
<!-- SECTION:NOTES:END -->
