"""Resolve credentials exclusively inside the API or worker process."""

import os
import stat

from .portable_investigation import InvestigationError


def openai_secret():
    path = os.getenv("OPENAI_API_KEY_FILE")
    if path:
        try:
            # Kubernetes projected secrets can be symlinks. Validate the opened object.
            fd = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
            with os.fdopen(fd, "rb") as stream:
                if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
                    raise ValueError
                raw = stream.read(8193)
                if len(raw) > 8192:
                    raise ValueError
                value = raw.decode("ascii").strip()
        except (OSError, ValueError):
            raise InvestigationError(
                "The configured OpenAI secret file is invalid or unreadable."
            ) from None
    else:
        value = os.getenv("OPENAI_API_KEY", "").strip()
        if not value:
            return None
    if not value or len(value) > 8192 or not all(33 <= ord(c) <= 126 for c in value):
        raise InvestigationError("The configured OpenAI credential is invalid.")
    return value


def credential_status():
    source = (
        "file"
        if os.getenv("OPENAI_API_KEY_FILE")
        else "environment"
        if os.getenv("OPENAI_API_KEY")
        else "none"
    )
    try:
        configured = bool(openai_secret())
    except InvestigationError:
        return {"configured": False, "source": source, "status": "invalid"}
    return {
        "configured": configured,
        "source": source,
        "status": "configured" if configured else "missing",
    }


def model_calls_enabled():
    return os.getenv("MONOLITH_MODEL_CALLS_ENABLED", "0") == "1"


def require_model_calls():
    if not model_calls_enabled():
        raise InvestigationError("Model calls are disabled by the server operator.")


def openai_configured():
    return model_calls_enabled() and credential_status()["configured"]
