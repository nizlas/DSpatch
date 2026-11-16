# Manual setup

The steps the scripts take, by hand. Use them to set up a computer without the scripts, or to check one. Placeholders are written like `<this>`; replace them with your own values. Every command says which computer and which shell it runs in.

## 1. Windows: OpenSSH Server

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

### Who you are, and the computer's address

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

### A narrow firewall rule

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

## 2. Key sign-in

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

### Administrator account

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

### Standard account

**Windows, PowerShell (as that user, not administrator):**

```powershell
$key = '<paste the line from id_ed25519.pub here>'
New-Item -Force -ItemType Directory -Path "$env:USERPROFILE\.ssh" | Out-Null
Add-Content -Force -Path "$env:USERPROFILE\.ssh\authorized_keys" -Value $key
```

Use `Add-Content` as shown: `echo key > file` in Windows PowerShell writes UTF-16, which `sshd` cannot read.

### Why not `ssh-copy-id`?

`ssh-copy-id` runs a POSIX shell on the server and writes `~/.ssh/authorized_keys`. A Windows SSH server starts `cmd.exe` instead, and for an administrator account the key must go to `administrators_authorized_keys` with restricted permissions. So it fails, or puts the key where it is ignored. Use the steps above.

## 3. First sign-in from Linux

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

## 4. Connect

In DSpatch, choose **Remote Session**, enter `<windows-user>@<windows-host>` and press **Connect**, as in step 3 of the three steps.
