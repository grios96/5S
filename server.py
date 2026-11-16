"""5S Speedrun: realtime interactive workshop game, no external services required.
Start: uvicorn server:app --host 0.0.0.0 --port 8000
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
import random
import re
import secrets
import time
from statistics import median
from typing import Any

import qrcode
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).parent
app = FastAPI(title="5S Speedrun", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=ROOT / "public"), name="static")

ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
ROUND_LENGTH_MS = 20_000
MISSING_ROUND_MS = 120_000  # 6 "shifts" at 20 seconds; host may end earlier.
COUNTDOWN_MS = 4_000
MAX_PLAYERS = 180
ROUND_NAMES = ["BEFORE 5S", "SORT", "STRAIGHTEN + SWEEP", "STANDARDIZE",
               "MISSING NUMBER · BEFORE 5S", "MISSING NUMBER · AFTER 5S"]
TARGET_MAX = 49
DISTRACTOR_MAX = 90


def now_ms() -> int:
    return int(time.time() * 1000)


@dataclass
class Player:
    client_id: str
    name: str
    points: int = 0
    round_correct: int = 0
    round_misses: int = 0
    next_expected: int = 1
    completed_at: int | None = None
    last_tap: int = 0
    eligible: bool = True
    history: list[dict[str, int]] = field(default_factory=list)
    missing_times: dict[int, int] = field(default_factory=dict)

    def round_points(self) -> int:
        # The source game scores each crossed-off number, without XP bonuses/penalties.
        return self.round_correct


@dataclass
class Room:
    code: str
    host_token: str
    created_at: int
    players: dict[str, Player] = field(default_factory=dict)
    connections: dict[WebSocket, tuple[str, str | None]] = field(default_factory=dict)
    stage: str = "lobby"
    round_index: int = -1
    board: list[int] = field(default_factory=list)
    original_board: list[int] = field(default_factory=list)
    team_scores: list[int] = field(default_factory=list)
    missing_answers: list[int] = field(default_factory=list)
    missing_results: list[dict[str, Any]] = field(default_factory=list)
    start_at: int = 0
    end_at: int = 0
    pre_ranks: dict[str, int] = field(default_factory=dict)
    results: list[dict[str, Any]] = field(default_factory=list)
    round_task: asyncio.Task | None = None

    def ranked(self, with_round: bool = True) -> list[dict[str, Any]]:
        missing = self.round_index >= 4 and self.stage in ("countdown", "active", "results", "final")
        data = []
        for player in self.players.values():
            current = player.round_points() if (with_round and self.stage in ("countdown", "active") and not missing) else 0
            found_ms = player.missing_times.get(self.round_index) if missing else None
            data.append({
                "id": player.client_id,
                "name": player.name,
                "total": player.points + current,
                "roundPoints": current,
                "correct": player.round_correct,
                "misses": player.round_misses,
                "completed": player.completed_at is not None,
                "missingTimeMs": found_ms,
                "beforeTimeMs": player.missing_times.get(4),
                "afterTimeMs": player.missing_times.get(5),
                "eligible": player.eligible,
                "history": [h["points"] for h in player.history],
            })
        if missing:
            data.sort(key=lambda x: (x["missingTimeMs"] is None, x["missingTimeMs"] if x["missingTimeMs"] is not None else 99999999, x["name"].casefold()))
        else:
            data.sort(key=lambda x: (-x["total"], -x["correct"] if with_round else 0, x["name"].casefold()))
        for idx, item in enumerate(data):
            item["rank"] = idx + 1
        return data

    def snapshot(self, role: str, player_id: str | None) -> dict[str, Any]:
        active_players = [p for p in self.players.values() if p.eligible]
        if self.stage in ("countdown", "active"):
            team_score = min((p.round_correct for p in active_players), default=None)
        elif self.stage in ("results", "final") and self.team_scores:
            team_score = self.team_scores[-1]
        else:
            team_score = None
        public = {
            "type": "snapshot", "serverNow": now_ms(), "code": self.code,
            "stage": self.stage, "roundIndex": self.round_index,
            "roundName": ROUND_NAMES[self.round_index] if self.round_index >= 0 else None,
            "roundsTotal": len(ROUND_NAMES), "board": self.board,
            "mode": "missing" if self.round_index >= 4 else "sequence",
            "targetMax": TARGET_MAX, "teamScore": team_score,
            "teamScores": self.team_scores, "missingResults": self.missing_results,
            "missingAnswers": self.missing_answers if self.stage == "final" else [],
            "startAt": self.start_at, "endAt": self.end_at,
            "lengthMs": (MISSING_ROUND_MS if self.round_index >= 4 else ROUND_LENGTH_MS),
            "playersCount": len(self.players),
            "leaderboard": self.ranked(), "results": self.results,
        }
        if role == "host":
            public["role"] = "host"
        else:
            p = self.players.get(player_id or "")
            public["role"] = "player"
            if p:
                public["me"] = {
                    "id": p.client_id, "name": p.name, "points": p.points,
                    "correct": p.round_correct, "misses": p.round_misses,
                    "nextExpected": p.next_expected, "roundPoints": p.round_points(),
                    "completed": p.completed_at is not None, "eligible": p.eligible,
                    "history": [h["points"] for h in p.history],
                    "missingTimeMs": p.missing_times.get(self.round_index),
                    "beforeTimeMs": p.missing_times.get(4),
                    "afterTimeMs": p.missing_times.get(5),
                }
        return public


rooms: dict[str, Room] = {}


def new_room() -> Room:
    for _ in range(10):
        code = "".join(secrets.choice(ALPHABET) for _ in range(6))
        if code not in rooms:
            room = Room(code=code, host_token=secrets.token_urlsafe(24), created_at=now_ms())
            rooms[code] = room
            return room
    raise RuntimeError("Could not allocate a room")


@app.get("/")
async def homepage():
    return FileResponse(ROOT / "public" / "index.html")


@app.get("/host/{code}")
async def host_page(code: str):
    return FileResponse(ROOT / "public" / "host.html")


@app.get("/join/{code}")
async def join_page(code: str):
    return FileResponse(ROOT / "public" / "play.html")


@app.get("/health")
async def health():
    return {"ok": True, "rooms": len(rooms)}


@app.post("/api/rooms")
async def create_room(request: Request):
    room = new_room()
    return {"code": room.code, "token": room.host_token}


@app.get("/api/rooms/{code}")
async def room_info(code: str):
    room = rooms.get(code.upper())
    if not room:
        raise HTTPException(status_code=404, detail="Room not found or expired")
    return {"code": room.code, "playersCount": len(room.players), "stage": room.stage}


@app.get("/api/qr")
async def qr_image(url: str):
    # Generated locally, so the QR also works without internet when hosted on a LAN.
    if len(url) > 350 or not re.match(r"^https?://[^\s]+$", url):
        raise HTTPException(status_code=400, detail="Invalid URL")
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, box_size=9, border=3)
    qr.add_data(url)
    qr.make(fit=True)
    buffer = BytesIO()
    qr.make_image(fill_color="#12233A", back_color="#FFFFFF").save(buffer, format="PNG")
    buffer.seek(0)
    return StreamingResponse(buffer, media_type="image/png", headers={"Cache-Control": "no-store"})


async def send(ws: WebSocket, payload: dict[str, Any]) -> bool:
    try:
        await ws.send_json(payload)
        return True
    except (OSError, RuntimeError, WebSocketDisconnect):
        return False


async def broadcast(room: Room, hosts_only: bool = False):
    for ws, (role, player_id) in list(room.connections.items()):
        if hosts_only and role != "host":
            continue
        if not await send(ws, room.snapshot(role, player_id)):
            room.connections.pop(ws, None)


async def begin_round(room: Room):
    if room.stage not in ("lobby", "results") or room.round_index >= len(ROUND_NAMES) - 1:
        return
    if room.round_task and not room.round_task.done():
        room.round_task.cancel()
    rank_list = room.ranked(with_round=False)
    room.pre_ranks = {p["id"]: p["rank"] for p in rank_list} if room.round_index >= 0 else {}
    room.round_index += 1
    room.results = []
    room.stage = "countdown"
    room.start_at = now_ms() + COUNTDOWN_MS
    room.end_at = room.start_at + (MISSING_ROUND_MS if room.round_index >= 4 else ROUND_LENGTH_MS)
    if room.round_index == 0:
        # Original 90-position paper layout. Retained in the next two rounds
        # so participants experience the same workplace before/after sorting.
        room.original_board = list(range(1, DISTRACTOR_MAX + 1))
        random.SystemRandom().shuffle(room.original_board)
        room.board = room.original_board.copy()
    elif room.round_index == 1:
        # Zero is an empty space where an unnecessary number was removed.
        # This leaves the 1-49 target numbers in their ORIGINAL locations.
        room.board = [n if n <= TARGET_MAX else 0 for n in room.original_board]
    elif room.round_index == 2:
        # Straighten + Sweep: each number gets its own box, and consecutive
        # numbers sit in neighboring boxes along a snake-like path.
        serpentine = []
        current = 1
        for row in range(7):
            row_vals = list(range(current, current + 7))
            if row % 2 == 1:
                row_vals.reverse()
            serpentine.extend(row_vals)
            current += 7
        room.board = serpentine
    elif room.round_index == 3:
        # Paper's standardized grid: left-to-right, top-to-bottom.
        room.board = list(range(1, TARGET_MAX + 1))
    elif room.round_index == 4:
        # Use the SAME missing number before and after 5S so the comparison is direct.
        missing_number = secrets.choice(list(range(11, 45)))
        room.missing_answers = [missing_number, missing_number]
        room.board = [0 if n == room.missing_answers[0] else n for n in room.original_board]
    else:
        # Same missing number, but now after standardization it is much easier to see
        # exactly which position is empty in the 7×7 grid.
        room.board = [0 if n == room.missing_answers[1] else n for n in range(1, TARGET_MAX + 1)]
    for p in room.players.values():
        p.round_correct, p.round_misses, p.next_expected = 0, 0, 1
        p.completed_at, p.last_tap, p.eligible = None, 0, True
    await broadcast(room)
    room.round_task = asyncio.create_task(round_clock(room, room.round_index))


async def round_clock(room: Room, round_number: int):
    try:
        await asyncio.sleep(max(0, (room.start_at - now_ms()) / 1000))
        if room.round_index != round_number or room.stage != "countdown":
            return
        room.stage = "active"
        await broadcast(room)
        while room.round_index == round_number and room.stage == "active" and now_ms() < room.end_at:
            await asyncio.sleep(0.5)
            await broadcast(room, hosts_only=True)
        if room.round_index == round_number and room.stage == "active":
            await finish_round(room)
    except asyncio.CancelledError:
        return


async def finish_round(room: Room):
    if room.stage not in ("countdown", "active"):
        return
    if room.round_index >= 4:
        # A separate visual-management challenge: rank by quickest correct find,
        # not by the first four shifts' scores.
        ranked = []
        for p in room.players.values():
            if not p.eligible:
                continue
            found_ms = p.missing_times.get(room.round_index)
            ranked.append({"id": p.client_id, "name": p.name, "total": p.points,
                           "roundPoints": 0, "missingTimeMs": found_ms,
                           "beforeTimeMs": p.missing_times.get(4),
                           "afterTimeMs": p.missing_times.get(5),
                           "found": found_ms is not None, "misses": p.round_misses})
        ranked.sort(key=lambda x: (x["missingTimeMs"] is None,
                                   x["missingTimeMs"] if x["missingTimeMs"] is not None else 99999999,
                                   x["name"].casefold()))
        for rank, player_result in enumerate(ranked, 1):
            player_result["rank"] = rank
        times = [p["missingTimeMs"] for p in ranked if p["missingTimeMs"] is not None]
        room.missing_results.append({"roundIndex": room.round_index,
                                     "found": len(times), "players": len(ranked),
                                     "medianMs": round(median(times)) if times else None,
                                     "slowestMs": max(times) if times else None})
        room.results = ranked
    else:
        ranked = []
        for p in room.players.values():
            if not p.eligible:
                continue
            gained = p.round_points()
            p.points += gained
            p.history.append({"points": gained, "correct": p.round_correct, "misses": p.round_misses})
            ranked.append({"id": p.client_id, "name": p.name, "roundPoints": gained,
                           "correct": p.round_correct, "misses": p.round_misses,
                           "completed": p.completed_at is not None, "total": p.points})
        ranked.sort(key=lambda x: (-x["total"], -x["roundPoints"], x["name"].casefold()))
        for rank, player_result in enumerate(ranked, start=1):
            player_result["rank"] = rank
            prev = room.pre_ranks.get(player_result["id"])
            player_result["delta"] = prev - rank if prev is not None else None
        room.results = ranked
        # Team score = lowest individual numbers crossed off, as in the PDF.
        room.team_scores.append(min((p["roundPoints"] for p in ranked), default=0))
    room.stage = "final" if room.round_index == len(ROUND_NAMES) - 1 else "results"
    if room.round_index >= 4:
        room.end_at = max(room.start_at, now_ms())  # Actual elapsed challenge duration.
    if room.round_task is not None and room.round_task is not asyncio.current_task():
        room.round_task.cancel()
    await broadcast(room)


async def reset_room(room: Room):
    if room.round_task and not room.round_task.done():
        room.round_task.cancel()
    room.stage, room.round_index, room.board = "lobby", -1, []
    room.original_board = []
    room.team_scores = []
    room.missing_answers = []
    room.missing_results = []
    room.start_at = room.end_at = 0
    room.pre_ranks, room.results = {}, []
    for p in room.players.values():
        p.points = p.round_correct = p.round_misses = p.last_tap = 0
        p.next_expected = 1
        p.completed_at = None
        p.eligible = True
        p.history = []
        p.missing_times = {}
    await broadcast(room)


async def handle_tap(room: Room, ws: WebSocket, player_id: str, value: Any):
    p = room.players.get(player_id)
    if not p or not p.eligible or room.stage != "active" or p.completed_at is not None or room.round_index >= 4:
        return
    stamp = now_ms()
    if stamp < room.start_at or stamp > room.end_at:
        return
    if stamp - p.last_tap < 80:
        return
    p.last_tap = stamp
    if type(value) is not int or not 1 <= value <= DISTRACTOR_MAX or value not in room.board:
        return
    correct = value == p.next_expected
    if correct:
        p.round_correct += 1
        p.next_expected += 1
        if p.next_expected == TARGET_MAX + 1:
            p.completed_at = stamp
    else:
        p.round_misses += 1
    await send(ws, {"type": "tap_result", "correct": correct, "value": value,
                    "nextExpected": p.next_expected, "roundPoints": p.round_points(),
                    "correctCount": p.round_correct, "misses": p.round_misses,
                    "completed": p.completed_at is not None})


async def handle_guess(room: Room, ws: WebSocket, player_id: str, value: Any):
    """Find one missing number; time-to-discovery is separate from shift XP."""
    p = room.players.get(player_id)
    if (not p or room.round_index not in (4, 5) or room.stage != "active"
            or not p.eligible or p.completed_at is not None):
        return
    stamp = now_ms()
    if stamp < room.start_at or stamp > room.end_at:
        return
    # Prevent blind rapid-fire guesses (one guess per ~2.5 seconds).
    if stamp - p.last_tap < 2500:
        await send(ws, {"type": "guess_result", "correct": False, "cooldown": True})
        return
    if type(value) is not int or not 1 <= value <= TARGET_MAX:
        return
    p.last_tap = stamp
    correct = value == room.missing_answers[room.round_index - 4]
    if correct:
        p.completed_at = stamp
        p.round_correct = 1
        p.missing_times[room.round_index] = stamp - room.start_at
    else:
        p.round_misses += 1
    await send(ws, {"type": "guess_result", "correct": correct,
                    "foundTimeMs": p.missing_times.get(room.round_index),
                    "attempts": p.round_misses + (1 if correct else 0)})
    await broadcast(room)
    if correct and all(x.completed_at is not None for x in room.players.values() if x.eligible):
        await finish_round(room)


@app.websocket("/ws/{code}")
async def websocket_endpoint(ws: WebSocket, code: str):
    await ws.accept()
    room = rooms.get(code.upper())
    if room is None:
        await send(ws, {"type": "error", "message": "Room not found. Ask the host for a new code."})
        await ws.close(code=1008)
        return
    role, player_id = None, None
    try:
        while True:
            message = await ws.receive_json()
            msg_type = message.get("type")
            if role is None:
                if msg_type == "host_auth":
                    if not secrets.compare_digest(str(message.get("token", "")), room.host_token):
                        await send(ws, {"type": "error", "message": "Invalid host access."})
                        await ws.close(code=1008)
                        return
                    role = "host"
                    room.connections[ws] = (role, None)
                    await send(ws, room.snapshot(role, None))
                elif msg_type == "join":
                    name = str(message.get("name", "")).strip()
                    client_id = str(message.get("clientId", ""))
                    if not name or len(name) > 22 or not re.fullmatch(r"[\w -]{1,22}", name, re.UNICODE):
                        await send(ws, {"type": "error", "message": "Choose a name (up to 22 letters/numbers)."})
                        continue
                    if not re.fullmatch(r"[A-Za-z0-9-]{8,80}", client_id):
                        await send(ws, {"type": "error", "message": "Invalid device ID. Please reload."})
                        continue
                    if client_id not in room.players and len(room.players) >= MAX_PLAYERS:
                        await send(ws, {"type": "error", "message": "This room is full."})
                        continue
                    if client_id not in room.players:
                        eligible = room.stage in ("lobby", "results")
                        room.players[client_id] = Player(client_id=client_id, name=name, eligible=eligible)
                    else:
                        room.players[client_id].name = name
                    role, player_id = "player", client_id
                    for old_ws, (_, old_id) in list(room.connections.items()):
                        if old_id == client_id:
                            room.connections.pop(old_ws, None)
                    room.connections[ws] = (role, player_id)
                    await broadcast(room)
                else:
                    await send(ws, {"type": "error", "message": "Please join first."})
                continue

            if role == "host":
                if msg_type == "start":
                    await begin_round(room)
                elif msg_type == "end":
                    await finish_round(room)
                elif msg_type == "reset":
                    await reset_room(room)
            elif role == "player" and msg_type == "tap":
                await handle_tap(room, ws, player_id or "", message.get("value"))
            elif role == "player" and msg_type == "guess":
                await handle_guess(room, ws, player_id or "", message.get("value"))
    except (WebSocketDisconnect, RuntimeError, ValueError):
        pass
    finally:
        room.connections.pop(ws, None)
        # Keep players in the room on disconnect so refresh/reconnect preserves scores.
        await broadcast(room, hosts_only=True)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
