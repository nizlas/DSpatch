#!/usr/bin/env bash
# DSpatch: get this Linux computer ready to sign in to a Windows host over SSH (DSP-214, DSP-215).
#
#     dspatch-prepare-linux-client.sh <windows-user>@<windows-host>
#
# Finds your SSH public key, or creates a new ed25519 key if you have none, and prints the one
# command to run on Windows in PowerShell as administrator, with that key, this computer's address
# and the Windows user filled in. It also saves that command in ~/dspatch-windows-command.txt.
# It never overwrites a key, and never prints or copies a private key: only the public key (.pub)
# leaves this computer. Safe to run again.
#
# Installed with DSpatch, the command downloads DSpatch's Windows script of this version from its
# release page and runs it only if its SHA-256 is that of the script installed beside this helper.
# A copy saved elsewhere prints the command for a Windows script saved by hand instead.
#
# <windows-host> may be the Windows computer's address or name; the user part may be left out.

set -euo pipefail

ssh_dir="${HOME}/.ssh"
target="${1:-}"
if [[ "${target}" == "-h" || "${target}" == "--help" ]]; then
  sed -n '2,17p' "$0" | sed 's/^# \{0,1\}//'
  exit 0
fi

say() { printf '%s\n' "$*"; }
fail() { printf 'Stopped: %s\n' "$*" >&2; exit 1; }

command -v ssh-keygen >/dev/null 2>&1 || fail "ssh-keygen is not installed. Install OpenSSH's client first: sudo apt install openssh-client"

valid_public_key() {
  # One line: a known key type, base64 and an optional comment; never anything private.
  local file="$1"
  [[ -f "${file}" && -s "${file}" ]] || return 1
  if grep -q 'PRIVATE KEY' "${file}"; then return 1; fi
  [[ "$(wc -l <"${file}" | tr -d ' ')" -le 1 ]] || return 1
  grep -Eq '^(ssh-ed25519|ecdsa-sha2-nistp(256|384|521)|ssh-rsa|sk-ssh-ed25519@openssh\.com|sk-ecdsa-sha2-nistp256@openssh\.com) [A-Za-z0-9+/]+={0,3}( .*)?$' "${file}"
}

pub=""
# 1. An existing public key, in this order.
for name in id_ed25519 id_ecdsa id_rsa; do
  if [[ -f "${ssh_dir}/${name}.pub" ]]; then
    valid_public_key "${ssh_dir}/${name}.pub" || fail "${ssh_dir}/${name}.pub is not a single public key line. Look at it before going on; this script changes nothing there."
    pub="${ssh_dir}/${name}.pub"
    say "Using your existing public key ${pub}."
    break
  fi
done

# 2. A private key without its .pub: derive the public key from it. The private key is not changed.
if [[ -z "${pub}" ]]; then
  for name in id_ed25519 id_ecdsa id_rsa; do
    private="${ssh_dir}/${name}"
    if [[ -f "${private}" ]]; then
      say "${private} has no .pub file beside it; writing ${private}.pub from it (the private key is not changed)."
      say "If the key has a passphrase, ssh-keygen asks for it."
      tmp="$(mktemp "${ssh_dir}/.${name}.pub.XXXXXX")"
      if ! ssh-keygen -y -f "${private}" >"${tmp}"; then
        rm -f "${tmp}"
        fail "ssh-keygen could not read ${private}."
      fi
      chmod 644 "${tmp}"
      # Never overwrite: ln fails if the .pub appeared meanwhile.
      if ! ln "${tmp}" "${private}.pub" 2>/dev/null; then
        rm -f "${tmp}"
        fail "${private}.pub appeared while this ran; run the script again."
      fi
      rm -f "${tmp}"
      valid_public_key "${private}.pub" || fail "${private}.pub does not hold a public key line."
      pub="${private}.pub"
      break
    fi
  done
fi

# 3. No key at all: create id_ed25519, only if no such file exists.
if [[ -z "${pub}" ]]; then
  if [[ -e "${ssh_dir}/id_ed25519" ]]; then
    fail "${ssh_dir}/id_ed25519 exists but is not a key file this script can use. It is left as it is."
  fi
  say "You have no SSH key yet. Creating ${ssh_dir}/id_ed25519."
  say "ssh-keygen asks for a passphrase: choose one, or press Enter twice for none."
  if [[ ! -d "${ssh_dir}" ]]; then
    mkdir -m 700 "${ssh_dir}"
  fi
  ssh-keygen -t ed25519 -f "${ssh_dir}/id_ed25519" -C "${USER:-$(id -un)}@$(uname -n)"
  valid_public_key "${ssh_dir}/id_ed25519.pub" || fail "ssh-keygen did not write ${ssh_dir}/id_ed25519.pub."
  pub="${ssh_dir}/id_ed25519.pub"
fi

key="$(head -n 1 "${pub}")"

# The Windows host, if given: its user part, and the address this computer reaches it from.
win_user=""
win_host=""
if [[ -n "${target}" ]]; then
  if [[ "${target}" == *@* ]]; then
    win_user="${target%@*}"
    win_host="${target##*@}"
  else
    win_host="${target}"
  fi
fi

is_ipv4() { [[ "$1" =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; }

local_address=""
if [[ -n "${win_host}" ]]; then
  host_ip="${win_host}"
  if ! is_ipv4 "${host_ip}"; then
    host_ip="$(getent ahostsv4 "${win_host}" 2>/dev/null | awk 'NR == 1 { print $1 }')" || true
    [[ -n "${host_ip}" ]] || fail "The name ${win_host} does not resolve to an IPv4 address here. Give the Windows computer's IPv4 address instead."
    say "${win_host} is ${host_ip}."
  fi
  if command -v ip >/dev/null 2>&1; then
    local_address="$(ip route get "${host_ip}" 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -n 1)" || true
  fi
  if [[ -n "${local_address}" ]]; then
    say "This computer reaches ${host_ip} from ${local_address}."
  else
    say "Could not tell which address this computer uses to reach ${host_ip}."
  fi
fi
if [[ -z "${local_address}" ]]; then
  say ''
  say 'This computer'"'"'s IPv4 addresses (use the one on the network shared with Windows):'
  if command -v ip >/dev/null 2>&1; then
    ip -4 -brief address | grep -v '^lo ' || true
  else
    say '  (the ip command is not available)'
  fi
fi

allow_from="${local_address:-<this-computer-ip>}"
ps_key="${key//\'/\'\'}"
user_arg=""
if [[ -n "${win_user}" ]]; then
  user_arg=" -User '${win_user//\'/\'\'}'"
fi
script_args="-PublicKey '${ps_key}' -AllowFrom ${allow_from}${user_arg}"

# Installed with DSpatch: the Windows script and this release's version lie beside this helper.
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
version=""
script_sha=""
if [[ -f "${here}/VERSION" && -f "${here}/dspatch-prepare-windows-host.ps1" ]] && command -v sha256sum >/dev/null 2>&1; then
  version="$(tr -d '[:space:]' <"${here}/VERSION")"
  [[ "${version}" =~ ^[0-9A-Za-z.+-]+$ ]] || version=""
  script_sha="$(sha256sum "${here}/dspatch-prepare-windows-host.ps1" | awk '{ print toupper($1) }')"
fi

if [[ -n "${version}" ]]; then
  url="https://github.com/nizlas/DSpatch/releases/download/v${version}/dspatch-prepare-windows-host.ps1"
  command="[Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 'Tls12'; \$f = \"\$env:TEMP\\dspatch-prepare-windows-host-${version}.ps1\"; Invoke-WebRequest -UseBasicParsing -Uri '${url}' -OutFile \$f; if ((Get-FileHash -LiteralPath \$f -Algorithm SHA256).Hash -ne '${script_sha}') { throw 'The downloaded script is not the one this DSpatch expects; it was not run.' }; Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; & \$f ${script_args}"
else
  command="Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force; & .\\dspatch-prepare-windows-host.ps1 ${script_args}"
fi

saved="${HOME}/dspatch-windows-command.txt"
if printf '%s\r\n' "${command}" >"${saved}" 2>/dev/null; then
  saved_note="It is also saved in ${saved}."
else
  saved_note=""
fi

ssh_user="${win_user:-<windows-user>}"
if [[ "${ssh_user}" == *\\* ]]; then
  ssh_user="'${ssh_user}'"
fi
ssh_target="${ssh_user}@${win_host:-<windows-host>}"

say ''
say '=== Next: on the Windows computer ==='
say ''
say '1. Get the command below to the Windows computer: mail or chat it to yourself, or copy the file'
say '   on a USB stick. It holds only your public key, which is not secret.'
[[ -z "${saved_note}" ]] || say "   ${saved_note}"
if [[ -z "${version}" ]]; then
  say '   Put dspatch-prepare-windows-host.ps1 (DSpatch Help: Save Windows script...) in a folder there.'
fi
say '2. Open PowerShell as administrator: Start, type PowerShell, right-click Windows PowerShell,'
say '   Run as administrator.'
if [[ -z "${version}" ]]; then
  say '   Go to the script'"'"'s folder with cd.'
fi
say '3. Paste the command and press Enter. It shows what it will change and asks Proceed? [y/N]:'
say '   answer y. Leave the window open: at the end it shows the fingerprints for the last step.'
say ''
say "${command}"
say ''
if [[ -z "${win_user}" ]]; then
  say "The Windows script sets up the account that runs it. For another account, add -User '<windows-user>'."
fi
if [[ -z "${local_address}" ]]; then
  say "Replace <this-computer-ip> with this computer's address from the list above, in the command and in ${saved}."
fi
say ''
say '=== Then, back on this computer ==='
say ''
say "  ssh ${ssh_target}"
say ''
say 'Answer yes only if the fingerprint ssh shows is one of those in the Windows window; then type exit.'
say "In DSpatch: Remote Session, enter ${ssh_target}, Connect."
