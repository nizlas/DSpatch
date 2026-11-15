# Connect to a Windows host over SSH

This guide covers one setup: **DSpatch on a Linux computer (the client) working on a Windows computer (the host) on the same internal network**, over SSH.

Placeholders are written like `<this>`. Replace them with your own values; never copy someone else's user name, address or key. Every command says which computer and which shell it runs in.

Your organisation's IT rules decide whether you may run an SSH server and change the firewall on a work computer. Follow them; this guide does not replace them.

## The short way

Two scripts come with DSpatch {{version}} and do the setup. Each shows what it will do first. The manual steps they follow are under **Manual setup (reference)** further down.

### 1. Linux: run the helper

Install DSpatch on the Linux computer first (the `.deb`, see **DSpatch on Linux** below); the helper comes with it.

**Linux, terminal:**

```bash
bash /opt/DSpatch/resources/bundled/remote-setup/dspatch-prepare-linux-client.sh <windows-user>@<windows-host>
```

`<windows-host>` is the Windows computer's address or name. The helper uses your existing SSH key, or creates one if you have none; it never overwrites a key and never shows or copies the private key. It prints your **public** key and the exact command to run on Windows, with this computer's address filled in. Running it again changes nothing.

### 2. Windows: run the host script

Get `dspatch-prepare-windows-host.ps1` onto the Windows computer, one of two ways:

- On the Linux computer, press **Save Windows script…** at the top of this window, and carry the file over on a USB stick or a share. (**Save Linux helper…** saves the other script.)
- Or download it on Windows from this version's [release page](https://github.com/nizlas/DSpatch/releases/tag/v{{version}}) and check it against `SHA256SUMS`.

**Windows, PowerShell:** download and check, in the folder you want the script in:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/nizlas/DSpatch/releases/download/v{{version}}/dspatch-prepare-windows-host.ps1' -OutFile dspatch-prepare-windows-host.ps1
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/nizlas/DSpatch/releases/download/v{{version}}/SHA256SUMS' -OutFile SHA256SUMS
$expected = ((Select-String -Path .\SHA256SUMS -Pattern 'dspatch-prepare-windows-host.ps1').Line -split '\s+')[0]
if ((Get-FileHash .\dspatch-prepare-windows-host.ps1 -Algorithm SHA256).Hash -eq $expected) { 'SHA-256 matches' } else { 'SHA-256 DIFFERS: do not run it' }
```

Open **PowerShell as administrator** (Start → type *PowerShell* → right-click → *Run as administrator*), and go to the script's folder with `cd`.

**Windows, PowerShell (administrator):** let this window run the script:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

Windows does not run downloaded scripts by default. `-Scope Process` allows it **only in this PowerShell window**, until you close it; nothing is changed for the computer. Some organisations forbid this by policy; then PowerShell says the setting is overridden, and you ask IT. If scripts are already allowed (`RemoteSigned`), `Unblock-File .\dspatch-prepare-windows-host.ps1` is enough.

Now run the command the Linux helper printed. Add `-DryRun` the first time: it shows what the script found and its plan, and changes nothing.

```powershell
.\dspatch-prepare-windows-host.ps1 -PublicKey '<public key line>' -AllowFrom <linux-client-ip> -User '<windows-user>' -DryRun
```

Then run it without `-DryRun`. It shows the plan again and asks *Proceed? [y/N]*. What it does:

- installs **OpenSSH Server** if it is missing. It never restarts Windows: if a restart is needed, it says so and stops, and you run it again after the restart;
- creates its own firewall rule, `DSpatch-SSH-In`, that allows SSH only from `-AllowFrom`, on the network interface you use, **before** sshd starts. It turns off the broad rule the install creates, but not when SSH was already in use on this computer: then it explains and leaves the choice to you. It never changes the network profile;
- puts the public key where sshd reads it for that account (`administrators_authorized_keys` for an administrator, the user's own `.ssh\authorized_keys` otherwise), once, and sets the file's permissions. It reads `sshd_config` to decide and never changes it;
- starts sshd and has it start with Windows;
- prints this computer's **host key fingerprints** and the `ssh` command for the Linux computer.

Leave out `-User` to set up the account that runs the script. If the computer has several networks, the script asks which one, or `-InterfaceAlias '<InterfaceAlias>'` names it.

### 3. Linux: check the fingerprint, then Connect

**Linux, terminal:**

```bash
ssh <windows-user>@<windows-host>
```

ssh shows the Windows computer's fingerprint and asks whether to trust it. Answer `yes` only if it is exactly one of the fingerprints the script printed. You are then signed in without a password; type `exit`.

Then start DSpatch, choose **Remote Session**, enter `<windows-user>@<windows-host>` and press **Connect**. What happens then is under **DSpatch on Linux** below.

## What runs where

- **The Linux client** shows the windows. It signs in to Windows with your own `ssh`, sends the host program, and opens an encrypted tunnel to it.
- **The Windows host** does the work. Your **projects, agent processes, provider sign-ins (for example Copilot) and history** are on the Windows computer, under the Windows user you sign in as.
- **The DSpatch Windows app is not needed.** The client installs its own matching host package on Windows, under `%LOCALAPPDATA%\DSpatch\host\versions\`, with nothing on the Windows screen. If the Windows app is also open there, DSpatch asks before the remote session takes over.
- **Both computers must be on**, and the Windows computer awake, while you work. Work started on the host goes on if the client is closed.

This is for one internal network. The internet or a VPN is a different setup and is not covered. Nothing here needs port forwarding or a fixed public IP address.

## Manual setup (reference)

These are the steps the scripts take, by hand. Use them to understand the setup, to do it without the scripts, or to check a computer.

### 1. Windows: OpenSSH Server

You need a Windows 10 (1809 or later) or Windows 11 computer and an account in the Administrators group for this part.

Open **PowerShell as administrator** (Start → type *PowerShell* → right-click → *Run as administrator*).

**Windows, PowerShell (administrator):** is OpenSSH Server installed?

```powershell
Get-WindowsCapability -Online | Where-Object Name -like 'OpenSSH*'
```

If `OpenSSH.Server~~~~0.0.1.0` shows `State : NotPresent`, install it:

```powershell
Add-WindowsCapability -Online -Name OpenSSH.Server~~~~0.0.1.0
```

Start the service, and have it start by itself after a restart:

```powershell
Start-Service sshd
Set-Service -Name sshd -StartupType 'Automatic'
Get-Service sshd
```

`Get-Service` should say `Running`.

#### Who you are, and the computer's address

**Windows, PowerShell:** your user name as SSH sees it, and whether it is an administrator account (this decides where your key goes in step 2):

```powershell
whoami
whoami /groups | Select-String 'S-1-5-32-544'
```

`S-1-5-32-544` is the Administrators group in every language of Windows. If the second line prints a line, the account is an administrator, also when that line says *Group used for deny only*: that is how an administrator's ordinary, not elevated, PowerShell shows it. If it prints nothing, it is a standard account. Do not use `IsInRole` in an ordinary PowerShell for this: it answers for the window's restricted rights, not for the account.

For another account than your own, in PowerShell as administrator:

```powershell
Get-LocalGroupMember -SID S-1-5-32-544
```

A domain account can also be an administrator through a domain group listed there.

**Windows, PowerShell:** the network interface and address on the internal network:

```powershell
Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null } | Format-List InterfaceAlias, IPv4Address
Get-NetConnectionProfile | Format-List InterfaceAlias, Name, NetworkCategory
```

Note the `InterfaceAlias` (for example `Ethernet` or `Wi-Fi`) and the `IPv4Address`. That address, or the computer's name if your network resolves it, is `<windows-host>` below. `NetworkCategory` is `Public`, `Private` or `DomainAuthenticated`.

**Linux, terminal:** your Linux computer's address on the same network:

```bash
ip -4 -brief address
```

That address is `<linux-client-ip>`. If it changes from day to day (DHCP), use the network's range instead, for example `<network>/24`, or ask IT for a fixed address.

#### A narrow firewall rule

Installing OpenSSH Server creates a firewall rule named `OpenSSH-Server-In-TCP` that allows port 22 from any address. Replace it with a rule that only allows your Linux computer, on the interface you use.

**Windows, PowerShell (administrator):** see the automatic rule:

```powershell
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' | Format-List Name, Enabled, Profile
```

Create the narrow rule. Use the interface alias and the profile (`Public`, `Private` or `Domain`) that `Get-NetConnectionProfile` showed; `DomainAuthenticated` is the `Domain` profile.

```powershell
New-NetFirewallRule -Name 'DSpatch-SSH-In' -DisplayName 'SSH for DSpatch from one client' -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -RemoteAddress '<linux-client-ip>' -InterfaceAlias '<InterfaceAlias>' -Profile '<Profile>'
```

Then turn the broad rule off, so the two do not stand open side by side. If other people already sign in to this computer over SSH, ask first: this rule may be what lets them in.

```powershell
Disable-NetFirewallRule -Name 'OpenSSH-Server-In-TCP'
```

Do not change the network's profile (for example from Public to Private) just to make SSH work. That changes what every other firewall rule allows on that network, not only SSH. If it is needed, decide it with whoever runs the network.

On a managed work computer, firewall changes may be blocked or overridden by policy. Then ask IT for an SSH rule limited to your client instead of working around it.

### 2. Key sign-in

DSpatch signs in with your SSH key. Only the **public** key (the `.pub` file) ever leaves the Linux computer.

**Linux, terminal:** do you already have a key?

```bash
ls -l ~/.ssh/*.pub
```

If there is none, create one. If `ssh-keygen` asks whether to overwrite an existing file, answer **n**: an existing key is still in use somewhere.

```bash
ssh-keygen -t ed25519
```

Show the public key, and copy the one line it prints:

```bash
cat ~/.ssh/id_ed25519.pub
```

(Use the name of the `.pub` file you actually have, if it is not `id_ed25519.pub`.)

On Windows, where the key goes depends on the account (step 1, `whoami /groups`):

- **Administrator account:** `C:\ProgramData\ssh\administrators_authorized_keys`. This is what Windows' default `sshd_config` says for members of the Administrators group (`Match Group administrators`); a key in the user's own folder is then **ignored**.
- **Standard account:** `C:\Users\<windows-user>\.ssh\authorized_keys`.

**Windows, PowerShell (administrator):** check what your `sshd_config` actually says:

```powershell
Select-String -Path "$env:ProgramData\ssh\sshd_config" -Pattern '^\s*Match Group administrators' -Context 0,1
```

If it prints the `Match Group administrators` line and an `AuthorizedKeysFile __PROGRAMDATA__/ssh/administrators_authorized_keys` line, the administrator rule above applies.

#### Administrator account

**Windows, PowerShell (administrator).** Paste your public key line between the quotes:

```powershell
$key = '<paste the line from id_ed25519.pub here>'
Add-Content -Force -Path "$env:ProgramData\ssh\administrators_authorized_keys" -Value $key
icacls.exe "$env:ProgramData\ssh\administrators_authorized_keys" /inheritance:r /grant:r "*S-1-5-32-544:F" "*S-1-5-18:F"
icacls.exe "$env:ProgramData\ssh\administrators_authorized_keys"
```

`sshd` refuses this file unless only Administrators (`S-1-5-32-544`) and SYSTEM (`S-1-5-18`) may change it. The SIDs work in every language of Windows. `/inheritance:r` removes the entries inherited from the folder, and `/grant:r` gives those two full control. Entries that were set on the file itself stay, so read what the last line prints: it must list only `BUILTIN\Administrators` and `NT AUTHORITY\SYSTEM` (in your Windows' language), each with `(F)`. Remove any other entry:

```powershell
icacls.exe "$env:ProgramData\ssh\administrators_authorized_keys" /remove "<name or *SID shown by icacls>"
```

#### Standard account

**Windows, PowerShell (as that user, not administrator):**

```powershell
$key = '<paste the line from id_ed25519.pub here>'
New-Item -Force -ItemType Directory -Path "$env:USERPROFILE\.ssh" | Out-Null
Add-Content -Force -Path "$env:USERPROFILE\.ssh\authorized_keys" -Value $key
```

Use `Add-Content` as shown: `echo key > file` in Windows PowerShell writes UTF-16, which `sshd` cannot read.

#### Why not `ssh-copy-id`?

`ssh-copy-id` runs a POSIX shell on the server and writes `~/.ssh/authorized_keys`. A Windows SSH server starts `cmd.exe` instead, and for an administrator account the key must go to `administrators_authorized_keys` with restricted permissions. So it fails, or puts the key where it is ignored. Use the steps above.

### 3. First sign-in from Linux

Before you accept the Windows computer's host key on Linux, read its fingerprint on Windows. Then you know you are talking to the right computer.

**Windows, PowerShell (administrator):**

```powershell
Get-ChildItem "$env:ProgramData\ssh\ssh_host_*_key.pub" | ForEach-Object { ssh-keygen -l -f $_.FullName }
```

**Linux, terminal:**

```bash
ssh <windows-user>@<windows-host>
```

The first time, ssh shows a fingerprint such as `ED25519 key fingerprint is SHA256:…`. Answer `yes` only if it is exactly one of the fingerprints Windows printed. Otherwise answer `no` and find out why.

If the key is in place, you are signed in without a password, at a `cmd.exe` prompt such as `<computer>\<windows-user>@<COMPUTER> C:\Users\<windows-user>>`. SSH on Windows starts `cmd.exe` by default. To use PowerShell in that session, type `powershell`; type `exit` to leave it, and `exit` again to sign out.

If a domain account is used, the user name may need the domain: `ssh '<domain>\<windows-user>'@<windows-host>`.

### 4. DSpatch on Linux

**Linux, terminal:** install the current Linux package from the release page. Use the file's actual name:

```bash
cd ~/Downloads && sha256sum -c SHA256SUMS --ignore-missing && sudo apt install ./dspatch_<version>_amd64.deb
```

`SHA256SUMS` comes from the same release page. `sudo` asks for your **Linux** password and shows nothing while you type; type it and press Enter.

Start DSpatch. On the start page, choose **Remote Session**. In **Machine**, enter `<windows-user>@<windows-host>` (or an alias from your `~/.ssh/config`) and press **Connect**.

What happens, in the status line under the field:

1. *Connecting…*: DSpatch runs your own `ssh`, with your `~/.ssh/config`, keys, agent and known hosts.
2. If no matching host runs on Windows, *Installing host…* and *sending … MB*: DSpatch sends the host package that came with this client over SFTP, on the same connection.
3. *checking and unpacking it…*: Windows checks the package's SHA-256 against what this client expects. Only then is it unpacked beside earlier versions and put in place. A failed or interrupted attempt leaves working versions alone.
4. *Starting host…*, then *Opening the tunnel…*: the host starts on Windows and outlives the SSH connection; the client reaches it through an SSH tunnel bound to the local computer only.
5. The window shows the Windows computer's projects.

**Advanced → Host token** is not needed for this. It is for connecting to a host you started by hand.

**Cancel**, while connecting, stops the attempt and ends its own `ssh` and `sftp` processes; the status line says *Connect was cancelled*. Press Cancel again to close the dialog.

#### When a host already runs on Windows

- **The same build as the client:** DSpatch uses it.
- **Another build that can work with this client:** DSpatch asks *Replace it?* **No** keeps using the running host as it is. **Yes** stops it, which ends any work running there with an unknown outcome, and starts this client's build.
- **A build that cannot work with this client:** only Yes can continue; No stops and changes nothing.
- **The DSpatch Windows app is open there:** DSpatch asks before it takes over. The app then stops working in its window until someone chooses to use it there again. Running work is not interrupted.

#### The first time with a provider

The provider support a host uses (for example the Copilot or Claude programs) is set up per host installation, in `%APPDATA%\DSpatch\provider-support` on Windows. A host installed this way may need it set up once, even if the provider already worked on that computer when DSpatch was run from a development checkout. If DSpatch says the provider needs to be set up, follow the dialog; the sign-in belongs to the Windows user.

At work, use the provider your organisation has approved (for example Copilot), under its rules.

## Troubleshooting

### The script stops

It says why, and whether it changed anything before it stopped. Its exit code says what kind of stop it was:

- **1, refused or a conflict:** a value is missing or wrong, the PowerShell is not *Run as administrator*, or something on the computer disagrees with the setup, for example an `sshd_config` that is not Windows' default, or a key file others may change. It says what, and never changes `sshd_config` itself.
- **2, restart needed:** restart Windows, then run the script again. Use **Restart**, not Shut down.
- **3, blocked by policy or IT:** the computer's update source or a policy blocks installing OpenSSH Server, or a policy ignores local firewall rules. Ask IT; the script does not work around it.

### PowerShell will not run the script

- *running scripts is disabled on this system*: run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` in the same window first, as in the short way above.
- *overridden by a policy*: your organisation sets which scripts may run. Ask IT, or use the manual setup below.
- *is not digitally signed* with the policy `RemoteSigned`: the file is marked as downloaded. `Unblock-File .\dspatch-prepare-windows-host.ps1` removes the mark, after you have checked its SHA-256.
- `Invoke-WebRequest` fails with a TLS or connection error in Windows PowerShell 5.1: run `[Net.ServicePointManager]::SecurityProtocol = 'Tls12'` in that window and try again, or save the script from Help on the Linux computer instead.

### `ssh` times out before asking anything

- Check the address: `ping <windows-host>` from Linux (some networks block ping; that alone proves nothing).
- On Windows, `Get-Service sshd` must say `Running`.
- Check the firewall rule: `-RemoteAddress` must be your Linux computer's current address, `-InterfaceAlias` the interface the network uses, and `-Profile` the network's current profile.
- The two computers must be on the same network, and the Windows computer awake.

### `Permission denied (publickey…)`, or the key is not accepted

- Administrator account: the key must be in `C:\ProgramData\ssh\administrators_authorized_keys`, with only Administrators and SYSTEM in its permissions (`icacls` above).
- Standard account: `C:\Users\<windows-user>\.ssh\authorized_keys`, written with `Add-Content`.
- The user name must be the Windows account's (see `whoami`), with the domain if it is a domain account.
- Microsoft Entra ID accounts do not support key sign-in.
- On Windows, the *OpenSSH/Operational* event log names the reason: Event Viewer → *Applications and Services Logs* → *OpenSSH* → *Operational*.

### OpenSSH Server will not install

`Add-WindowsCapability` prints an error, or `RestartNeeded : True`. Read the error first: a pending Windows update, no access to Windows Update or a policy that blocks optional features are common causes; on a managed computer ask IT. If a restart is pending, restart, then run the check again. A restart is not guaranteed to fix an install that failed for another reason.

Use **Restart**, not **Shut down**. With *Fast startup* on, Shut down saves the running system and restores it at the next start, so pending changes may not be completed; Restart does a full restart.

### `sudo` seems to hang

It is waiting for your Linux password. It shows no characters while you type.

### DSpatch behaves like an older version

- Check what is installed: `dpkg-query -W dspatch`.
- An old client may still be open. Quit DSpatch, check that `pgrep -a -x dspatch` prints nothing, then start it again.
- Windows keeps earlier host versions under `%LOCALAPPDATA%\DSpatch\host\versions\`; the client picks its own matching build, or asks.

### Logs

- Linux, the client: start it from a terminal (`/opt/DSpatch/dspatch`) and read the lines starting with `[dspatch] [ssh]`.
- Linux, this computer's own host: `~/.config/DSpatch/host.log`.
- Windows, the host: `%APPDATA%\DSpatch\host.log`, and `%APPDATA%\DSpatch\host-start-*.log` from the last start.
- Windows, the SSH server: Event Viewer → *OpenSSH* → *Operational*.

## What has and has not been shown

Shown on 15 November 2026 on a home network, from a Linux client to a Windows 11 computer, with key sign-in: the host package sent over SFTP, checked, installed and started by DSpatch, the tunnel opened, and the Windows computer's projects shown in the client; and the first provider setup for that host.

The two scripts of the short way have not yet been run on a real Windows computer to change it; their checks and plan have been reviewed, not tried.

Not yet shown: reconnecting after the client or the connection is interrupted, and going on with work after that; Cancel in a real window; a Windows client connecting to a Windows host; a work network with its own policies.
