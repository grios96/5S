"""Basic smoke tests: room, QR, two clients, scoring, 4 rounds and final leaderboard."""
import os
import sys
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from fastapi.testclient import TestClient
import server


class GameTests(unittest.TestCase):
    def setUp(self):
        server.rooms.clear()
        server.COUNTDOWN_MS = 200
        server.ROUND_LENGTH_MS = 1100

    @staticmethod
    def get_until(ws, predicate, timeout=3):
        # TestClient websocket receive_json blocks; server's round loop emits state updates.
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            msg = ws.receive_json()
            if predicate(msg):
                return msg
        raise AssertionError('Expected websocket event was not received')

    def test_room_to_final(self):
        with TestClient(server.app) as client:
            created = client.post('/api/rooms').json()
            code, token = created['code'], created['token']
            self.assertEqual(len(code), 6)
            self.assertEqual(client.get(f'/api/rooms/{code}').json()['stage'], 'lobby')
            qr = client.get('/api/qr', params={'url':f'https://example.org/join/{code}'})
            self.assertEqual(qr.status_code, 200)
            self.assertTrue(qr.content.startswith(b'\x89PNG'))
            with client.websocket_connect(f'/ws/{code}') as host:
                host.send_json({'type':'host_auth','token':token})
                self.assertEqual(host.receive_json()['role'], 'host')
                with client.websocket_connect(f'/ws/{code}') as player:
                    player.send_json({'type':'join','clientId':'aaaaaaaa-1111-1111-1111-111111111111','name':'Sam'})
                    self.assertEqual(player.receive_json()['playersCount'], 1)
                    self.get_until(host, lambda m:m.get('type')=='snapshot' and m['playersCount']==1)
                    for r in range(4):
                        host.send_json({'type':'start'})
                        start = self.get_until(player, lambda m:m.get('type')=='snapshot' and m['stage']=='countdown')
                        self.assertEqual(start['roundIndex'],r)
                        self.assertEqual(len(start['board']),49 if r==0 else 30)
                        self.get_until(player,lambda m:m.get('type')=='snapshot' and m['stage']=='active')
                        player.send_json({'type':'tap','value':1})
                        tap=self.get_until(player,lambda m:m.get('type')=='tap_result')
                        self.assertTrue(tap['correct'])
                        self.assertEqual(tap['correctCount'],1)
                        results=self.get_until(player,lambda m:m.get('type')=='snapshot' and m['stage'] in ('results','final'),timeout=5)
                        self.assertEqual(results['results'][0]['roundPoints'],10)
                        self.assertEqual(results['results'][0]['total'],10*(r+1))
                    self.assertEqual(results['stage'],'final')

    def test_reconnect_keeps_score(self):
        with TestClient(server.app) as client:
            code=client.post('/api/rooms').json()['code']
            with client.websocket_connect(f'/ws/{code}') as player:
                player.send_json({'type':'join','name':'Jan','clientId':'bbbbbbbb-2222-2222-2222-222222222222'})
                self.assertEqual(player.receive_json()['me']['name'],'Jan')
            with client.websocket_connect(f'/ws/{code}') as same:
                same.send_json({'type':'join','name':'Jan','clientId':'bbbbbbbb-2222-2222-2222-222222222222'})
                msg=same.receive_json()
                self.assertEqual(msg['playersCount'],1)


if __name__=='__main__':
    unittest.main(verbosity=2)
