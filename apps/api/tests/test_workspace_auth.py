import pytest
from monolith.settings import workspace_tokens


def test_production_rejects_anonymous_mode(monkeypatch):
    monkeypatch.setenv("MONOLITH_ENV", "production")
    monkeypatch.setenv("TENANT_TOKENS", "{}")
    with pytest.raises(RuntimeError, match="authenticated workspaces"):
        workspace_tokens()
    monkeypatch.setenv("TENANT_TOKENS", '{"northstar":"workspace-specific-token"}')
    assert set(workspace_tokens()) == {"northstar"}


@pytest.mark.parametrize(
    "value", ['{"alpha":"same","beta":"same"}', '{"alpha":"  "}', "[]", '{"alpha":0}']
)
def test_invalid_identity_mapping_fails_closed(monkeypatch, value):
    monkeypatch.setenv("TENANT_TOKENS", value)
    with pytest.raises(RuntimeError):
        workspace_tokens()


def test_oauth_access_log_omits_authorisation_query():
    import logging

    from monolith.settings import redact_oauth_access_logs

    redact_oauth_access_logs()
    record = logging.LogRecord(
        "uvicorn.access",
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d',
        (
            "local",
            "GET",
            "/api/connectors/hubspot/oauth/callback?code=fixture&state=test",
            "1.1",
            200,
        ),
        None,
    )
    assert logging.getLogger("uvicorn.access").filter(record)
    assert record.args[2] == "/api/connectors/hubspot/oauth/callback"
