# How it works

## What runs where

- **The Linux client** shows the windows. It signs in to Windows with your own `ssh`, sends the host program, and opens an encrypted tunnel to it.
- **The Windows host** does the work. Your **projects, agent processes, provider sign-ins (for example Copilot) and history** are on the Windows computer, under the Windows user you sign in as.
- **The DSpatch Windows app is not needed.** The client installs its own matching host package on Windows, under `%LOCALAPPDATA%\DSpatch\host\versions\`, with nothing on the Windows screen. If the Windows app is also open there, DSpatch asks before the remote session takes over.
- **Both computers must be on**, and the Windows computer awake, while you work. Work started on the host goes on if the client is closed.

This is for one internal network. The internet or a VPN is a different setup. Nothing here needs port forwarding or a fixed public IP address. Your organisation's IT rules decide whether you may run an SSH server and change the firewall on a work computer.

## What the Linux helper does

It uses your existing SSH key, or creates `~/.ssh/id_ed25519` if you have none. It never overwrites a key and never shows or copies the private key; only the public key goes into the command. It finds the address this computer uses to reach the Windows computer. The command it prints downloads the Windows script of this DSpatch version from the release page, and runs it only if its SHA-256 is the one this DSpatch carries. Running the helper again changes nothing but the saved command file.

## What the Windows script does

It first shows what it found and its plan, and asks before it changes anything. Then it:

- installs **OpenSSH Server** if it is missing. It never restarts Windows: if a restart is needed, it says so and stops, and you run the command again after the restart;
- creates its own firewall rule, `DSpatch-SSH-In`, that allows SSH only from the Linux computer's address, on the network interface you use, **before** sshd starts. It turns off the broad rule the install creates, but not when SSH was already in use on this computer: then it explains and leaves the choice to you. It never changes the network profile;
- puts the public key where sshd reads it for that account (`administrators_authorized_keys` for an administrator, the user's own `.ssh\authorized_keys` otherwise), once, and sets the file's permissions. It reads `sshd_config` to decide and never changes it;
- starts sshd and has it start with Windows;
- prints this computer's host key fingerprints and the `ssh` command for the Linux computer.

Running it again changes only what is not already in place.

## What Connect does

The status line under the field says what is happening:

1. *Connecting…*: DSpatch runs your own `ssh`, with your `~/.ssh/config`, keys, agent and known hosts.
2. If no matching host runs on Windows, *Installing host…* and *sending … MB*: DSpatch sends the host package that came with this client over SFTP, on the same connection.
3. *checking and unpacking it…*: Windows checks the package's SHA-256 against what this client expects. Only then is it unpacked beside earlier versions and put in place. A failed or interrupted attempt leaves working versions alone.
4. *Starting host…*, then *Opening the tunnel…*: the host starts on Windows and outlives the SSH connection; the client reaches it through an SSH tunnel bound to the local computer only.
5. The window shows the Windows computer's projects.

**Cancel**, while connecting, stops the attempt and ends its own `ssh` and `sftp` processes. **Advanced → Host token** is not needed; it is for a host you started by hand.

## When a host already runs on Windows

- **The same build as the client:** DSpatch uses it.
- **Another build that can work with this client:** DSpatch asks *Replace it?* **No** keeps using the running host as it is. **Yes** stops it, which ends any work running there with an unknown outcome, and starts this client's build.
- **A build that cannot work with this client:** only Yes can continue; No stops and changes nothing.
- **The DSpatch Windows app is open there:** DSpatch asks before it takes over. Running work is not interrupted.

## The first time with a provider

The provider support a host uses (for example the Copilot or Claude programs) is set up per host installation, in `%APPDATA%\DSpatch\provider-support` on Windows. A new host may need it set up once; if DSpatch says so, follow the dialog. The sign-in belongs to the Windows user. At work, use the provider your organisation has approved, under its rules.
