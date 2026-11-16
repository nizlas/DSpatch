# What has been tested

## Shown

- **15 November 2026**, on a home network, from a Linux client to a Windows 11 computer with key sign-in: DSpatch sent the host package over SFTP, checked, installed and started it, opened the tunnel, and showed the Windows computer's projects; the first provider setup for that host worked. That was a development build of the client, set up with the manual steps, not with the scripts.
- **The Windows script** read through on a real Windows 11 in Windows PowerShell 5.1 without errors, and run there with `-DryRun` only: it found the administrator account, the network interface, the installed OpenSSH and the key file's permissions, and showed its plan. Nothing was changed.
- **The Windows command the helper prints**, on 16 November 2026, on the same Windows 11 computer with a throw-away key and `-DryRun` added: it downloaded the Windows script from the release page, found its SHA-256 to be the expected one, ran it and showed the plan. Nothing was changed, and the downloaded file was removed. The script downloaded was 1.0.2's, which is byte for byte the one in this version.
- **The Linux helper** run in a throw-away home folder: it creates a key only when there is none, never overwrites one, never prints the private key, and prints the Windows command.

## Not yet shown

- The Windows script making its changes on a real computer: installing OpenSSH, the firewall rule, writing the key and its permissions, starting sshd.
- The whole three-step flow from start to end with the released packages.
- Reconnecting after the client or the connection is interrupted, and going on with work after that.
- Cancel in a real window.
- A Windows client connecting to a Windows host.
- A work network with its own policies, and Copilot on such a host.
