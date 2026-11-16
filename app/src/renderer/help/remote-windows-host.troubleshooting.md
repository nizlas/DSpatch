# Troubleshooting

## The script stops

It says why, and whether it changed anything before it stopped. Its exit code says what kind of stop it was:

- **1, refused or a conflict:** a value is missing or wrong, the PowerShell is not *Run as administrator*, or something on the computer disagrees with the setup, for example an `sshd_config` that is not Windows' default, or a key file others may change. It says what, and never changes `sshd_config` itself.
- **2, restart needed:** restart Windows, then run the Windows command again. Use **Restart**, not Shut down.
- **3, blocked by policy or IT:** the computer's update source or a policy blocks installing OpenSSH Server, or a policy ignores local firewall rules. Ask IT; the script does not work around it.

## The Windows command stops before the script starts

- *The downloaded script is not the one this DSpatch expects*: the file from the release page differs from the one this DSpatch carries, so it was not run. Check that the Linux computer runs the DSpatch version you meant, and ask whoever gave it to you.
- The download fails with a connection, proxy or TLS error: the Windows computer cannot reach GitHub. Use **Other ways → The Windows computer cannot download from GitHub**.
- *overridden by a policy* or *running scripts is disabled*: your organisation sets which scripts may run. Ask IT, or use **Manual setup**.
- *Access is denied* or *must be run as administrator*: the window is not *Run as administrator*. Open PowerShell as administrator and paste the command again.

## `ssh` times out before asking anything

- Check the address: `ping <windows-host>` from Linux (some networks block ping; that alone proves nothing).
- On Windows, `Get-Service sshd` must say `Running`.
- Check the firewall rule: `-RemoteAddress` must be your Linux computer's current address, `-InterfaceAlias` the interface the network uses, and `-Profile` the network's current profile.
- The two computers must be on the same network, and the Windows computer awake.

## `Permission denied (publickey…)`, or the key is not accepted

- Administrator account: the key must be in `C:\ProgramData\ssh\administrators_authorized_keys`, with only Administrators and SYSTEM in its permissions (see **Manual setup**).
- Standard account: `C:\Users\<windows-user>\.ssh\authorized_keys`, written with `Add-Content`.
- The user name must be the Windows account's (see `whoami`), with the domain if it is a domain account.
- Microsoft Entra ID accounts do not support key sign-in.
- On Windows, the *OpenSSH/Operational* event log names the reason: Event Viewer → *Applications and Services Logs* → *OpenSSH* → *Operational*.

## OpenSSH Server will not install

`Add-WindowsCapability` prints an error, or `RestartNeeded : True`. Read the error first: a pending Windows update, no access to Windows Update or a policy that blocks optional features are common causes; on a managed computer ask IT. If a restart is pending, restart, then run the command again. A restart is not guaranteed to fix an install that failed for another reason.

Use **Restart**, not **Shut down**. With *Fast startup* on, Shut down saves the running system and restores it at the next start, so pending changes may not be completed; Restart does a full restart.

## `sudo` seems to hang

It is waiting for your Linux password. It shows no characters while you type.

## DSpatch behaves like an older version

- Check what is installed: `dpkg-query -W dspatch`.
- An old client may still be open. Quit DSpatch, check that `pgrep -a -x dspatch` prints nothing, then start it again.
- Windows keeps earlier host versions under `%LOCALAPPDATA%\DSpatch\host\versions\`; the client picks its own matching build, or asks.

## Logs

- Linux, the client: start it from a terminal (`/opt/DSpatch/dspatch`) and read the lines starting with `[dspatch] [ssh]`.
- Linux, this computer's own host: `~/.config/DSpatch/host.log`.
- Windows, the host: `%APPDATA%\DSpatch\host.log`, and `%APPDATA%\DSpatch\host-start-*.log` from the last start.
- Windows, the SSH server: Event Viewer → *OpenSSH* → *Operational*.
