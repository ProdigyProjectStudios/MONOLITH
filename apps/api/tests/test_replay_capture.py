"""Capture release checks. Generated examples use an isolated in-memory SDK transport."""

import hashlib
import json
from copy import deepcopy
from types import SimpleNamespace

import httpx
import pytest
from monolith import replay_capture as archive
from replay_sample import sample, sample_contract
from test_live_acceptance import cli


@pytest.fixture(scope="module")
def protocol_recording():
    return sample()


@pytest.fixture(scope="module")
def example(protocol_recording):
    return sample_contract(*protocol_recording)


@pytest.fixture
def inputs(example):
    # Mutations below are independent. There are no on-disk example recordings.
    return deepcopy(example)


def capture(parts, tenant="northstar", token="test-only-bearer"):
    run, snapshot, acceptance = parts
    return archive.build_capture(
        run, snapshot, run["events"][:-1], acceptance, tenant, token
    )


def event(run, kind, stage=None):
    return next(
        e["payload"]
        for e in run["events"]
        if e["kind"] == kind and (stage is None or stage == e["stage"])
    )


def test_offline_transport_never_passes_release_attestation(
    protocol_recording, example
):
    run, snapshot = protocol_recording
    with pytest.raises(cli.Incomplete, match="official"):
        cli.attest(run, run["events"][:-1], snapshot)
    with pytest.raises(archive.CaptureError, match="transport|official"):
        capture((run, snapshot, example[2]))


def test_full_replay_preserves_audited_work_but_omits_credentials_and_raw_receipts(
    inputs,
):
    run, snapshot, acceptance = inputs
    marker = "private-company-staging-token"
    run["worker"] = marker
    run["result"]["debug"] = marker
    snapshot["report"]["private_workspace_note"] = marker
    for entry in run["events"]:
        entry["trace_context"] = marker
    raw_receipt = event(run, "model_call")
    body = capture(inputs, token=marker)
    packet = json.loads(body)
    assert marker.encode() not in body
    assert raw_receipt["response_id"].encode() not in body
    assert raw_receipt["request_id"].encode() not in body
    assert "checked_at" not in packet["acceptance"]
    assert packet["provenance"]["scope"] == "full_investigation"
    assert packet["provenance"]["captured_at"] == run["approval"]["at"]
    public = json.loads(archive.DEMO.read_bytes())
    public["report"]["traces"] = []
    assert packet["snapshot"] == public
    assert packet["run"]["approval"] == run["approval"]
    assert [e["kind"] for e in packet["run"]["events"]] == [
        e["kind"] for e in run["events"]
    ]
    result = packet["run"]["result"]
    assert result["package"] == run["result"]["package"]
    assert result["trials"] == run["result"]["trials"]
    assert set(result["stages"]) == set(cli.STAGES)
    assert result["evaluation"]["support"]["failed"] == 0
    assert result["evaluation"]["human_control"]["status"] == "pass"
    assert len(result["model_calls"]) == acceptance["model_calls"]
    assert all(r["response_id"].startswith("response-") for r in result["model_calls"])
    assert (
        sum(r["usage"]["total_tokens"] for r in result["model_calls"])
        == acceptance["tokens"]["total_tokens"]
    )


@pytest.mark.parametrize("target", ["events", "docs", "sources"])
def test_private_record_or_even_changed_synthetic_field_refused(inputs, target):
    _, snapshot, _ = inputs
    snapshot["data"][target][0]["imported_private_value"] = "unexpected"
    with pytest.raises(archive.CaptureError, match="pinned"):
        capture(inputs)
    snapshot["data"][target][0]["synthetic"] = False
    with pytest.raises(archive.CaptureError, match="synthetic"):
        capture(inputs)


def test_seed_order_irrelevant_and_window_required(inputs):
    _, snapshot, _ = inputs
    for rows in snapshot["data"].values():
        rows.reverse()
    assert archive.seed_hash(snapshot["data"]) == archive.SEED_SHA256
    snapshot["report"]["case_ids"].pop()
    with pytest.raises(archive.CaptureError, match="window"):
        capture(inputs)


def test_scope_requires_matching_tenant_and_positive_provider_attestation(inputs):
    with pytest.raises(archive.CaptureError, match="workspace"):
        capture(inputs, tenant="another-synthetic-tenant")
    inputs[2]["acceptance"] = "observed_single_response"
    with pytest.raises(archive.CaptureError, match="completed"):
        capture(inputs)


@pytest.mark.parametrize(
    "change", ["missing", "ineligible", "precedes", "unrecorded", "wrong_event"]
)
def test_approval_must_be_a_real_post_verification_checkpoint(inputs, change):
    run = inputs[0]
    if change == "missing":
        run.pop("approval")
    if change == "ineligible":
        run["approval"]["approach"] = "another-design"
    if change == "precedes":
        run["approval"]["at"] = run["created"]
        run["events"][-1]["payload"] = run["approval"]
    if change == "unrecorded":
        run["events"][-1]["kind"] = "human_review_requested"
    if change == "wrong_event":
        run["events"][-1]["payload"] = {"at": run["approval"]["at"]}
    with pytest.raises(archive.CaptureError, match="approval"):
        capture(inputs)


def test_approval_cannot_override_a_reviewers_veto(inputs):
    run = inputs[0]
    verification = run["result"]["stages"]["verification"]
    name = run["approval"]["approach"]
    reviews = run["result"]["stages"]["architect"]["debate"]["assessments"]
    reviews[0]["rejected"].append(name)
    assert name in verification["eligible_designs"]
    with pytest.raises(archive.CaptureError, match="review and verification"):
        capture(inputs)


def test_single_receipt_or_fixture_does_not_form_a_release(inputs):
    raw = event(inputs[0], "model_call")
    raw["response_id"] = "resp_for_a_fixture_only"
    with pytest.raises(archive.CaptureError, match="fixture"):
        capture(inputs)
    inputs[0]["events"] = [inputs[0]["events"][0], inputs[0]["events"][-1]]
    with pytest.raises(archive.CaptureError, match="terminal"):
        capture(inputs)


def test_projection_refuses_unrecognized_event_and_modifications_to_blueprint(inputs):
    run = inputs[0]
    run["events"][0]["kind"] = "debug_credentials"
    with pytest.raises(archive.CaptureError, match="event"):
        capture(inputs)
    run["events"][0]["kind"] = "run_queued"
    run["result"]["package"]["approaches"][0]["artifacts"][0]["body"] = "arbitrary text"
    with pytest.raises(archive.CaptureError, match="blueprint|safeguard"):
        capture(inputs)


def test_independent_evaluation_recomputed_for_an_accepted_legacy_design(inputs):
    run = inputs[0]
    run["result"]["stages"]["strategy"]["refund_authority"] = "unattended"
    run["result"]["evaluation"] = {"status": "pass"}
    with pytest.raises(archive.CaptureError, match="safeguard"):
        capture(inputs)


def test_credential_within_visible_model_prose_is_refused_without_echo(inputs):
    run = inputs[0]
    secret = "Bearer secret-abcdefghijklmnop"
    run["result"]["stages"]["strategy"]["summary"] = secret
    event(run, "stage_completed", "strategy")["summary"] = secret
    with pytest.raises(archive.CaptureError, match="Potential credential") as error:
        capture(inputs)
    assert secret not in str(error.value)


def test_tampered_tool_measurement_is_not_published_as_a_valid_read(inputs):
    p = next(
        e["payload"]
        for e in inputs[0]["events"]
        if e["kind"] == "tool_result" and e["payload"]["name"] == "measure_intervals"
    )
    p["result"]["median_hours"] += 1
    with pytest.raises(archive.CaptureError, match="tool output"):
        capture(inputs)


def test_catalog_integrity_reproducibility_corrupt_target_and_fixture_refusal(
    inputs, tmp_path
):
    body = capture(inputs)
    inputs[2]["checked_at"] = "2099-01-01T01:02:03+00:00"
    assert capture(inputs) == body
    output = tmp_path / "ephemeral-catalog"
    entry = archive.publish(output, body)
    assert entry["sha256"] == hashlib.sha256(body).hexdigest()
    assert entry["bytes"] == len(body)
    payload = output / entry["path"].split("/")[-1]
    assert payload.read_bytes() == body
    assert json.loads((output / "index.json").read_bytes()) == {
        "schema": "monolith.replays.index.v1",
        "captures": [entry],
    }
    assert archive.publish(output, body) == entry
    index = (output / "index.json").read_bytes()
    payload.write_bytes(b"altered")
    with pytest.raises(archive.CaptureError, match="content hash"):
        archive.publish(output, body)
    fixture = json.loads(body)
    fixture["test_only"] = True
    with pytest.raises(archive.CaptureError, match="full release"):
        archive.publish(output, archive.encoded(fixture))
    assert (output / "index.json").read_bytes() == index


def test_cli_export_only_performs_authenticated_reads_and_cannot_start_a_run(
    inputs, tmp_path
):
    run, snapshot, _ = inputs
    calls = []

    def respond(req):
        calls.append((req.method, req.url.path))
        assert req.method == "GET"
        if req.headers.get("authorization") != "Bearer unit-test-only":
            return httpx.Response(401)
        path = req.url.path
        if path.endswith("/events"):
            lines = "".join(
                f"id: {e['seq']}\ndata: {json.dumps(e)}\n\n" for e in run["events"]
            )
            return httpx.Response(
                200, headers={"content-type": "text/event-stream"}, text=lines
            )
        if path.endswith("/snapshot"):
            return httpx.Response(200, json=snapshot)
        if path.endswith("/workspace"):
            return httpx.Response(200, json={"tenant": "northstar"})
        return httpx.Response(200, json=run)

    options = SimpleNamespace(
        start=False, run_id=run["id"], timeout=20, export_replay=tmp_path / "catalog"
    )
    assert cli.main(["--start", "--export-replay", str(tmp_path / "forbidden")]) == 2
    assert not (tmp_path / "forbidden").exists()
    with httpx.Client(
        transport=httpx.MockTransport(respond), base_url="http://127.0.0.1/api/"
    ) as client:
        result = cli.verify(client, options, "unit-test-only")
    assert result["replay"]["sha256"] == hashlib.sha256(capture(inputs)).hexdigest()
    assert json.loads((options.export_replay / "index.json").read_bytes())[
        "captures"
    ] == [result["replay"]]
    assert calls[0] == ("GET", "/api/investigations")
