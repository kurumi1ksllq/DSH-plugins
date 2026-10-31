#!/usr/bin/env python
"""Tiny SSH runner for the deploy box (password auth, paramiko).

Usage:
  python rc.py run "cmd"              # run a command, print stdout/stderr/exit
  python rc.py put <local> <remote>   # upload a file
  python rc.py putdir <local> <remote># upload a directory (recursive)
  python rc.py get <remote> <local>   # download a file

Credentials come from env: RC_HOST, RC_PORT, RC_USER, RC_PASS.
"""
import os
import sys
import stat

import paramiko

HOST = os.environ["RC_HOST"]
PORT = int(os.environ.get("RC_PORT", "22"))
USER = os.environ["RC_USER"]
PASS = os.environ["RC_PASS"]


def connect():
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(
        hostname=HOST,
        port=PORT,
        username=USER,
        password=PASS,
        timeout=20,
        banner_timeout=30,
        auth_timeout=30,
        look_for_keys=False,
        allow_agent=False,
    )
    return client


def run(client, cmd, timeout=600):
    stdin, stdout, stderr = client.exec_command(cmd, timeout=timeout, get_pty=False)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    sys.stdout.write(out)
    if err:
        sys.stderr.write(err)
    return code


def stream_put(client, local, remote):
    """Upload through the exec channel's stdin.

    SFTP is unusable on this box (server-side opens answer ENOENT even for
    /root/x), but a plain exec channel works, so bytes go over `cat > file`.
    """
    with open(local, "rb") as handle:
        payload = handle.read()
    command = f"cat > {remote}"
    stdin, stdout, stderr = client.exec_command(command, timeout=600, get_pty=False)
    stdin.write(payload)
    stdin.flush()
    stdin.channel.shutdown_write()
    err = stderr.read().decode("utf-8", "replace")
    code = stdout.channel.recv_exit_status()
    if err:
        sys.stderr.write(err)
    print(f"put {local} -> {remote} ({len(payload)} bytes, exit {code})")
    return code


def sftp_put_file(sftp, local, remote):
    sftp.put(local, remote)
    print(f"put {local} -> {remote}")


def sftp_put_dir(sftp, local, remote):
    try:
        sftp.stat(remote)
    except IOError:
        sftp.mkdir(remote)
    for entry in sorted(os.listdir(local)):
        lp = os.path.join(local, entry)
        rp = remote.rstrip("/") + "/" + entry
        if os.path.isdir(lp):
            sftp_put_dir(sftp, lp, rp)
        else:
            sftp_put_file(sftp, lp, rp)


def main():
    action = sys.argv[1]
    client = connect()
    try:
        if action == "run":
            code = run(client, sys.argv[2])
            return code
        if action == "put":
            return stream_put(client, sys.argv[2], sys.argv[3])
        if action == "putdir":
            return stream_put(client, sys.argv[2], sys.argv[3])
        if action == "get":
            sftp = client.open_sftp()
            sftp.get(sys.argv[2], sys.argv[3])
            sftp.close()
            return 0
        raise SystemExit(f"unknown action {action}")
    finally:
        client.close()


if __name__ == "__main__":
    sys.exit(main() or 0)
