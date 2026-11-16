# Connect to a Windows computer over SSH

DSpatch on this Linux computer works on a Windows computer on the same network. Three steps.

## 1. Linux: run the helper

In a terminal on this computer, with the Windows account's user name and the Windows computer's address or name:

```bash
bash /opt/DSpatch/resources/bundled/remote-setup/dspatch-prepare-linux-client.sh <windows-user>@<windows-host>
```

It prints one command for Windows, with your public key and the addresses filled in, and saves it as `~/dspatch-windows-command.txt`.

## 2. Windows: run that command as administrator

1. Get the command to the Windows computer: mail or chat it to yourself, or copy the file on a USB stick. It holds only your public key, which is not secret.
2. Open **PowerShell as administrator**: Start → type *PowerShell* → right-click *Windows PowerShell* → *Run as administrator*.
3. Paste the command and press Enter. It downloads DSpatch's Windows script, checks it, shows what it will change and asks *Proceed? [y/N]*. Answer `y`.
4. Leave the window open. At the end it shows this computer's **fingerprints**, which you check in step 3.

## 3. Linux: check the fingerprint, then connect

```bash
ssh <windows-user>@<windows-host>
```

ssh shows a fingerprint and asks whether to trust the computer. Answer `yes` only if it is exactly one of the fingerprints in the Windows window; otherwise answer `no`. Then type `exit`.

In DSpatch, choose **Remote Session**, enter `<windows-user>@<windows-host>` and press **Connect**. The first time, DSpatch installs its host on Windows, which takes a minute.
