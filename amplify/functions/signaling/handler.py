import base64, json, os, time
from typing import Any, Dict, List, Literal, Optional, TypedDict

import boto3
from botocore.exceptions import ClientError

# Local Defaults for testing offline
# COMMENT OUT IN PROD
os.environ.setdefault("CONN_TABLE", "LocalConnections")
os.environ.setdefault("ROBOT_PRESENCE_TABLE", "LocalPresence")
os.environ.setdefault("WS_MGMT_ENDPOINT", "http://localhost")

# Environment and AWS clients (added to backend.ts)
CONN_TABLE: str = os.environ["CONN_TABLE"]
ROBOT_PRESENCE_TABLE: str = os.environ["ROBOT_PRESENCE_TABLE"]
WS_MGMT_ENDPOINT: str = os.environ["WS_MGMT_ENDPOINT"]

# Creates reusable clients
_ddb = boto3.resource("dynamodb")
_conn_tbl = _ddb.Table(CONN_TABLE)
_presence_tbl = _ddb.Table(ROBOT_PRESENCE_TABLE)

# API gateway management client
_apigw = boto3.client("apigatewaymanagementapi", endpoint_url=WS_MGMT_ENDPOINT)

# Type definitions
class Claims(TypedDict, total = False):
    '''
    Subset of Cognito ID token claims used by this function
    '''

    sub: str
    groups: List[str]
    aud: str

class APIGatewayWSRequestContext(TypedDict, total = False):
    '''
    Subset of API Gateway Websocket requestConnect
    '''

    routeKey: str
    connectionId: str

class APIGatewayWSEvent(TypedDict, total = False):
    '''
    Event shape for API gateway websocket to lanbda integration

    Only includes members used by this function.
    '''

    requestContext: APIGatewayWSRequestContext
    queryStringParameters: Dict[str, str]
    body: str

#: TargetT defines the valid directions of signaling messages.
TargetT = Literal["robot", "client"]

#: MessageTypeT enumerates all supported signaling message kinds.
MessageTypeT = Literal["register", "offer", "answer", "ice-candidate", "takeover"]

class InboundMessage(TypedDict, total = False):
    '''
    JSON message sent by a connected client / robot on the websocket
    '''

    type: MessageTypeT
    robotId: str
    target: TargetT
    clientConnectionId: str
    payload: Dict[str, Any]

# JSON Web Token Handler
def _decode_jwt_noverify(token: Optional[str]) -> Optional[Claims]:
    '''
    Parse (no cryptographic verification) a JWT and return minimal claims
    '''

    if not token:
        return None
    try:
        token = token.strip()
        parts = token.split('.')
        if len(parts) != 3:
            return None
        payload_b64 = parts[1]
        pad = "=" * (-len(payload_b64) % 4) # fixes missing padding
        payload = json.loads(base64.urlsafe_b64decode(payload_b64 + pad).decode("utf-8"))
        claims: Claims = {
            "sub": payload.get("sub", ""),
            "groups": payload.get("cognito:groups", []) or [],
            "aud": payload.get("aud", ""),
        }
        return claims if claims.get("sub") else None
    except Exception:
        return None

# DynomoDB and API gateway utils

def _post_to(connection_id: str, message: Dict[str, Any]) -> None:
    '''
    Sends a JSON message to an dexisting WebSocket connection.

    Notes: 
    - Ignores 'GoneException'
    - Logs and continues on other ClientError exceptions
    '''

    try: 
        _apigw.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message).encode("utf-8"),
        )
    except _apigw.exceptions.GoneException:
        # $disconnect cleanup will remove stale items
        pass
    except ClientError as e:
        print("post_to_connection error:", repr(e))

def _find_robot_conn(robot_id: str) -> Optional[str]:
    '''
    Looks up the active WebSocket connectionId for a robotId
    '''

    item = _presence_tbl.get_item(Key={"robotId": robot_id}).get('Item')
    return item.get("connectionId") if item else None

# route handlers

def _on_connect(ev: APIGatewayWSEvent) -> Dict[str, Any]:
    '''
    Handles the $connect event: authenticate and store the connection record

    Process
    1. Read the ?token from query string
    2. Parse (no verify) to extract user 'sub' and 'groups
    3. Insert connection record into the CONN_TABLE
    '''

    qs = ev.get("queryStringParameters") or {}
    token = qs.get("token")
    claims = _decode_jwt_noverify(token)

    if not claims or not claims.get("sub"):
        return {"statusCode": 401, "body": "unauthorized"}
    
    conn_id = ev["requestContext"]["connectionId"]
    try:
        _conn_tbl.put_item(
            Item = {
                 "connectionId": conn_id,
                 "userId": claims["sub"],
                 "groups": ",".join(claims.get("groups", [])),
                 "kind": "client",
                 "ts": int(time.time() * 1000)
        }
    )
    except ClientError as e:
        print("connect put_item error:", repr(e))
    return {"statusCode": 200}

def _on_disconnect(ev: APIGatewayWSEvent) -> Dict[str, Any]:
    '''
    Handle $disconnect removes the connection record
    '''

    conn_id = ev["requestContext"]["connectionId"]
    try:
        _conn_tbl.delete_item(Key={"connectionId": conn_id})
    except ClientError as e:
        # We don't crash is we can't find the connection, but we do log it
        print("disconnect cleanup error:", repr(e))
    return {"statusCode": 200}

def _handle_register(claims: Claims, ev: APIGatewayWSEvent, msg: InboundMessage) -> Dict[str, Any]:
    '''
    Registers a robot presence
    '''

    robot_id = msg.get("robotId")
    if not robot_id:
        return {"statusCode": 400, "body": "robotId required"}

    now = int(time.time() * 1000)
    caller = claims["sub"]
    groups = set(claims.get("groups") or [])
    is_admin = ("ADMINS" in groups) or ("admin" in groups)

    try:
        _presence_tbl.put_item(
            Item={
                "robotId": robot_id,
                "ownerUserId": caller,
                "connectionId": ev["requestContext"]["connectionId"],
                "status": "online",
                "updatedAt": now,
                # "controllers": []  # TODO: optional ACL list; see note above
            },
            ConditionExpression="attribute_not_exists(ownerUserId) OR ownerUserId = :me",
            ExpressionAttributeValues={":me": caller},
        )
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code")
        if code == "ConditionalCheckFailedException" and not is_admin:
            return {"statusCode": 409, "body": "robot already registered by another owner"}
        if code == "ConditionalCheckFailedException" and is_admin:
            # Admins may force-claim
            _presence_tbl.put_item(
                Item={
                    "robotId": robot_id,
                    "ownerUserId": caller,
                    "connectionId": ev["requestContext"]["connectionId"],
                    "status": "online",
                    "updatedAt": now,
                }
            )
        else:
            print("presence put_item error:", repr(e))
            return {"statusCode": 500, "body": "dynamodb error"}

    return {"statusCode": 200}

def _handle_signal(claims: Claims, msg: InboundMessage) -> Dict[str, Any]:
    '''
    Forwards signaling messages between peers
    '''

    robot_id = msg.get("robotId")
    if not robot_id:
        return {"statusCode": 400, "body": "robotId required"}

    target = msg.get("target")
    if target == "robot":
        if not _is_owner_or_admin(robot_id, claims):
            return {"statusCode": 403, "body": "forbidden"}
        target_conn = _find_robot_conn(robot_id)
    elif target == "client":
        target_conn = msg.get("clientConnectionId")
        if not target_conn:
            return {"statusCode": 400, "body": "clientConnectionId required for target=client"}
    else:
        return {"statusCode": 400, "body": "invalid target"}

    if not target_conn:
        return {"statusCode": 404, "body": "target offline"}

    try:
        _post_to(
            target_conn,
            {
                "type": msg.get("type"),
                "robotId": robot_id,
                "from": claims.get("sub", ""),
                "payload": msg.get("payload"),
            },
        )
    except Exception as e:
        print("forward error:", repr(e))
        return {"statusCode": 500, "body": "forward failed"}

    return {"statusCode": 200}

def _is_owner_or_admin(robot_id: str, claims: Claims) -> bool:
    '''
    True if the caller owns the robotId or belongs to a platform admin group.

    Ownership should be recorded in RobotPresenceTable.ownerUserId at registration

    IDEA - at a later date we could add delegates / ACL to this so that owners could
    add additional admins in the future. We currently don't track that so I didn't add
    it
    '''

    rec = _presence_tbl.get_item(Key={"robotId": robot_id}).get("Item") or {}
    owner = rec.get("ownerUserId")
    groups = set(claims.get("groups") or [])
    is_admin = ("ADMINS" in groups) or ("admin" in groups)
    return is_admin or (owner is not None and claims.get("sub") == owner)

def _handle_takeover(claims: Claims, msg: InboundMessage) -> Dict[str, Any]:
    '''
    Send a robot a notification of takeover
    '''

    robot_id = msg.get("robotId")
    if not robot_id:
        return {"statusCode": 400, "body": "robotId required"}

    if not _is_owner_or_admin(robot_id, claims):
        return {"statusCode": 403, "body": "forbidden"}

    conn = _find_robot_conn(robot_id)
    if not conn:
        return {"statusCode": 404, "body": "robot offline"}

    _post_to(conn, {"type": "admin-takeover", "robotId": robot_id, "by": claims.get("sub", "")})
    return {"statusCode": 200}
    

# Lambda entry point

def handler(event: APIGatewayWSEvent, _context: Any) -> Dict[str, Any]:
    '''
    API gateway to lambda entry point for the Websocket traffic
    '''

    try:
        route = (event.get("requestContext") or {}).get("routeKey", "")
    except Exception:
        # If requestContext is missing or malformed, fail safely
        return {"statusCode": 400, "body": "bad request context"}

    # System routes handled first
    if route == "$connect":
        return _on_connect(event)
    if route == "$disconnect":
        return _on_disconnect(event)

    # Everything else: require a valid token and a JSON body
    qs = event.get("queryStringParameters") or {}
    claims = _decode_jwt_noverify(qs.get("token"))
    if not claims or not claims.get("sub"):
        return {"statusCode": 401, "body": "unauthorized"}

    # Parse body and dispatch by 'type'
    try:
        body_raw = event.get("body") or "{}"
        msg: InboundMessage = json.loads(body_raw)
    except Exception:
        return {"statusCode": 400, "body": "invalid JSON"}

    msg_type = (msg.get("type") or "").strip().lower()

    if msg_type == "register":
        return _handle_register(claims, event, msg)
    if msg_type in ("offer", "answer", "ice-candidate"):
        return _handle_signal(claims, msg)
    if msg_type == "takeover":
        return _handle_takeover(claims, msg)

    return {"statusCode": 400, "body": "unknown type"}