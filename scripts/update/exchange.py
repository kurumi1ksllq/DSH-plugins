#!/usr/bin/env python3
"""Atomically exchange two paths via renameat2(RENAME_EXCHANGE).

Usage: exchange.py <pathA> <pathB>
Exit 0 on success; exit 1 with an errno message when the kernel/fs refuses.

Why a helper instead of Node: Node exposes no renameat2. A single
RENAME_EXCHANGE syscall swaps two directory trees with no window in which
either path is absent, and the *old* tree ends up at the other path, so the
rollback copy comes for free — no copy, no extra disk, no window.

Falls back to SYS_renameat2(316) on x86_64 when libc has no wrapper, which is
the only portable-ish path without a C toolchain.
"""
import ctypes
import errno
import os
import sys

AT_FDCWD = -100
RENAME_EXCHANGE = 2
SYS_RENAMEAT2_X86_64 = 316


def exchange(libc, a, b):
    if hasattr(libc, "renameat2"):
        return libc.renameat2(AT_FDCWD, a, AT_FDCWD, b, RENAME_EXCHANGE)
    if hasattr(libc, "syscall"):
        return libc.syscall(SYS_RENAMEAT2_X86_64, AT_FDCWD, a, AT_FDCWD, b, RENAME_EXCHANGE)
    raise OSError(errno.ENOSYS, "neither renameat2 nor syscall is available in libc")


def main():
    if len(sys.argv) != 3:
        print("usage: exchange.py <pathA> <pathB>", file=sys.stderr)
        return 2
    libc = ctypes.CDLL("libc.so.6", use_errno=True)
    a = sys.argv[1].encode()
    b = sys.argv[2].encode()
    try:
        rc = exchange(libc, a, b)
    except OSError as error:
        print("renameat2(RENAME_EXCHANGE) unavailable: %s" % error, file=sys.stderr)
        return 1
    if rc != 0:
        err = ctypes.get_errno()
        print("renameat2(RENAME_EXCHANGE) failed: %s" % os.strerror(err), file=sys.stderr)
        return 1
    print("exchanged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
