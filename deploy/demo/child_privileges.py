#!/usr/bin/python3 -I
"""Keep the writer lease in a root guardian; execute an isolated child identity."""
import ctypes
import os
from pathlib import Path
import resource
import signal
import sys

IDENTITIES = {'app': 10001, 'contacts': 10002}


def drop_privileges(identity):
    if os.getuid() != 0 or identity not in IDENTITIES:
        raise RuntimeError('root guardian and known child identity required')
    libc = ctypes.CDLL(None, use_errno=True)
    def prctl(option, value):
        if libc.prctl(option, value, 0, 0, 0):
            raise RuntimeError('child privilege restriction failed')
    # No executable, including setuid binaries or file capabilities, may regain
    # privilege. Drop the bounding set before losing CAP_SETPCAP with setuid.
    prctl(38, 1)  # PR_SET_NO_NEW_PRIVS
    for capability in range(int(Path('/proc/sys/kernel/cap_last_cap').read_text()) + 1):
        prctl(24, capability)  # PR_CAPBSET_DROP
    os.setgroups([])
    os.setgid(IDENTITIES[identity])
    os.setuid(IDENTITIES[identity])
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))


def main():
    if len(sys.argv) < 3 or sys.argv[1] not in IDENTITIES or os.getuid() != 0:
        raise RuntimeError('invalid privileged child request')
    identity, command = sys.argv[1], sys.argv[2:]
    libc = ctypes.CDLL(None, use_errno=True)
    if libc.prctl(36, 1, 0, 0, 0):  # PR_SET_CHILD_SUBREAPER
        raise RuntimeError('child supervision unavailable')
    guardian = os.getpid()
    # Fork in this fresh single-threaded process, never the threaded controller.
    # The guardian alone retains inherited lease descriptors; an untrusted child
    # must not be able to unlock the controller's shared open-file description.
    signals = (signal.SIGTERM, signal.SIGINT)
    previous = signal.pthread_sigmask(signal.SIG_BLOCK, signals)
    child = os.fork()
    if child == 0:
        try:
            for entry in Path('/proc/self/fd').iterdir():
                descriptor = int(entry.name)
                if descriptor > 2:
                    try: os.close(descriptor)
                    except OSError: pass
            drop_privileges(identity)
            # setuid clears PDEATHSIG, so arm it after dropping identity.
            if libc.prctl(1, signal.SIGKILL, 0, 0, 0) or os.getppid() != guardian:
                os._exit(1)
            for sig in signals: signal.signal(sig, signal.SIG_DFL)
            signal.pthread_sigmask(signal.SIG_SETMASK, previous)
            os.execvpe(command[0], command, os.environ)
        except BaseException:
            os._exit(1)
    def descendants():
        return [int(value) for value in Path('/proc/self/task/'+str(os.getpid())+'/children').read_text().split()]
    def forward(sig, _frame):
        for pid in descendants():
            try: os.kill(pid, sig)
            except ProcessLookupError: pass
    for sig in signals: signal.signal(sig, forward)
    signal.pthread_sigmask(signal.SIG_SETMASK, previous)
    _, status = os.waitpid(child, 0)
    # Adopted grandchildren (even ones that changed process group) must drain
    # before the guardian releases the lease. Never kill only the guardian on
    # a timeout: the controller retains it until container-wide shutdown.
    while True:
        forward(signal.SIGTERM, None)
        try: os.waitpid(-1, 0)
        except ChildProcessError: break
    code = os.waitstatus_to_exitcode(status)
    # The controller accepts a SIGTERM drain; represent it as a clean guardian exit.
    return 0 if code == -signal.SIGTERM else code if code >= 0 else 1


if __name__ == '__main__':
    try: sys.exit(main())
    except Exception:
        print('isolated demo child failed', file=sys.stderr)
        sys.exit(1)
