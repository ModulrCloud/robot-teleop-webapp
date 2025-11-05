# amplify/functions/python/test_handler.py
import base64
import json
from typing import Any, Dict, List

import boto3
import pytest
from moto import mock_aws
import importlib.util
import pathlib
import os


def mk_token(payload: Dict[str, Any]) -> str:
    """
    Make an unsigned JWT-like token for _decode_jwt_noverify tests.
    (header and signature are dummy; only payload matters)
    """
    def b64(s: bytes) -> str:
        import base64 as _b64
        return _b64.urlsafe_b64encode(s).decode("utf-8").rstrip("=")

    header = b64(b'{"alg":"none","typ":"JWT"}')
    body = b64(json.dumps(payload).encode("utf-8"))
    return f"{header}.{body}.signature"


class FakeApiGwClient:
    """Minimal stub of apigatewaymanagementapi client."""
    class exceptions:  # mimic boto3 shape
        class GoneException(Exception):
            pass

    def __init__(self) -> None:
        self.sent: List[Dict[str, Any]] = []

    def post_to_connection(self, ConnectionId: str, Data: bytes) -> None:
        # Record the message instead of sending anywhere
        self.sent.append({"ConnectionId": ConnectionId, "Data": Data})


def setup_env_and_tables():
    """
    Creates in-memory DynamoDB tables and returns (ddb, conn_tbl, presence_tbl).
    """
    os.environ["AWS_DEFAULT_REGION"] = "us-east-1"  # moto needs a region
    os.environ["CONN_TABLE"] = "LocalConnections"
    os.environ["ROBOT_PRESENCE_TABLE"] = "LocalPresence"
    os.environ["WS_MGMT_ENDPOINT"] = "http://localhost"

    ddb = boto3.resource("dynamodb", region_name="us-east-1")
    conn_tbl = ddb.create_table(
        TableName="LocalConnections",
        KeySchema=[{"AttributeName": "connectionId", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "connectionId", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    presence_tbl = ddb.create_table(
        TableName="LocalPresence",
        KeySchema=[{"AttributeName": "robotId", "KeyType": "HASH"}],
        AttributeDefinitions=[{"AttributeName": "robotId", "AttributeType": "S"}],
        BillingMode="PAY_PER_REQUEST",
    )
    # Wait until tables exist
    conn_tbl.meta.client.get_waiter("table_exists").wait(TableName="LocalConnections")
    presence_tbl.meta.client.get_waiter("table_exists").wait(TableName="LocalPresence")
    return ddb, conn_tbl, presence_tbl


@pytest.fixture(autouse=True)
def fresh_handler(monkeypatch):
    """
    For each test:
      - Start moto AWS mocks
      - Create in-memory DynamoDB tables
      - Import handler.py by absolute path (hyphen-safe)
      - Monkeypatch module singletons: _ddb, _conn_tbl, _presence_tbl, _apigw
    Yields (h, fake_apigw).
    """
    with mock_aws():
        ddb, conn_tbl, presence_tbl = setup_env_and_tables()

        # Resolve handler.py next to THIS test file
        here = pathlib.Path(__file__).parent
        handler_path = here / "handler.py"

        spec = importlib.util.spec_from_file_location("signaling_handler", handler_path)
        assert spec and spec.loader, "Could not load handler.py"
        h = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
        spec.loader.exec_module(h)  # type: ignore[assignment]

        fake_apigw = FakeApiGwClient()

        # Patch module singletons so it uses our moto tables and fake client
        monkeypatch.setattr(h, "_ddb", ddb, raising=True)
        monkeypatch.setattr(h, "_conn_tbl", conn_tbl, raising=True)
        monkeypatch.setattr(h, "_presence_tbl", presence_tbl, raising=True)
        monkeypatch.setattr(h, "_apigw", fake_apigw, raising=True)

        yield h, fake_apigw


# ------------------ tests ------------------

def test_decode_jwt_noverify_parses_sub(fresh_handler):
    h, _ = fresh_handler
    token = mk_token({"sub": "user-123", "cognito:groups": ["ADMINS"], "aud": "abc"})
    claims = h._decode_jwt_noverify(token)
    assert claims and claims["sub"] == "user-123"
    assert claims["groups"] == ["ADMINS"]
    assert claims["aud"] == "abc"


def test_connect_writes_connection(fresh_handler):
    h, _ = fresh_handler
    token = mk_token({"sub": "u1"})
    ev = {
        "requestContext": {"routeKey": "$connect", "connectionId": "C-1"},
        "queryStringParameters": {"token": token},
    }
    resp = h.handler(ev, None)
    assert resp["statusCode"] == 200

    got = h._conn_tbl.get_item(Key={"connectionId": "C-1"}).get("Item")
    assert got and got["userId"] == "u1"


def test_register_claims_robot_and_can_be_looked_up(fresh_handler):
    h, _ = fresh_handler
    token = mk_token({"sub": "owner-1"})
    ev = {
        "requestContext": {"routeKey": "$default", "connectionId": "R-conn"},
        "queryStringParameters": {"token": token},
        "body": json.dumps({"type": "register", "robotId": "robot-001"}),
    }
    resp = h.handler(ev, None)
    assert resp["statusCode"] == 200

    item = h._presence_tbl.get_item(Key={"robotId": "robot-001"}).get("Item")
    assert item and item["ownerUserId"] == "owner-1" and item["connectionId"] == "R-conn"
    assert h._find_robot_conn("robot-001") == "R-conn"


def test_client_offer_forwards_to_robot(fresh_handler):
    h, fake_apigw = fresh_handler

    tok_robot_owner = mk_token({"sub": "owner-1"})
    reg_ev = {
        "requestContext": {"routeKey": "$default", "connectionId": "R-1"},
        "queryStringParameters": {"token": tok_robot_owner},
        "body": json.dumps({"type": "register", "robotId": "robot-9"}),
    }
    assert h.handler(reg_ev, None)["statusCode"] == 200

    tok_client = mk_token({"sub": "owner-1"})  # same owner allowed
    conn_ev = {
        "requestContext": {"routeKey": "$connect", "connectionId": "C-1"},
        "queryStringParameters": {"token": tok_client},
    }
    assert h.handler(conn_ev, None)["statusCode"] == 200

    offer_ev = {
        "requestContext": {"routeKey": "$default", "connectionId": "C-1"},
        "queryStringParameters": {"token": tok_client},
        "body": json.dumps({
            "type": "offer",
            "robotId": "robot-9",
            "target": "robot",
            "payload": {"type": "offer", "sdp": "v=0..."}
        }),
    }
    resp = h.handler(offer_ev, None)
    assert resp["statusCode"] == 200

    assert len(fake_apigw.sent) == 1
    sent = fake_apigw.sent[0]
    assert sent["ConnectionId"] == "R-1"
    forwarded = json.loads(sent["Data"].decode("utf-8"))
    assert forwarded["type"] == "offer"
    assert forwarded["robotId"] == "robot-9"


def test_robot_answer_forwards_to_client(fresh_handler):
    h, fake_apigw = fresh_handler

    tok_robot_owner = mk_token({"sub": "owner-2"})
    assert h.handler({
        "requestContext": {"routeKey": "$default", "connectionId": "R-2"},
        "queryStringParameters": {"token": tok_robot_owner},
        "body": json.dumps({"type": "register", "robotId": "robot-42"}),
    }, None)["statusCode"] == 200

    tok_client = mk_token({"sub": "owner-2"})
    assert h.handler({
        "requestContext": {"routeKey": "$connect", "connectionId": "C-2"},
        "queryStringParameters": {"token": tok_client},
    }, None)["statusCode"] == 200

    resp = h.handler({
        "requestContext": {"routeKey": "$default", "connectionId": "R-2"},
        "queryStringParameters": {"token": tok_robot_owner},
        "body": json.dumps({
            "type": "answer",
            "robotId": "robot-42",
            "target": "client",
            "clientConnectionId": "C-2",
            "payload": {"type": "answer", "sdp": "v=0..."}
        }),
    }, None)
    assert resp["statusCode"] == 200
    assert len(fake_apigw.sent) == 1
    out = json.loads(fake_apigw.sent[0]["Data"].decode("utf-8"))
    assert out["type"] == "answer"
    assert out["robotId"] == "robot-42"


def test_takeover_requires_owner_or_admin(fresh_handler):
    h, fake_apigw = fresh_handler

    tok_owner_a = mk_token({"sub": "owner-A"})
    assert h.handler({
        "requestContext": {"routeKey": "$default", "connectionId": "R-3"},
        "queryStringParameters": {"token": tok_owner_a},
        "body": json.dumps({"type": "register", "robotId": "robot-A"}),
    }, None)["statusCode"] == 200

    tok_user_b = mk_token({"sub": "user-B"})
    resp = h.handler({
        "requestContext": {"routeKey": "$default", "connectionId": "C-3"},
        "queryStringParameters": {"token": tok_user_b},
        "body": json.dumps({"type": "takeover", "robotId": "robot-A"}),
    }, None)
    assert resp["statusCode"] == 403

    tok_admin = mk_token({"sub": "admin-1", "cognito:groups": ["ADMINS"]})
    resp2 = h.handler({
        "requestContext": {"routeKey": "$default", "connectionId": "C-4"},
        "queryStringParameters": {"token": tok_admin},
        "body": json.dumps({"type": "takeover", "robotId": "robot-A"}),
    }, None)
    assert resp2["statusCode"] == 200
    assert len(fake_apigw.sent) == 1
    msg = json.loads(fake_apigw.sent[0]["Data"].decode("utf-8"))
    assert msg["type"] in ("admin-takeover", "owner-takeover")
