# Other ways to run the scripts

The three steps are the recommended way. Use this page only when one of them does not fit.

## The Windows computer cannot download from GitHub

1. On the Linux computer, press **Save Windows script…** above, and carry the file to the Windows computer, for example on a USB stick.
2. On Windows, open **PowerShell as administrator** and go to the file's folder with `cd`.
3. Run the helper's command from `-PublicKey` onwards, with the saved script in front:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
.\dspatch-prepare-windows-host.ps1 -PublicKey '<public key line>' -AllowFrom <linux-client-ip> -User '<windows-user>'
```

`-Scope Process` allows scripts only in this PowerShell window, until you close it; nothing is changed for the computer.

## Download and check the script by hand on Windows

**Windows, PowerShell**, in the folder you want the script in:

```powershell
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/nizlas/DSpatch/releases/download/v{{version}}/dspatch-prepare-windows-host.ps1' -OutFile dspatch-prepare-windows-host.ps1
Invoke-WebRequest -UseBasicParsing -Uri 'https://github.com/nizlas/DSpatch/releases/download/v{{version}}/SHA256SUMS' -OutFile SHA256SUMS
$expected = ((Select-String -Path .\SHA256SUMS -Pattern 'dspatch-prepare-windows-host.ps1').Line -split '\s+')[0]
if ((Get-FileHash .\dspatch-prepare-windows-host.ps1 -Algorithm SHA256).Hash -eq $expected) { 'SHA-256 matches' } else { 'SHA-256 DIFFERS: do not run it' }
```

Then run it as in the section above.

## See the plan without changing anything

Add `-DryRun` to the Windows command. The script shows what it found and what it would change, then stops.

## Other options of the Windows script

- `-User '<windows-user>'`: the account DSpatch signs in as. Left out, it is the account that runs the script.
- `-AllowFrom <network>/24`: allow a whole network instead of one address, when the Linux computer's address changes from day to day.
- `-InterfaceAlias '<InterfaceAlias>'`: the network interface to allow SSH on, when the computer has several. Left out, the script asks.
- `-Yes`: do not ask *Proceed?*. The plan is still shown.

## The helper on a computer without DSpatch's package

Press **Save Linux helper…** above and run the saved file with `bash`. A saved helper does not know the release, so it prints the command for a saved Windows script, as in the first section.
