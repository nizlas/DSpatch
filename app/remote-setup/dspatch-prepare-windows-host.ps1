<#
.SYNOPSIS
Prepares this Windows computer as an SSH host for DSpatch on a Linux computer (DSP-214).

.DESCRIPTION
Installs OpenSSH Server if it is missing, allows SSH only from the address or network you give,
on the network interface you use, puts your PUBLIC key where sshd reads it for the account, sets
that file's permissions, and starts sshd with automatic start. It never changes sshd_config, the
network profile, update or policy settings, and never restarts Windows.

It first shows what it found and a plan of exactly what it will change, and asks before it
changes anything. -DryRun stops after the plan and changes nothing. Running it again changes only
what is not already in place: no duplicate keys, no duplicate firewall rules.

Run it in PowerShell as administrator. Windows PowerShell 5.1 and PowerShell 7 both work.

Exit codes: 0 done, 1 refused or a conflict, 2 restart Windows and run again, 3 blocked by policy
or the computer's update source (ask IT).

.PARAMETER PublicKey
The public key line from the Linux computer, for example the contents of ~/.ssh/id_ed25519.pub.

.PARAMETER PublicKeyFile
A file holding that one public key line, instead of -PublicKey.

.PARAMETER User
The Windows account that DSpatch signs in as. Default: the account this PowerShell runs as.

.PARAMETER AllowFrom
The Linux computer's IPv4 address, or its network in CIDR form (for example <network>/24).
Required: SSH is allowed only from there.

.PARAMETER InterfaceAlias
The network interface to allow SSH on, when the computer has more than one with a default gateway.

.PARAMETER DryRun
Inspect and show the plan, then stop. Changes nothing.

.PARAMETER Yes
Do not ask "Proceed?". The plan is still shown first.

.EXAMPLE
.\dspatch-prepare-windows-host.ps1 -PublicKey '<public key line>' -AllowFrom <linux-client-ip> -DryRun

.EXAMPLE
.\dspatch-prepare-windows-host.ps1 -PublicKeyFile '<path to id_ed25519.pub>' -User '<windows-user>' -AllowFrom <linux-client-ip>
#>
#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$PublicKey,
    [string]$PublicKeyFile,
    [string]$User,
    [string]$AllowFrom,
    [string]$InterfaceAlias,
    [switch]$DryRun,
    [switch]$Yes
)

Set-StrictMode -Version 1.0
$ErrorActionPreference = 'Stop'

$ExitOk = 0
$ExitRefused = 1
$ExitRestart = 2
$ExitPolicy = 3

$AdministratorsSid = 'S-1-5-32-544'
$SystemSid = 'S-1-5-18'
$CapabilityName = 'OpenSSH.Server~~~~0.0.1.0'
$OwnRuleName = 'DSpatch-SSH-In'
$BroadRuleName = 'OpenSSH-Server-In-TCP'
$SshDir = Join-Path $env:ProgramData 'ssh'
$SshdConfigPath = Join-Path $SshDir 'sshd_config'
$AdminKeysPath = Join-Path $SshDir 'administrators_authorized_keys'
$KeyTypes = @(
    'ssh-ed25519',
    'ecdsa-sha2-nistp256',
    'ecdsa-sha2-nistp384',
    'ecdsa-sha2-nistp521',
    'ssh-rsa',
    'sk-ssh-ed25519@openssh.com',
    'sk-ecdsa-sha2-nistp256@openssh.com'
)
$RestartText = 'Restart Windows (Restart, not Shut down: with Fast startup, Shut down does not finish pending changes), then run this script again.'

$script:Changed = New-Object System.Collections.Generic.List[string]
$script:InPlace = New-Object System.Collections.Generic.List[string]
$script:Notes = New-Object System.Collections.Generic.List[string]
$script:Conflicts = New-Object System.Collections.Generic.List[string]

trap {
    Write-Host ''
    Write-Host "Stopped by an unexpected error: $($_.Exception.Message)" -ForegroundColor Red
    if ($script:Changed.Count -gt 0) {
        Write-Host 'Changed before the error:'
        foreach ($line in $script:Changed) { Write-Host "  - $line" }
    } else {
        Write-Host 'Nothing was changed.'
    }
    exit $ExitRefused
}

# ------------------------------------------------------------------------------------------------
# Output and small helpers (read-only)
# ------------------------------------------------------------------------------------------------

function Write-Line([string]$Text = '') { Write-Host $Text }
function Write-Heading([string]$Text) { Write-Host ''; Write-Host $Text -ForegroundColor Cyan }
function Write-Warn([string]$Text) { Write-Host "WARNING: $Text" -ForegroundColor Yellow }

function Stop-Script([int]$Code, [string]$Text) {
    Write-Host ''
    Write-Host $Text -ForegroundColor Red
    if ($script:Changed.Count -gt 0) {
        Write-Host 'Changed by this run before it stopped:'
        foreach ($line in $script:Changed) { Write-Host "  - $line" }
    } else {
        Write-Host 'Nothing was changed.'
    }
    exit $Code
}

function Test-Interactive {
    try { return ([Environment]::UserInteractive -and -not [Console]::IsInputRedirected) } catch { return $false }
}

# A native program's output without Windows PowerShell 5.1 turning its stderr into an error.
function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
    $ErrorActionPreference = 'Continue'
    $output = & $FilePath @Arguments 2>&1 | ForEach-Object { "$_" }
    return [pscustomobject]@{ ExitCode = $LASTEXITCODE; Output = @($output) }
}

function Get-SidName([string]$Sid) {
    try {
        return (New-Object Security.Principal.SecurityIdentifier($Sid)).Translate([Security.Principal.NTAccount]).Value
    } catch {
        return $Sid
    }
}

# ------------------------------------------------------------------------------------------------
# IPv4 addresses and networks
# ------------------------------------------------------------------------------------------------

function ConvertTo-IPv4Number([string]$Address) {
    $parts = $Address.Split('.')
    if ($parts.Count -ne 4) { return $null }
    [int64]$number = 0
    foreach ($part in $parts) {
        if ($part -notmatch '^\d{1,3}$') { return $null }
        $value = [int]$part
        if ($value -gt 255) { return $null }
        $number = $number * 256 + $value
    }
    return $number
}

function ConvertFrom-IPv4Number([int64]$Number) {
    return '{0}.{1}.{2}.{3}' -f (($Number -shr 24) -band 255), (($Number -shr 16) -band 255), (($Number -shr 8) -band 255), ($Number -band 255)
}

function Get-PrefixMask([int]$Prefix) {
    if ($Prefix -le 0) { return [int64]0 }
    return [int64]4294967295 - ([int64][math]::Pow(2, 32 - $Prefix) - 1)
}

# "a.b.c.d", "a.b.c.d/nn" or Windows' "a.b.c.d/m.m.m.m" as a network, or $null.
function ConvertTo-Network([string]$Text) {
    $text = $Text.Trim()
    $address = $text
    $prefix = 32
    if ($text.Contains('/')) {
        $address, $suffix = $text.Split('/', 2)
        if ($suffix -match '^\d{1,2}$') {
            $prefix = [int]$suffix
            if ($prefix -gt 32) { return $null }
        } else {
            $mask = ConvertTo-IPv4Number $suffix
            if ($null -eq $mask) { return $null }
            $prefix = 0
            while ($prefix -lt 32 -and ((Get-PrefixMask ($prefix + 1)) -band $mask) -eq (Get-PrefixMask ($prefix + 1))) { $prefix++ }
            if ((Get-PrefixMask $prefix) -ne $mask) { return $null }
        }
    }
    $number = ConvertTo-IPv4Number $address
    if ($null -eq $number) { return $null }
    $network = $number -band (Get-PrefixMask $prefix)
    $ruleText = if ($prefix -eq 32) { ConvertFrom-IPv4Number $network } else { '{0}/{1}' -f (ConvertFrom-IPv4Number $network), $prefix }
    return [pscustomobject]@{ Network = $network; Prefix = $prefix; Address = $number; RuleText = $ruleText }
}

function Test-InNetwork([int64]$Address, [int64]$Network, [int]$Prefix) {
    return (($Address -band (Get-PrefixMask $Prefix)) -eq $Network)
}

# ------------------------------------------------------------------------------------------------
# The public key
# ------------------------------------------------------------------------------------------------

function Read-PublicKey([string]$Text) {
    if ($Text -match 'PRIVATE KEY') {
        return @{ Error = 'This is a PRIVATE key. Never copy a private key to another computer. Give the public key: the one line in the .pub file.' }
    }
    $line = $Text.Trim()
    if ($line -match "[`r`n]") {
        return @{ Error = 'The public key must be one line. Give exactly one key.' }
    }
    $pattern = '^(?<type>[a-z0-9@.-]+) (?<blob>[A-Za-z0-9+/]+={0,3})(?: (?<comment>[^\x00-\x1f]*))?$'
    $match = [regex]::Match(($line -replace '\s+', ' '), $pattern)
    if (-not $match.Success -or $KeyTypes -notcontains $match.Groups['type'].Value) {
        return @{ Error = "That does not look like an OpenSSH public key line. It should start with one of: $($KeyTypes -join ', '), then the key, then an optional comment." }
    }
    $type = $match.Groups['type'].Value
    $blob = $match.Groups['blob'].Value
    try { $bytes = [Convert]::FromBase64String($blob) } catch { return @{ Error = 'The key part of the line is not valid base64. Copy the whole line again.' } }
    if ($bytes.Length -lt 8) { return @{ Error = 'The key is too short. Copy the whole line again.' } }
    $length = ([int]$bytes[0] -shl 24) -bor ([int]$bytes[1] -shl 16) -bor ([int]$bytes[2] -shl 8) -bor [int]$bytes[3]
    if ($length -le 0 -or $length -gt $bytes.Length - 4 -or [Text.Encoding]::ASCII.GetString($bytes, 4, $length) -ne $type) {
        return @{ Error = "The key data does not match its type '$type'. Copy the whole line again." }
    }
    $comment = $match.Groups['comment'].Value
    $sha = [Security.Cryptography.SHA256]::Create()
    $fingerprint = 'SHA256:' + ([Convert]::ToBase64String($sha.ComputeHash($bytes))).TrimEnd('=')
    $clean = if ($comment -ne '') { "$type $blob $comment" } else { "$type $blob" }
    return @{ Error = $null; Type = $type; Blob = $blob; Comment = $comment; Line = $clean; Identity = "$type $blob"; Fingerprint = $fingerprint }
}

# "type base64" of a line in an authorized_keys file, options and comment ignored.
function Get-KeyIdentity([string]$Line) {
    $tokens = @($Line.Trim() -split '\s+')
    for ($i = 0; $i -lt $tokens.Count - 1; $i++) {
        if ($KeyTypes -contains $tokens[$i]) { return "$($tokens[$i]) $($tokens[$i + 1])" }
    }
    return $null
}

# What an existing key file holds: its encoding, whether it ends in a newline, and its keys.
function Read-KeyFile([string]$Path) {
    $state = @{ Exists = $false; Readable = $true; Utf16 = $false; Bom = $false; EndsWithNewline = $true; Identities = @() }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return $state }
    $state.Exists = $true
    try { $bytes = [IO.File]::ReadAllBytes($Path) } catch { $state.Readable = $false; return $state }
    if ($bytes.Length -ge 2 -and (($bytes[0] -eq 0xFF -and $bytes[1] -eq 0xFE) -or ($bytes[0] -eq 0xFE -and $bytes[1] -eq 0xFF) -or ($bytes -contains 0))) {
        $state.Utf16 = $true
        return $state
    }
    $state.Bom = ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF)
    $text = (New-Object Text.UTF8Encoding $false).GetString($bytes)
    $state.EndsWithNewline = ($text.Length -eq 0 -or $text.EndsWith("`n"))
    $state.Identities = @($text -split "`r?`n" | ForEach-Object { Get-KeyIdentity $_ } | Where-Object { $_ })
    return $state
}

# ------------------------------------------------------------------------------------------------
# Accounts and Administrators membership, by SID
# ------------------------------------------------------------------------------------------------

function Test-Elevated {
    # The token's integrity level, by SID: High (S-1-16-12288) or System (S-1-16-16384).
    $who = Invoke-Native 'whoami.exe' @('/groups', '/fo', 'csv', '/nh')
    if ($who.ExitCode -eq 0) {
        $text = $who.Output -join "`n"
        return ($text -match '"S-1-16-12288"' -or $text -match '"S-1-16-16384"')
    }
    # .NET lists only enabled groups, so an administrator's filtered token does not have S-1-5-32-544 here.
    return [bool]([Security.Principal.WindowsIdentity]::GetCurrent().Groups | Where-Object { $_.Value -eq $AdministratorsSid })
}

function Resolve-Account([string]$Name) {
    $current = [Security.Principal.WindowsIdentity]::GetCurrent()
    if ([string]::IsNullOrWhiteSpace($Name)) {
        $sid = $current.User
    } else {
        $lookup = $Name.Trim()
        if ($lookup.StartsWith('.\')) { $lookup = "$env:COMPUTERNAME\" + $lookup.Substring(2) }
        try {
            $sid = (New-Object Security.Principal.NTAccount($lookup)).Translate([Security.Principal.SecurityIdentifier])
        } catch {
            Stop-Script $ExitRefused "No Windows account named '$Name' was found on this computer or its domain. Give the account's user name, or DOMAIN\name for a domain account."
        }
    }
    $full = Get-SidName $sid.Value
    if ($full -like 'AzureAD\*' -or $sid.Value -like 'S-1-12-1-*') {
        Stop-Script $ExitRefused "$full is a Microsoft Entra ID account. OpenSSH on Windows does not support key sign-in for Entra ID accounts. Use a local or domain account."
    }
    if ($sid.Value -like 'S-1-5-32-*' -or @('S-1-5-18', 'S-1-5-19', 'S-1-5-20', 'S-1-1-0', 'S-1-5-11') -contains $sid.Value) {
        Stop-Script $ExitRefused "$full is a group or a service account, not a person's account. Give the Windows user DSpatch should sign in as."
    }
    $domain = ''
    $short = $full
    if ($full.Contains('\')) { $domain, $short = $full.Split('\', 2) }
    $isLocal = ($domain -eq '' -or $domain -ieq $env:COMPUTERNAME)
    return [pscustomobject]@{
        Name = $full; Sid = $sid.Value; Short = $short; Domain = $domain; IsLocal = $isLocal
        IsCurrent = ($sid.Value -eq $current.User.Value)
        SshName = if ($isLocal) { $short } else { "$domain\$short" }
    }
}

function Get-AdministratorsMemberSids {
    try {
        return @(Get-LocalGroupMember -SID $AdministratorsSid -ErrorAction Stop | ForEach-Object { $_.SID.Value })
    } catch {
        # Get-LocalGroupMember fails when the group holds an orphaned or Entra ID member.
        $groupName = (Get-SidName $AdministratorsSid).Split('\')[-1]
        $group = [ADSI]"WinNT://$env:COMPUTERNAME/$groupName,group"
        $sids = @()
        foreach ($member in @($group.psbase.Invoke('Members'))) {
            $bytes = $member.GetType().InvokeMember('objectSid', 'GetProperty', $null, $member, $null)
            $sids += (New-Object Security.Principal.SecurityIdentifier($bytes, 0)).Value
        }
        return $sids
    }
}

# Whether the account is in Administrators (S-1-5-32-544), and how that was found.
function Get-AdminMembership($Account) {
    if ($Account.IsCurrent) {
        # whoami /groups lists S-1-5-32-544 also as "Group used for deny only" in a filtered token,
        # and includes membership through nested domain groups.
        $who = Invoke-Native 'whoami.exe' @('/groups', '/fo', 'csv', '/nh')
        if ($who.ExitCode -eq 0) {
            return [pscustomobject]@{ IsAdmin = (($who.Output -join "`n") -match ('"' + [regex]::Escape($AdministratorsSid) + '"')); How = 'whoami /groups' }
        }
    }
    $members = Get-AdministratorsMemberSids
    $how = 'the members of Administrators (S-1-5-32-544)'
    if (-not $Account.IsLocal) {
        $script:Notes.Add("$($Account.Name) is a domain account. Membership of Administrators through a nested domain group is not visible to this check; if the account is an administrator that way, sshd treats it as one.")
    }
    return [pscustomobject]@{ IsAdmin = ($members -contains $Account.Sid); How = $how }
}

function Get-ProfilePath([string]$Sid) {
    try {
        $userProfile = Get-CimInstance -ClassName Win32_UserProfile -Filter "SID='$Sid'" -ErrorAction Stop
        if ($userProfile -and $userProfile.LocalPath) { return $userProfile.LocalPath }
    } catch { }
    $key = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\ProfileList\$Sid"
    $item = Get-ItemProperty -LiteralPath $key -Name ProfileImagePath -ErrorAction SilentlyContinue
    if ($item -and $item.ProfileImagePath) { return [Environment]::ExpandEnvironmentVariables($item.ProfileImagePath) }
    return $null
}

# ------------------------------------------------------------------------------------------------
# sshd_config: read only, never written
# ------------------------------------------------------------------------------------------------

function Read-SshdConfig([string]$Path) {
    $global = @{}
    $blocks = New-Object System.Collections.Generic.List[object]
    $current = $global
    foreach ($raw in [IO.File]::ReadAllLines($Path)) {
        $line = $raw.Trim()
        if ($line -eq '' -or $line.StartsWith('#')) { continue }
        $match = [regex]::Match($line, '^(?<key>[A-Za-z]+)\s*(?:=\s*|\s+)(?<value>.*)$')
        if (-not $match.Success) { continue }
        $key = $match.Groups['key'].Value.ToLowerInvariant()
        $value = $match.Groups['value'].Value.Trim()
        if ($key -eq 'match') {
            $current = @{}
            $blocks.Add([pscustomobject]@{ Criteria = $value; Settings = $current })
            continue
        }
        # sshd uses the first value it finds for a keyword.
        if (-not $current.ContainsKey($key)) { $current[$key] = $value }
    }
    return [pscustomobject]@{ Global = $global; Blocks = $blocks }
}

function Test-NamePattern([string]$Patterns, $Account) {
    foreach ($pattern in ($Patterns -split '[\s,]+' | Where-Object { $_ })) {
        $userPart = $pattern.Split('@')[0].ToLowerInvariant()
        if ($Account.Short.ToLowerInvariant() -like $userPart -or $Account.Name.ToLowerInvariant() -like $userPart -or $Account.SshName.ToLowerInvariant() -like $userPart) { return $true }
    }
    return $false
}

# Where sshd reads this account's keys, given its configuration, and what stands in the way.
function Get-KeyDecision($Config, [bool]$IsAdmin, $Account) {
    $conflicts = @()
    $notes = @()
    $global = $Config.Global
    if ($global.ContainsKey('pubkeyauthentication') -and $global['pubkeyauthentication'] -ieq 'no') {
        $conflicts += 'sshd_config says "PubkeyAuthentication no": key sign-in is turned off.'
    }
    if ($global.ContainsKey('allowusers') -and -not (Test-NamePattern $global['allowusers'] $Account)) {
        $conflicts += "sshd_config has ""AllowUsers $($global['allowusers'])"", which does not include $($Account.Name)."
    }
    if ($global.ContainsKey('denyusers') -and (Test-NamePattern $global['denyusers'] $Account)) {
        $conflicts += "sshd_config has ""DenyUsers $($global['denyusers'])"", which includes $($Account.Name)."
    }
    if ($global.ContainsKey('allowgroups')) {
        $groups = @($global['allowgroups'] -split '[\s,]+' | ForEach-Object { $_.ToLowerInvariant() })
        if (-not ($IsAdmin -and $groups -contains 'administrators')) {
            $conflicts += "sshd_config has ""AllowGroups $($global['allowgroups'])"". This script cannot tell whether $($Account.Name) is in one of those groups."
        }
    }
    if ($global.ContainsKey('denygroups')) {
        $conflicts += "sshd_config has ""DenyGroups $($global['denygroups'])"". This script cannot tell whether $($Account.Name) is in one of those groups."
    }
    if ($global.ContainsKey('authorizedkeyscommand')) {
        $notes += "sshd_config has an AuthorizedKeysCommand; keys may also come from there."
    }
    $adminBlock = $null
    foreach ($block in $Config.Blocks) {
        if ($block.Criteria -match '^(?i)group\s+administrators$') { $adminBlock = $block; continue }
        $criteria = $block.Criteria
        $userMatch = [regex]::Match($criteria, '(?i)\buser\s+(?<names>\S+)')
        if ($userMatch.Success -and (Test-NamePattern $userMatch.Groups['names'].Value $Account)) {
            $conflicts += "sshd_config has a block ""Match $criteria"" for this account."
        } elseif ($block.Settings.ContainsKey('authorizedkeysfile') -or $block.Settings.ContainsKey('pubkeyauthentication') -or $block.Settings.ContainsKey('authorizedkeyscommand')) {
            $conflicts += "sshd_config has a block ""Match $criteria"" that changes key sign-in. This script cannot tell whether it applies to $($Account.Name)."
        }
    }
    $location = 'user'
    if ($IsAdmin -and $null -ne $adminBlock) {
        $file = if ($adminBlock.Settings.ContainsKey('authorizedkeysfile')) { $adminBlock.Settings['authorizedkeysfile'] } else { '' }
        if ($file -ieq '__PROGRAMDATA__/ssh/administrators_authorized_keys') {
            $location = 'admin'
        } else {
            $conflicts += "sshd_config's ""Match Group administrators"" block has AuthorizedKeysFile ""$file"", not Windows' default __PROGRAMDATA__/ssh/administrators_authorized_keys."
        }
        if ($adminBlock.Settings.ContainsKey('pubkeyauthentication') -and $adminBlock.Settings['pubkeyauthentication'] -ieq 'no') {
            $conflicts += 'sshd_config turns key sign-in off for administrators.'
        }
    } else {
        if ($global.ContainsKey('authorizedkeysfile')) {
            $files = @($global['authorizedkeysfile'] -split '\s+')
            if ($files -notcontains '.ssh/authorized_keys') {
                $conflicts += "sshd_config has ""AuthorizedKeysFile $($global['authorizedkeysfile'])"", not Windows' default .ssh/authorized_keys."
            }
        }
        if ($IsAdmin) {
            $notes += 'sshd_config has no active "Match Group administrators" block, so this administrator account uses its own .ssh\authorized_keys.'
        }
    }
    return [pscustomobject]@{ Location = $location; Conflicts = $conflicts; Notes = $notes }
}

# What Windows' default sshd_config decides, before sshd has created the file at its first start.
function Get-DefaultKeyDecision([bool]$IsAdmin) {
    $location = if ($IsAdmin) { 'admin' } else { 'user' }
    return [pscustomobject]@{ Location = $location; Conflicts = @(); Notes = @() }
}

# ------------------------------------------------------------------------------------------------
# Permissions, by SID
# ------------------------------------------------------------------------------------------------

# WriteData, AppendData, WRITE_DAC, WRITE_OWNER, GENERIC_ALL, GENERIC_WRITE.
$WriteRights = 0x2 -bor 0x4 -bor 0x40000 -bor 0x80000 -bor 0x10000000 -bor 0x40000000

function Get-AclState([string]$Path) {
    try { $acl = Get-Acl -LiteralPath $Path } catch { return $null }
    $rules = @($acl.GetAccessRules($true, $true, [Security.Principal.SecurityIdentifier]) | ForEach-Object {
        [pscustomobject]@{
            Sid = $_.IdentityReference.Value; Type = "$($_.AccessControlType)"; Rights = [int64]$_.FileSystemRights
            RightsText = "$($_.FileSystemRights)"; Inherited = $_.IsInherited
        }
    })
    return [pscustomobject]@{ Owner = $acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; Protected = $acl.AreAccessRulesProtected; Rules = $rules }
}

function Format-AclState($State) {
    if ($null -eq $State) { return @('    (could not be read)') }
    $lines = @("    owner: $(Get-SidName $State.Owner) ($($State.Owner))")
    $lines += if ($State.Protected) { '    inheritance: off' } else { '    inheritance: on (entries from the folder apply)' }
    foreach ($rule in $State.Rules) {
        $from = if ($rule.Inherited) { ' (inherited)' } else { '' }
        $lines += "    $($rule.Type) $($rule.RightsText): $(Get-SidName $rule.Sid) ($($rule.Sid))$from"
    }
    return $lines
}

# Exactly: owner Administrators, no inheritance, Full control for Administrators and SYSTEM only.
function Test-AdminKeyAcl($State) {
    if ($null -eq $State -or $State.Owner -ne $AdministratorsSid -or -not $State.Protected) { return $false }
    $rules = @($State.Rules)
    if ($rules.Count -ne 2) { return $false }
    $sids = (@($rules | ForEach-Object { $_.Sid } | Sort-Object)) -join ','
    $expected = (@($AdministratorsSid, $SystemSid) | Sort-Object) -join ','
    if ($sids -ne $expected) { return $false }
    foreach ($rule in $rules) {
        if ($rule.Type -ne 'Allow' -or $rule.RightsText -ne 'FullControl' -or $rule.Inherited) { return $false }
    }
    return $true
}

# Entries that let anyone but the user, SYSTEM and Administrators write a user's authorized_keys.
function Get-UserKeyAclProblems($State, [string]$UserSid) {
    $allowed = @($UserSid, $SystemSid, $AdministratorsSid)
    $problems = @()
    if ($allowed -notcontains $State.Owner) { $problems += "owner $(Get-SidName $State.Owner) ($($State.Owner))" }
    foreach ($rule in $State.Rules) {
        if ($rule.Type -eq 'Allow' -and ($rule.Rights -band $WriteRights) -ne 0 -and $allowed -notcontains $rule.Sid) {
            $problems += "$($rule.RightsText) for $(Get-SidName $rule.Sid) ($($rule.Sid))"
        }
    }
    return $problems
}

# ------------------------------------------------------------------------------------------------
# Host keys
# ------------------------------------------------------------------------------------------------

function Get-HostKeyFingerprints {
    $files = @(Get-ChildItem -Path (Join-Path $SshDir 'ssh_host_*_key.pub') -ErrorAction SilentlyContinue)
    $keygen = Join-Path $env:SystemRoot 'System32\OpenSSH\ssh-keygen.exe'
    if (-not (Test-Path -LiteralPath $keygen)) {
        $command = Get-Command ssh-keygen.exe -ErrorAction SilentlyContinue
        $keygen = if ($command) { $command.Source } else { $null }
    }
    $lines = @()
    foreach ($file in $files) {
        if ($keygen) {
            $result = Invoke-Native $keygen @('-l', '-f', $file.FullName)
            if ($result.ExitCode -eq 0) { $lines += $result.Output; continue }
        }
        # The same SHA256 fingerprint OpenSSH prints: base64 of the SHA-256 of the key blob, no padding.
        $parts = ([IO.File]::ReadAllText($file.FullName).Trim()) -split '\s+'
        if ($parts.Count -ge 2) {
            $sha = [Security.Cryptography.SHA256]::Create()
            $hash = ([Convert]::ToBase64String($sha.ComputeHash([Convert]::FromBase64String($parts[1])))).TrimEnd('=')
            $lines += "SHA256:$hash ($($parts[0]))"
        }
    }
    return $lines
}

# ------------------------------------------------------------------------------------------------
# Firewall (read-only parts)
# ------------------------------------------------------------------------------------------------

function Get-RuleSettings($Rule) {
    $port = $Rule | Get-NetFirewallPortFilter
    $address = $Rule | Get-NetFirewallAddressFilter
    $interface = $Rule | Get-NetFirewallInterfaceFilter
    return [pscustomobject]@{
        Enabled = "$($Rule.Enabled)"; Direction = "$($Rule.Direction)"; Action = "$($Rule.Action)"
        Protocol = "$($port.Protocol)"; LocalPort = (@($port.LocalPort) -join ',')
        RemoteAddress = @($address.RemoteAddress); InterfaceAlias = (@($interface.InterfaceAlias) -join ','); Profile = "$($Rule.Profile)"
    }
}

function Get-RuleDifferences($Settings, $Wanted) {
    $differences = @()
    foreach ($field in 'Enabled', 'Direction', 'Action', 'Protocol', 'LocalPort', 'InterfaceAlias', 'Profile') {
        if ($Settings.$field -ne $Wanted.$field) { $differences += "${field}: $($Settings.$field) -> $($Wanted.$field)" }
    }
    $addresses = @($Settings.RemoteAddress)
    $same = $false
    if ($addresses.Count -eq 1) {
        $network = ConvertTo-Network $addresses[0]
        $same = ($null -ne $network -and $network.RuleText -eq $Wanted.RemoteAddress)
    }
    if (-not $same) { $differences += "RemoteAddress: $($addresses -join ',') -> $($Wanted.RemoteAddress)" }
    return $differences
}

function Get-OtherSshRules {
    $rules = @()
    try {
        $filters = @(Get-NetFirewallPortFilter -PolicyStore ActiveStore -ErrorAction Stop | Where-Object { $_.Protocol -eq 'TCP' -and @($_.LocalPort) -contains '22' })
        foreach ($filter in $filters) {
            $rule = $filter | Get-NetFirewallRule -ErrorAction SilentlyContinue
            if ($null -eq $rule) { continue }
            if ("$($rule.Direction)" -ne 'Inbound' -or "$($rule.Enabled)" -ne 'True' -or "$($rule.Action)" -ne 'Allow') { continue }
            if (@($OwnRuleName, $BroadRuleName) -contains $rule.Name) { continue }
            $address = $rule | Get-NetFirewallAddressFilter
            $rules += "$($rule.Name) ('$($rule.DisplayName)'), profile $($rule.Profile), from $(@($address.RemoteAddress) -join ',')"
        }
    } catch {
        $script:Notes.Add("Other firewall rules for port 22 could not be listed: $($_.Exception.Message)")
    }
    return $rules
}

#region Changes
# Every function that changes this computer is here, and only Invoke-AllChanges calls them. It runs
# after the plan has been shown, after -DryRun has stopped the script, and after "Proceed?".

function Invoke-ChangeInstallOpenSsh {
    Write-Line "Installing OpenSSH Server ($CapabilityName). This can take several minutes..."
    try {
        $result = Add-WindowsCapability -Online -Name $CapabilityName -ErrorAction Stop
    } catch {
        $code = '0x{0:X8}' -f $_.Exception.HResult
        Stop-Script $ExitPolicy ("Installing OpenSSH Server failed with error $code`: $($_.Exception.Message)`n" +
            "This usually means the computer's update source or a policy blocks optional Windows features " +
            '(for example 0x800F0954 when updates come from WSUS). Ask your IT department to install OpenSSH Server ' +
            'or to allow it. This script does not change update or policy settings.')
    }
    $script:Changed.Add('Installed OpenSSH Server.')
    if ($result.RestartNeeded) { Stop-Script $ExitRestart "OpenSSH Server needs Windows to restart before it can be used. $RestartText" }
    $state = (Get-WindowsCapability -Online -Name $CapabilityName).State
    if ("$state" -ne 'Installed') { Stop-Script $ExitRestart "OpenSSH Server is '$state' after the install. $RestartText" }
}

function Invoke-ChangeFirewallRule($Plan) {
    $wanted = $Plan.WantedRule
    if ($Plan.OwnRuleAction -eq 'create') {
        New-NetFirewallRule -Name $OwnRuleName -DisplayName 'SSH for DSpatch from one client' `
            -Description 'Created by dspatch-prepare-windows-host.ps1: SSH (TCP 22) only from the DSpatch client.' `
            -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Enabled True `
            -RemoteAddress $wanted.RemoteAddress -InterfaceAlias $wanted.InterfaceAlias -Profile $wanted.Profile | Out-Null
        $script:Changed.Add("Created firewall rule $OwnRuleName (TCP 22 from $($wanted.RemoteAddress), interface $($wanted.InterfaceAlias), profile $($wanted.Profile)).")
    } elseif ($Plan.OwnRuleAction -eq 'update') {
        Set-NetFirewallRule -Name $OwnRuleName -Direction Inbound -Protocol TCP -LocalPort 22 -Action Allow -Enabled True `
            -RemoteAddress $wanted.RemoteAddress -InterfaceAlias $wanted.InterfaceAlias -Profile $wanted.Profile
        $script:Changed.Add("Updated firewall rule $OwnRuleName ($($Plan.OwnRuleDifferences -join '; ')).")
    }
    $active = Get-NetFirewallRule -Name $OwnRuleName -PolicyStore ActiveStore -ErrorAction SilentlyContinue
    if ($null -eq $active -or "$($active.Enabled)" -ne 'True') {
        Stop-Script $ExitPolicy "The firewall rule $OwnRuleName is not active after it was saved. A policy on this computer probably overrides local firewall rules. Ask your IT department for an SSH rule limited to your client."
    }
}

function Invoke-ChangeDisableBroadRule {
    $broad = Get-NetFirewallRule -Name $BroadRuleName -ErrorAction SilentlyContinue
    if ($null -ne $broad -and "$($broad.Enabled)" -eq 'True') {
        Disable-NetFirewallRule -Name $BroadRuleName
        $script:Changed.Add("Disabled firewall rule $BroadRuleName, which the OpenSSH install created and which allows SSH from any address.")
    }
}

function Invoke-ChangeService($Plan) {
    if ($Plan.StartService) {
        Start-Service -Name sshd
        $script:Changed.Add('Started the sshd service.')
    }
    if ($Plan.SetAutomatic) {
        Set-Service -Name sshd -StartupType Automatic
        $script:Changed.Add('Set the sshd service to start automatically.')
    }
    $service = Get-Service -Name sshd
    try { $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(15)) } catch { }
    $service.Refresh()
    if ("$($service.Status)" -ne 'Running') {
        Stop-Script $ExitRefused "The sshd service is $($service.Status), not Running. Look in Event Viewer under Applications and Services Logs > OpenSSH > Operational."
    }
}

function Invoke-ChangeAdminAcl([string]$Path) {
    $security = New-Object Security.AccessControl.FileSecurity
    $security.SetAccessRuleProtection($true, $false)
    $security.SetOwner((New-Object Security.Principal.SecurityIdentifier($AdministratorsSid)))
    foreach ($sid in $AdministratorsSid, $SystemSid) {
        $security.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule((New-Object Security.Principal.SecurityIdentifier($sid)), 'FullControl', 'Allow')))
    }
    Set-Acl -LiteralPath $Path -AclObject $security
}

function Invoke-ChangeUserAcl([string]$Path, [string]$UserSid, [bool]$Folder) {
    $security = if ($Folder) { New-Object Security.AccessControl.DirectorySecurity } else { New-Object Security.AccessControl.FileSecurity }
    $security.SetAccessRuleProtection($true, $false)
    foreach ($sid in $UserSid, $SystemSid, $AdministratorsSid) {
        $identity = New-Object Security.Principal.SecurityIdentifier($sid)
        $rule = if ($Folder) {
            New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
        } else {
            New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'Allow')
        }
        $security.AddAccessRule($rule)
    }
    Set-Acl -LiteralPath $Path -AclObject $security
    # Making another account the owner needs the restore privilege, which icacls uses.
    $owner = Invoke-Native 'icacls.exe' @($Path, '/setowner', "*$UserSid")
    if ($owner.ExitCode -ne 0) {
        $script:Notes.Add("Could not make the account the owner of $Path ($($owner.Output -join ' ')). sshd also accepts Administrators as the owner.")
    }
}

function Invoke-ChangeKey($Plan) {
    $key = $Plan.Key
    $path = $Plan.KeyPath
    $utf8 = New-Object Text.UTF8Encoding $false
    if ($Plan.KeyLocation -eq 'admin') {
        if (-not (Test-Path -LiteralPath $path)) {
            [IO.File]::WriteAllText($path, '', $utf8)
            $script:Changed.Add("Created $path.")
        }
        if (-not (Test-AdminKeyAcl (Get-AclState $path))) {
            Invoke-ChangeAdminAcl $path
            $script:Changed.Add("Set the permissions of $path to Administrators and SYSTEM only.")
        }
    } else {
        $folder = Split-Path -Parent $path
        if (-not (Test-Path -LiteralPath $folder)) {
            [IO.Directory]::CreateDirectory($folder) | Out-Null
            Invoke-ChangeUserAcl $folder $Plan.Account.Sid $true
            $script:Changed.Add("Created $folder for $($Plan.Account.Name).")
        }
        if (-not (Test-Path -LiteralPath $path)) {
            [IO.File]::WriteAllText($path, '', $utf8)
            Invoke-ChangeUserAcl $path $Plan.Account.Sid $false
            $script:Changed.Add("Created $path with access for $($Plan.Account.Name), SYSTEM and Administrators only.")
        }
    }
    $existing = Read-KeyFile $path
    if ($existing.Identities -contains $key.Identity) {
        if (-not $script:InPlace.Contains("The key is already in $path.")) { $script:InPlace.Add("The key is already in $path.") }
    } else {
        $text = if ($existing.EndsWithNewline) { "$($key.Line)`n" } else { "`n$($key.Line)`n" }
        [IO.File]::AppendAllText($path, $text, $utf8)
        $script:Changed.Add("Added the key $($key.Type) $($key.Fingerprint) to $path.")
    }
}

function Invoke-AllChanges($Plan) {
    if ($Plan.InstallOpenSsh) { Invoke-ChangeInstallOpenSsh }
    Invoke-ChangeFirewallRule $Plan
    if ($Plan.DisableBroadRule) { Invoke-ChangeDisableBroadRule }
    Invoke-ChangeService $Plan
    # A fresh install creates its firewall rule and sshd_config by the time sshd has started.
    if ($Plan.DisableBroadRule) { Invoke-ChangeDisableBroadRule }
    if ($Plan.RecheckConfig) {
        if (-not (Test-Path -LiteralPath $SshdConfigPath)) {
            Stop-Script $ExitRefused "sshd started but $SshdConfigPath is not there, so where sshd reads keys is not known. The key was not written. Run this script again to see the plan."
        }
        $decision = Get-KeyDecision (Read-SshdConfig $SshdConfigPath) $Plan.IsAdmin $Plan.Account
        if ($decision.Conflicts.Count -gt 0 -or $decision.Location -ne $Plan.KeyLocation) {
            Stop-Script $ExitRefused ("The sshd_config that sshd created is not Windows' default, so the key was not written:`n  " +
                (@($decision.Conflicts) -join "`n  ") + "`nRun this script again to see the plan for it.")
        }
    }
    if ($Plan.WriteKey) { Invoke-ChangeKey $Plan }
}
#endregion Changes

# ------------------------------------------------------------------------------------------------
# Inspect: everything below until the plan only reads
# ------------------------------------------------------------------------------------------------

Write-Heading 'DSpatch: prepare this Windows computer as an SSH host'
if ($DryRun) { Write-Line 'Dry run: this shows the plan and changes nothing.' }

foreach ($value in $PublicKey, $PublicKeyFile, $User, $AllowFrom, $InterfaceAlias) {
    if ($value -and ($value.Contains('<') -or $value.Contains('>'))) {
        Stop-Script $ExitRefused "A value still holds a placeholder: '$value'. Replace <...> with your own value."
    }
}

$elevated = Test-Elevated
if (-not $elevated) {
    if (-not $DryRun) {
        Stop-Script $ExitRefused 'Run this script in PowerShell as administrator (Start > type PowerShell > right-click > Run as administrator). Or add -DryRun to only see the plan.'
    }
    $script:Notes.Add('Not running as administrator: some things could not be read, and the real run needs administrator.')
}

if ([string]::IsNullOrWhiteSpace($AllowFrom)) {
    Stop-Script $ExitRefused 'Give -AllowFrom: the Linux computer''s IPv4 address, or its network such as <network>/24. SSH will be allowed only from there. The Linux helper dspatch-prepare-linux-client.sh prints it.'
}
$allow = ConvertTo-Network $AllowFrom
if ($null -eq $allow) {
    Stop-Script $ExitRefused "-AllowFrom '$AllowFrom' is not an IPv4 address or an IPv4 network in CIDR form."
}
if ($allow.Prefix -lt 8) {
    Stop-Script $ExitRefused "-AllowFrom '$AllowFrom' covers too much of the internet. Give the Linux computer's address, or its local network."
}

if ($PublicKey -and $PublicKeyFile) { Stop-Script $ExitRefused 'Give either -PublicKey or -PublicKeyFile, not both.' }
if (-not $PublicKey -and -not $PublicKeyFile) {
    Stop-Script $ExitRefused 'Give the Linux computer''s public key: -PublicKey ''<the line from id_ed25519.pub>'' or -PublicKeyFile <path>.'
}
$keyText = $PublicKey
if ($PublicKeyFile) {
    if (-not (Test-Path -LiteralPath $PublicKeyFile -PathType Leaf)) { Stop-Script $ExitRefused "There is no file '$PublicKeyFile'." }
    $keyText = [IO.File]::ReadAllText((Resolve-Path -LiteralPath $PublicKeyFile).Path)
}
$key = Read-PublicKey $keyText
if ($key.Error) { Stop-Script $ExitRefused $key.Error }

$account = Resolve-Account $User
$membership = Get-AdminMembership $account

# The network interface.
$configs = @(Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $null -ne $_.IPv4DefaultGateway -and $null -ne $_.IPv4Address })
if ($InterfaceAlias) {
    $configs = @(Get-NetIPConfiguration -InterfaceAlias $InterfaceAlias -ErrorAction SilentlyContinue | Where-Object { $null -ne $_.IPv4Address })
    if ($configs.Count -eq 0) { Stop-Script $ExitRefused "There is no network interface '$InterfaceAlias' with an IPv4 address. Get-NetIPConfiguration lists them." }
}
if ($configs.Count -eq 0) {
    Stop-Script $ExitRefused 'No network interface with an IPv4 default gateway was found. Connect to the network, or give -InterfaceAlias.'
}
$interfaces = @($configs | ForEach-Object {
    $address = @($_.IPv4Address)[0]
    [pscustomobject]@{
        Alias = $_.InterfaceAlias; Address = $address.IPAddress; Prefix = [int]$address.PrefixLength
        Category = if ($_.NetProfile) { "$($_.NetProfile.NetworkCategory)" } else { 'Unknown' }
    }
})
$chosen = $null
if ($interfaces.Count -eq 1) {
    $chosen = $interfaces[0]
} else {
    $matching = @($interfaces | Where-Object { Test-InNetwork $allow.Address ((ConvertTo-IPv4Number $_.Address) -band (Get-PrefixMask $_.Prefix)) $_.Prefix })
    if ($matching.Count -eq 1) {
        $chosen = $matching[0]
    } elseif ($Yes -or -not (Test-Interactive)) {
        Stop-Script $ExitRefused ("This computer has several network interfaces with a default gateway: " +
            (($interfaces | ForEach-Object { "$($_.Alias) ($($_.Address))" }) -join ', ') + '. Give the one to allow SSH on with -InterfaceAlias.')
    } else {
        Write-Line 'This computer has several network interfaces with a default gateway:'
        for ($i = 0; $i -lt $interfaces.Count; $i++) {
            Write-Line ("  [{0}] {1}  {2}/{3}  {4}" -f ($i + 1), $interfaces[$i].Alias, $interfaces[$i].Address, $interfaces[$i].Prefix, $interfaces[$i].Category)
        }
        $answer = Read-Host 'Which one does the Linux computer reach this computer through? Number'
        $index = 0
        if (-not [int]::TryParse($answer, [ref]$index) -or $index -lt 1 -or $index -gt $interfaces.Count) {
            Stop-Script $ExitRefused 'No interface was chosen.'
        }
        $chosen = $interfaces[$index - 1]
    }
}
$profileByCategory = @{ 'Public' = 'Public'; 'Private' = 'Private'; 'DomainAuthenticated' = 'Domain' }
if (-not $profileByCategory.ContainsKey($chosen.Category)) {
    Stop-Script $ExitRefused "The network profile of $($chosen.Alias) is '$($chosen.Category)'. Wait until Windows has identified the network, then run this script again."
}
$firewallProfile = $profileByCategory[$chosen.Category]
$chosenNumber = ConvertTo-IPv4Number $chosen.Address
if (-not (Test-InNetwork $allow.Address ($chosenNumber -band (Get-PrefixMask $chosen.Prefix)) $chosen.Prefix)) {
    $script:Notes.Add("$($allow.RuleText) is not on the subnet of $($chosen.Alias) ($($chosen.Address)/$($chosen.Prefix)). That works only if the network routes between them.")
}

# OpenSSH Server.
$capabilityState = 'Unknown'
try {
    $capabilityState = "$((Get-WindowsCapability -Online -Name $CapabilityName -ErrorAction Stop).State)"
} catch {
    if ($elevated) {
        $code = '0x{0:X8}' -f $_.Exception.HResult
        Stop-Script $ExitPolicy "Windows could not say whether OpenSSH Server is installed (error $code`: $($_.Exception.Message)). A policy may block optional features; ask your IT department."
    }
}
$service = Get-Service -Name sshd -ErrorAction SilentlyContinue
if ($capabilityState -eq 'Unknown' -and $null -ne $service) { $capabilityState = 'Installed' }
if ($capabilityState -eq 'Unknown' -and -not $elevated) {
    $script:Notes.Add('Whether OpenSSH Server is installed needs administrator to find out; without it, the plan assumes it is not.')
    $capabilityState = 'NotPresent'
}
if ($capabilityState -eq 'InstallPending') { Stop-Script $ExitRestart "OpenSSH Server is installed but waits for a restart. $RestartText" }
$installOpenSsh = $false
if ($capabilityState -eq 'Installed' -and $null -eq $service) {
    Stop-Script $ExitRefused 'OpenSSH Server is installed, but there is no sshd service. Remove and add OpenSSH Server again under Settings > Optional features, or ask your IT department.'
}
if ($capabilityState -ne 'Installed') {
    if ($null -ne $service) {
        $script:Notes.Add('OpenSSH Server is installed some other way (the sshd service exists), so the Windows feature is not installed on top of it.')
    } else {
        $installOpenSsh = $true
        $pending = @()
        if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending') { $pending += 'Component Based Servicing' }
        if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { $pending += 'Windows Update' }
        $renames = Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\Session Manager' -Name PendingFileRenameOperations -ErrorAction SilentlyContinue
        if ($renames -and $renames.PendingFileRenameOperations) { $pending += 'pending file renames' }
        if ($pending.Count -gt 0) {
            Stop-Script $ExitRestart "Windows waits for a restart ($($pending -join ', ')), and OpenSSH Server should not be installed until then. $RestartText"
        }
    }
}
$hostKeysExist = @(Get-ChildItem -Path (Join-Path $SshDir 'ssh_host_*_key.pub') -ErrorAction SilentlyContinue).Count -gt 0
$serviceRunning = ($null -ne $service -and "$($service.Status)" -eq 'Running')
# Fresh: installed by this run, or installed but sshd has never started (no host keys), so nobody
# can be signing in through it yet.
$fresh = $installOpenSsh -or (-not $serviceRunning -and -not $hostKeysExist)

# Firewall.
$wantedRule = [pscustomobject]@{
    Enabled = 'True'; Direction = 'Inbound'; Action = 'Allow'; Protocol = 'TCP'; LocalPort = '22'
    RemoteAddress = $allow.RuleText; InterfaceAlias = $chosen.Alias; Profile = $firewallProfile
}
$ownRule = Get-NetFirewallRule -Name $OwnRuleName -ErrorAction SilentlyContinue
$ownRuleAction = 'create'
$ownRuleDifferences = @()
if ($null -ne $ownRule) {
    $ownRuleDifferences = @(Get-RuleDifferences (Get-RuleSettings $ownRule) $wantedRule)
    $ownRuleAction = if ($ownRuleDifferences.Count -eq 0) { 'keep' } else { 'update' }
}
$broadRule = Get-NetFirewallRule -Name $BroadRuleName -ErrorAction SilentlyContinue
$broadEnabled = ($null -ne $broadRule -and "$($broadRule.Enabled)" -eq 'True')
$otherRules = @(Get-OtherSshRules)
try {
    $profileState = Get-NetFirewallProfile -PolicyStore ActiveStore -Name $firewallProfile -ErrorAction Stop
    if ("$($profileState.AllowLocalFirewallRules)" -eq 'False') {
        Stop-Script $ExitPolicy "A policy on this computer ignores local firewall rules on the $firewallProfile profile, so a rule made here would have no effect. Ask your IT department for an SSH rule limited to your client."
    }
    if ("$($profileState.Enabled)" -eq 'False') {
        $script:Notes.Add("The Windows firewall is off for the $firewallProfile profile: then nothing limits who can reach SSH, whatever the rules say.")
    }
} catch {
    $script:Notes.Add("The firewall profile's policy could not be read: $($_.Exception.Message). The rule is checked after it is saved.")
}

# Where the key goes.
$configExists = Test-Path -LiteralPath $SshdConfigPath -PathType Leaf
$recheckConfig = $false
if ($configExists) {
    try {
        $decision = Get-KeyDecision (Read-SshdConfig $SshdConfigPath) $membership.IsAdmin $account
    } catch {
        if (-not $elevated) {
            $decision = Get-DefaultKeyDecision $membership.IsAdmin
            $script:Notes.Add("$SshdConfigPath could not be read without administrator; the plan assumes Windows' default.")
        } else { throw }
    }
} else {
    $decision = Get-DefaultKeyDecision $membership.IsAdmin
    $recheckConfig = $true
}
foreach ($conflict in $decision.Conflicts) { $script:Conflicts.Add($conflict) }
foreach ($note in $decision.Notes) { $script:Notes.Add($note) }

$keyPath = $AdminKeysPath
$profilePath = $null
if ($decision.Location -eq 'user') {
    $profilePath = Get-ProfilePath $account.Sid
    if (-not $profilePath) {
        Stop-Script $ExitRefused "$($account.Name) has no user profile on this computer yet. Sign in to Windows once as that user, then run this script again."
    }
    $keyPath = Join-Path $profilePath '.ssh\authorized_keys'
}
$keyFile = Read-KeyFile $keyPath
$keyAcl = if ($keyFile.Exists) { Get-AclState $keyPath } else { $null }
if ($keyFile.Utf16) {
    $script:Conflicts.Add("$keyPath is saved as UTF-16 (for example by 'echo ... > file' in Windows PowerShell), which sshd cannot read. Save it again as UTF-8, or move it aside, then run this script again.")
}
if ($keyFile.Bom) { $script:Notes.Add("$keyPath starts with a UTF-8 byte order mark; if the first key in it is refused, save the file without one.") }
$aclFix = @()
if ($decision.Location -eq 'user' -and $keyFile.Exists -and $null -ne $keyAcl) {
    $problems = @(Get-UserKeyAclProblems $keyAcl $account.Sid)
    if ($problems.Count -gt 0) {
        $script:Conflicts.Add("$keyPath may be changed by others ($($problems -join '; ')); sshd refuses such a file. The key was not added. Fix its permissions with the commands below, then run this script again.")
        $aclFix += "icacls.exe ""$keyPath"" /inheritance:r /grant:r ""*$($account.Sid):F"" ""*${SystemSid}:F"" ""*${AdministratorsSid}:F"""
        foreach ($rule in $keyAcl.Rules) {
            if (@($account.Sid, $SystemSid, $AdministratorsSid) -notcontains $rule.Sid -and -not $rule.Inherited) { $aclFix += "icacls.exe ""$keyPath"" /remove ""*$($rule.Sid)""" }
        }
        if (@($account.Sid, $SystemSid, $AdministratorsSid) -notcontains $keyAcl.Owner) { $aclFix += "icacls.exe ""$keyPath"" /setowner ""*$($account.Sid)""" }
    }
}
$keyPresent = ($keyFile.Identities -contains $key.Identity)
$adminAclExact = ($decision.Location -eq 'admin' -and $keyFile.Exists -and (Test-AdminKeyAcl $keyAcl))

$startService = -not $serviceRunning
$setAutomatic = ($null -eq $service -or "$($service.StartType)" -ne 'Automatic')

# ------------------------------------------------------------------------------------------------
# What was found, and the plan
# ------------------------------------------------------------------------------------------------

Write-Heading 'What was found'
$adminText = if ($membership.IsAdmin) { 'yes' } else { 'no' }
Write-Line "  Account:        $($account.Name) ($($account.Sid)); administrator: $adminText (from $($membership.How))"
Write-Line "  Interface:      $($chosen.Alias), $($chosen.Address)/$($chosen.Prefix), network profile $($chosen.Category) (firewall profile $firewallProfile). The network profile is not changed."
Write-Line "  SSH allowed from: $($allow.RuleText)"
Write-Line "  Public key:     $($key.Type) $($key.Fingerprint) $($key.Comment)"
$opensshText = if ($installOpenSsh) { 'not installed' } else { 'installed' }
Write-Line "  OpenSSH Server: $opensshText"
if ($null -ne $service) { Write-Line "  sshd service:   $($service.Status), starts $($service.StartType)" }
$configText = if ($configExists) { $SshdConfigPath } else { "not there yet: sshd creates it at its first start (Windows' default is assumed and checked again before the key is written)" }
Write-Line "  sshd_config:    $configText"
Write-Line "  Key file:       $keyPath"
if ($keyFile.Exists -and -not $keyFile.Readable) { Write-Line '                  (could not be read without administrator)' }
if ($null -ne $keyAcl) { Format-AclState $keyAcl | ForEach-Object { Write-Line $_ } }

$plan = New-Object System.Collections.Generic.List[string]
if ($installOpenSsh) { $plan.Add("Install OpenSSH Server ($CapabilityName) with Add-WindowsCapability.") } else { $script:InPlace.Add('OpenSSH Server is installed.') }
if ($ownRuleAction -eq 'create') {
    $plan.Add("Create firewall rule $OwnRuleName`: inbound TCP 22, allow from $($allow.RuleText) only, interface $($chosen.Alias), profile $firewallProfile.")
} elseif ($ownRuleAction -eq 'update') {
    $plan.Add("Update firewall rule $OwnRuleName`: $($ownRuleDifferences -join '; ').")
} else {
    $script:InPlace.Add("Firewall rule $OwnRuleName allows TCP 22 from $($allow.RuleText) on $($chosen.Alias), profile $firewallProfile.")
}
$disableBroad = $false
if ($fresh) {
    $disableBroad = $true
    $plan.Add("Disable firewall rule $BroadRuleName if it is there or appears when sshd first starts (the OpenSSH install creates it; it allows SSH from any address). sshd has not been in use, so this cuts off nobody.")
} elseif ($broadEnabled) {
    $script:Notes.Add("Firewall rule $BroadRuleName is enabled on profile(s) $($broadRule.Profile): it allows SSH from ANY address there, so $OwnRuleName does not limit anything while it is on. " +
        'OpenSSH Server was already in use on this computer, so this script leaves it alone: turning it off could cut off other people who sign in over SSH now. ' +
        "If you decide to turn it off: Disable-NetFirewallRule -Name '$BroadRuleName'")
}
foreach ($other in $otherRules) { $script:Notes.Add("Another enabled firewall rule allows TCP 22: $other") }
if ($startService) { $plan.Add('Start the sshd service.') } else { $script:InPlace.Add('The sshd service is running.') }
if ($setAutomatic) { $plan.Add('Set the sshd service to start automatically.') } else { $script:InPlace.Add('The sshd service starts automatically.') }
$writeKey = ($script:Conflicts.Count -eq 0)
if ($decision.Location -eq 'admin') {
    if (-not $keyFile.Exists) { $plan.Add("Create $keyPath (it is where sshd reads keys for members of Administrators).") }
    if (-not $adminAclExact) {
        $plan.Add("Set the permissions of $keyPath to exactly: owner Administrators ($AdministratorsSid), inheritance off, Full control for Administrators ($AdministratorsSid) and SYSTEM ($SystemSid), nothing else.")
    } else {
        $script:InPlace.Add("$keyPath has exactly the permissions sshd requires.")
    }
} else {
    $sshFolder = Split-Path -Parent $keyPath
    if (-not (Test-Path -LiteralPath $sshFolder)) { $plan.Add("Create $sshFolder with access for $($account.Name), SYSTEM and Administrators only.") }
    if (-not $keyFile.Exists) { $plan.Add("Create $keyPath, owner $($account.Name), inheritance off, Full control for $($account.Name), SYSTEM and Administrators only.") }
}
if ($keyPresent) {
    $script:InPlace.Add("The key is already in $keyPath.")
} else {
    $plan.Add("Add the key $($key.Type) $($key.Fingerprint) to $keyPath (UTF-8, one line).")
}

Write-Heading 'Plan: what this script will change, in this order'
if ($plan.Count -eq 0) { Write-Line '  Nothing: everything is already in place.' }
for ($i = 0; $i -lt $plan.Count; $i++) { Write-Line ("  {0}. {1}" -f ($i + 1), $plan[$i]) }
if ($script:InPlace.Count -gt 0) {
    Write-Heading 'Already in place'
    foreach ($line in $script:InPlace) { Write-Line "  - $line" }
}
if ($script:Notes.Count -gt 0) {
    Write-Heading 'Notes'
    foreach ($line in $script:Notes) { Write-Line "  - $line" }
}
if ($script:Conflicts.Count -gt 0) {
    Write-Heading 'Conflicts: the key cannot be set up'
    foreach ($line in $script:Conflicts) { Write-Line "  - $line" }
    foreach ($line in $aclFix) { Write-Line "    $line" }
    Stop-Script $ExitRefused 'Resolve the conflicts above (or ask whoever manages this computer), then run this script again. This script never changes sshd_config.'
}

if ($DryRun) {
    Write-Line ''
    Write-Line 'Dry run: nothing was changed. Run again without -DryRun to make these changes.'
    exit $ExitOk
}
if ($plan.Count -gt 0 -and -not $Yes) {
    if (-not (Test-Interactive)) { Stop-Script $ExitRefused 'This PowerShell cannot ask "Proceed?". Read the plan above, then run again with -Yes.' }
    $answer = Read-Host 'Proceed? [y/N]'
    if ($answer -notmatch '^(?i)y(es)?$') { Stop-Script $ExitRefused 'Stopped at your answer.' }
}

# ------------------------------------------------------------------------------------------------
# Change, then report
# ------------------------------------------------------------------------------------------------

Invoke-AllChanges ([pscustomobject]@{
    InstallOpenSsh = $installOpenSsh; WantedRule = $wantedRule; OwnRuleAction = $ownRuleAction; OwnRuleDifferences = $ownRuleDifferences
    DisableBroadRule = $disableBroad; StartService = $startService; SetAutomatic = $setAutomatic; RecheckConfig = $recheckConfig
    IsAdmin = $membership.IsAdmin; Account = $account; KeyLocation = $decision.Location; KeyPath = $keyPath; Key = $key; WriteKey = $writeKey
})

Write-Heading 'Done'
if ($script:Changed.Count -gt 0) {
    Write-Line 'Changed:'
    foreach ($line in $script:Changed) { Write-Line "  - $line" }
} else {
    Write-Line 'Nothing needed changing.'
}
foreach ($line in $script:InPlace) { Write-Line "  Already in place: $line" }
if (Test-Path -LiteralPath $keyPath) {
    Write-Line "Permissions of ${keyPath}:"
    Format-AclState (Get-AclState $keyPath) | ForEach-Object { Write-Line $_ }
    if ($decision.Location -eq 'admin' -and -not (Test-AdminKeyAcl (Get-AclState $keyPath))) {
        Write-Warn 'These are not exactly Administrators and SYSTEM. sshd may refuse the file.'
    }
}

Write-Heading 'This computer''s host key fingerprints'
$fingerprints = @(Get-HostKeyFingerprints)
if ($fingerprints.Count -eq 0) { Write-Line '  (none found yet)' }
foreach ($line in $fingerprints) { Write-Line "  $line" }
Write-Line 'When ssh on Linux asks whether to trust this computer, answer yes only if its fingerprint is one of these.'

$sshUser = if ($account.SshName -match '[\\\s]') { "'$($account.SshName)'" } else { $account.SshName }
Write-Heading 'On the Linux computer, sign in once with'
Write-Line "  ssh $sshUser@$($chosen.Address)"
Write-Line "Then, in DSpatch: Remote Session > $sshUser@$($chosen.Address) > Connect."
Write-Line "The firewall rule applies while $($chosen.Alias) is on a $firewallProfile network; if Windows changes the network profile, run this script again."
exit $ExitOk
