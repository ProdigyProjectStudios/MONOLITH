"""Prompt on a real terminal and atomically save a restricted server-side secret."""

import argparse
import getpass
import os
import sys
import warnings
from pathlib import Path
from tempfile import NamedTemporaryFile


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("file", type=Path, help="Secret path outside the repository")
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    target = args.file.expanduser().resolve()
    if target.is_relative_to(root) or not sys.stdin.isatty():
        parser.exit(
            2, "Use an interactive terminal and a path outside the repository.\n"
        )
    if target.exists():
        parser.exit(2, "That file exists. Choose a new path for credential rotation.\n")
    target.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if target.parent.stat().st_mode & 0o077:
        parser.exit(
            2, "The secret directory must be private to its owner (chmod 700).\n"
        )
    warnings.simplefilter("error", getpass.GetPassWarning)
    key = getpass.getpass(
        "OpenAI project key (hidden input, press Enter to save): "
    ).strip()
    if (
        not key
        or not key.isascii()
        or not all(33 <= ord(ch) <= 126 for ch in key)
        or len(key) > 8192
    ):
        parser.exit(2, "No valid key entered. Nothing saved.\n")
    with NamedTemporaryFile(
        mode="w", dir=target.parent, encoding="ascii", delete=False
    ) as tmp:
        private = Path(tmp.name)
        try:
            tmp.write(key + "\n")
            tmp.flush()
            os.fsync(tmp.fileno())
            os.link(private, target)
        finally:
            private.unlink(missing_ok=True)
    print("Server-side key saved. This terminal can be closed.")


if __name__ == "__main__":
    main()
