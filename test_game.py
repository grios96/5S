"""Integration tests for the Wine Australia rule adaptation."""
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
        server.ROUND_LENGTH_MS = 1300
        server.MISSING_ROUND_MS = 2500

    @staticmethod
    def get_until(ws, predicate, timeout=4):
        end = time.monotonic() + timeout
        while time.monotonic() < end:
            msg = ws.receive_json()
            if predicate(msg):
                return msg
        raise AssertionError('Expected websocket event was not received')

    def test_four_shifts_board_and_team_score(self):
        with TestClient(server.app) as client:
            created = client.post('/api/rooms').json()
            code, token = created['code'], created['token']
            qr = client.get('/api/qr', params={'url':f'https://example.org/join/{code}'})
            self.assertEqual(qr.status_code, 200)
            self.assertTrue(qr.content.startswith(b'\x89PNG'))
            self.assertEqual(client.get('/').status_code, 200)
            self.assertEqual(client.get(f'/join/{code}').status_code, 200)
            with client.websocket_connect(f'/ws/{code}') as host:
                host.send_json({'type':'host_auth','token':token})
                self.assertEqual(host.receive_json()['role'],'host')
                with client.websocket_connect(f'/ws/{code}') as p1:
                    p1.send_json({'type':'join','clientId':'aaaaaaaa-1111-1111-1111-111111111111','name':'Sam'})
                    self.assertEqual(p1.receive_json()['playersCount'],1)
                    with client.websocket_connect(f'/ws/{code}') as p2:
                        p2.send_json({'type':'join','clientId':'bbbbbbbb-2222-2222-2222-222222222222','name':'Jan'})
                        self.assertEqual(p2.receive_json()['playersCount'],2)
                        for r in range(4):
                            host.send_json({'type':'start'})
                            start = self.get_until(p1, lambda m:m.get('type')=='snapshot' and m['stage']=='countdown' and m['roundIndex']==r)
                            self.assertEqual(start['roundIndex'],r)
                            self.assertEqual(start['roundsTotal'],6)
                            self.assertEqual(start['targetMax'],49)
                            if r==0:
                                original=start['board']
                                self.assertEqual(len(original),90)
                                self.assertEqual(set(original),set(range(1,91)))
                            elif r == 1:
                                self.assertEqual(len(start['board']),90)
                                self.assertEqual(sum(num==0 for num in start['board']),41)
                                self.assertEqual([x for x in start['board'] if x], [x for x in original if x<=49])
                                self.assertTrue(all((x == 0) if original[i] > 49 else (x==original[i]) for i,x in enumerate(start['board'])))
                            elif r == 2:
                                serpentine=[]
                                current=1
                                for row in range(7):
                                    row_vals=list(range(current,current+7))
                                    if row % 2 == 1:
                                        row_vals.reverse()
                                    serpentine.extend(row_vals)
                                    current += 7
                                self.assertEqual(start['board'],serpentine)
                            else:
                                self.assertEqual(start['board'],list(range(1,50)))
                            self.get_until(p1,lambda m:m.get('type')=='snapshot' and m['stage']=='active' and m['roundIndex']==r)
                            # Only Sam scores 1 in each 20s shift; Jan remains at zero.
                            p1.send_json({'type':'tap','value':1})
                            tap=self.get_until(p1,lambda m:m.get('type')=='tap_result')
                            self.assertTrue(tap['correct'])
                            self.assertEqual(tap['correctCount'],1)
                            # 1 point per correct number, NO bonus for speed.
                            self.assertEqual(tap['roundPoints'],1)
                            # Wrong taps do not reduce score, after throttle window.
                            time.sleep(.1)
                            p1.send_json({'type':'tap','value':49})
                            wrong=self.get_until(p1,lambda m:m.get('type')=='tap_result')
                            self.assertFalse(wrong['correct'])
                            self.assertEqual(wrong['roundPoints'],1)
                            results=self.get_until(p1,lambda m:m.get('type')=='snapshot' and m['stage'] in ('results','final') and m['roundIndex']==r,timeout=5)
                            self.assertEqual(results['results'][0]['roundPoints'],1)
                            self.assertEqual(results['results'][0]['total'],r+1)
                            self.assertEqual(results['teamScore'],0)
                            self.assertEqual(results['teamScores'],[0]*(r+1))
                        self.assertEqual(results['stage'],'results')
                        # Next stage is a missing-number challenge.
                        self.assertEqual(server.rooms[code].round_index,3)

    def test_two_missing_number_challenges(self):
        with TestClient(server.app) as client:
            created = client.post('/api/rooms').json()
            code, token = created['code'], created['token']
            with client.websocket_connect(f'/ws/{code}') as host:
                host.send_json({'type': 'host_auth', 'token': token})
                host.receive_json()
                with client.websocket_connect(f'/ws/{code}') as p1:
                    p1.send_json({'type': 'join', 'clientId': 'aaaaaaaa-1111-1111-1111-111111111111', 'name': 'Alex'})
                    p1.receive_json()
                    with client.websocket_connect(f'/ws/{code}') as p2:
                        p2.send_json({'type': 'join', 'clientId': 'bbbbbbbb-2222-2222-2222-222222222222', 'name': 'Casey'})
                        p2.receive_json()
                        # Four classic 20-second shifts keep their own scores.
                        for idx in range(4):
                            host.send_json({'type': 'start'})
                            start = self.get_until(p1, lambda m: m.get('type') == 'snapshot' and m['stage']=='countdown' and m['roundIndex']==idx)
                            self.assertEqual(start['mode'],'sequence')
                            self.get_until(p1, lambda m: m.get('type')=='snapshot' and m['stage']=='active' and m['roundIndex']==idx)
                            host.send_json({'type': 'end'})
                            self.get_until(p1, lambda m: m.get('type')=='snapshot' and m['stage']=='results' and m['roundIndex']==idx)
                        room = server.rooms[code]
                        self.assertEqual(len(room.team_scores),4)
                        original = room.original_board[:]
                        for idx in (4, 5):
                            host.send_json({'type': 'start'})
                            start = self.get_until(p1, lambda m: m.get('type')=='snapshot' and m['stage']=='countdown' and m['roundIndex']==idx)
                            self.assertEqual(start['mode'],'missing')
                            self.assertEqual(start['roundsTotal'],6)
                            self.assertEqual(start['missingAnswers'],[])  # answer must stay hidden
                            missing = room.missing_answers[idx-4]
                            self.assertEqual(start['board'].count(0),1)
                            self.assertNotIn(missing,start['board'])
                            self.assertEqual(len(start['board']), 90 if idx==4 else 49)
                            self.assertEqual(start['board'],
                                [0 if n==missing else n for n in (original if idx==4 else range(1,50))])
                            self.get_until(p1,lambda m:m.get('type')=='snapshot' and m['stage']=='active' and m['roundIndex']==idx)
                            if idx==4:
                                # Wrong guess doesn't show missing answer or award points.
                                p1.send_json({'type':'guess','value':1})
                                wrong=self.get_until(p1,lambda m:m.get('type')=='guess_result')
                                self.assertFalse(wrong['correct'])
                                room.players['aaaaaaaa-1111-1111-1111-111111111111'].last_tap=0
                            p1.send_json({'type':'guess','value':missing})
                            correct=self.get_until(p1,lambda m:m.get('type')=='guess_result' and m.get('correct'))
                            self.assertGreaterEqual(correct['foundTimeMs'],0)
                            p2.send_json({'type':'guess','value':missing})
                            result=self.get_until(p1,lambda m:m.get('type')=='snapshot' and m['stage']==('results' if idx==4 else 'final') and m['roundIndex']==idx)
                            self.assertEqual(result['missingResults'][-1]['found'],2)
                            self.assertIsNotNone(result['missingResults'][-1]['medianMs'])
                            self.assertEqual(len(room.team_scores),4) # No points mixed with missing tests
                            if idx==5:
                                self.assertEqual(len(result['missingAnswers']),2)
                                self.assertEqual(result['missingAnswers'][0],result['missingAnswers'][1])
                                self.assertIsNotNone(result['me']['beforeTimeMs'])
                                self.assertIsNotNone(result['me']['afterTimeMs'])
                        self.assertEqual(room.round_index,5)
                        self.assertEqual(room.stage,'final')

    def test_reconnect_and_reset(self):
        with TestClient(server.app) as client:
            created=client.post('/api/rooms').json()
            code=created['code']
            with client.websocket_connect(f'/ws/{code}') as player:
                player.send_json({'type':'join','name':'Jan','clientId':'bbbbbbbb-2222-2222-2222-222222222222'})
                self.assertEqual(player.receive_json()['me']['name'],'Jan')
            with client.websocket_connect(f'/ws/{code}') as same:
                same.send_json({'type':'join','name':'Jan','clientId':'bbbbbbbb-2222-2222-2222-222222222222'})
                msg=same.receive_json()
                self.assertEqual(msg['playersCount'],1)

if __name__=='__main__':
    unittest.main(verbosity=2)
