"""Inject the mounted provider credential into the requested server process."""

import os
import sys

from .portable_investigation import InvestigationError
from .runtime_config import openai_secret


def main():
    if len(sys.argv) < 2:
        raise SystemExit("A server or worker command is required.")
    try:
        key = openai_secret()
    except InvestigationError as error:
        raise SystemExit(str(error)) from None
    if not key:
        raise SystemExit("The mounted OpenAI secret is missing.")
    os.environ["OPENAI_API_KEY"] = key
    os.execvp(sys.argv[1], sys.argv[1:])


if __name__ == "__main__":
    main()
