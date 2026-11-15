#!/usr/bin/env bash
# DSpatch: get this Linux computer ready to sign in to a Windows host over SSH (DSP-214).
#
#     dspatch-prepare-linux-client.sh [<windows-host>]
#
# Finds your SSH public key, or creates a new ed25519 key if you have none, and prints the one
# command to run on Windows (dspatch-prepare-windows-host.ps1) with that key and this computer's
# address filled in. It never overwrites a key, and never prints or copies a private key: only the
# public key (.pub) leaves this computer. Safe to run again: it only reads what is already there.
#
# <windows-host> may be the Windows computer's address or name, or <windows-user>@<windows-host>.
# With it, the address this computer uses to reach Windows is shown; without it, every IPv4
# address of this computer is listed.

set -euo pipefail

ssh_dir="${HOME}/.ssh"
target="${1:-}"
if [[ "${target}" == "-h" || "${target}" == "--help" ]]; then
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
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
else
  user_arg=" -User '<windows-user>'"
fi

say ''
say 'Your public key (only this line goes to Windows; the private key stays here):'
say ''
say "  ${key}"
say ''
say 'On Windows, in PowerShell as administrator, in the folder with dspatch-prepare-windows-host.ps1, run:'
say ''
say "  .\\dspatch-prepare-windows-host.ps1 -PublicKey '${ps_key}' -AllowFrom ${allow_from}${user_arg}"
say ''
if [[ -z "${win_user}" ]]; then
  say "Replace <windows-user> with the Windows account DSpatch should sign in as, or leave -User out to use the account that runs the script."
fi
if [[ -z "${local_address}" ]]; then
  say "Replace <this-computer-ip> with this computer's address from the list above."
fi
say 'If this computer'"'"'s address changes from day to day, give its network instead, for example -AllowFrom <network>/24.'
say 'Add -DryRun first to see the plan without changing anything.'
say ''
say 'Then, back here, sign in once and compare the fingerprint ssh shows with the ones the script printed on Windows:'
say ''
ssh_user="${win_user:-<windows-user>}"
if [[ "${ssh_user}" == *\\* ]]; then
  ssh_user="'${ssh_user}'"
fi
say "  ssh ${ssh_user}@${win_host:-<windows-host>}"
say ''
say 'Answer yes only if the fingerprint is one of those. Then use Remote Session in DSpatch with the same user@host.'
