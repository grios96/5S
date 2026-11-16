(function(){
  const code=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()).toUpperCase();
  const playerIdKey='5sPlayer:'+code;
  let clientId=localStorage.getItem(playerIdKey);
  if(!clientId){clientId=(crypto.randomUUID?crypto.randomUUID():'p'+Date.now()+Math.random().toString(16).slice(2));localStorage.setItem(playerIdKey,clientId);}
  let myName=localStorage.getItem('5sName')||'',joined=false,state=null,serverOffset=0,boardVersion='',localExpected=1,feedbackTimeout=null;
  const sock=createSocket(code,handle, ws=>{
    byId('playerConnection').textContent='● Connected';
    byId('playerConnection').classList.remove('disconnected');
    if(joined&&myName)ws.send(JSON.stringify({type:'join',name:myName,clientId}));
  },()=>{
    byId('playerConnection').textContent='● Reconnecting…';
    byId('playerConnection').classList.add('disconnected');
  });
  byId('nameInput').value=myName;
  byId('joinForm').addEventListener('submit', e=>{
    e.preventDefault();
    const name=byId('nameInput').value.trim();
    if(!name||name.length>22||! /^[\w -]+$/u.test(name)){
      byId('joinMessage').textContent='Please use a short name with letters, numbers, spaces, _ or -.';return;
    }
    joined=true;myName=name;localStorage.setItem('5sName',name);
    sock.send({type:'join',name,clientId});
    byId('joinMessage').textContent='Joining room…';
  });
  // A returning player reconnects automatically and keeps the previous score.
  if(myName){joined=true;}
  function handle(msg){
    if(msg.type==='error'){
      byId('joinMessage').textContent=msg.message;
      if(msg.message.includes('Room not found')){showScreen('errorScreen');byId('errorMessage').textContent=msg.message;}
      return;
    }
    if(msg.type==='tap_result'){applyTapResult(msg);return;}
    if(msg.type!=='snapshot')return;
    state=msg;serverOffset=msg.serverNow-Date.now();
    if(!msg.me)return;
    joined=true;myName=msg.me.name;
    localExpected=msg.me.nextExpected;
    render();
  }
  function showScreen(id){
    for(const section of document.querySelectorAll('main .screen'))section.hidden=section.id!==id;
  }
  function render(){
    if(!state||!state.me)return;
    const s=state,me=s.me;
    byId('welcomeTitle').textContent=`LET'S GO, ${me.name.toUpperCase()}!`;
    if(s.stage==='lobby'){
      showScreen('lobbyScreen');byId('waitingTitle').textContent='Waiting for the host';byId('waitingDesc').textContent='The next round will start on the big screen.';
    } else if(['countdown','active'].includes(s.stage) && me.eligible){
      showScreen('gameScreen');
      byId('roundTitle').textContent=`ROUND ${String(s.roundIndex+1).padStart(2,'0')} / 03`;
      byId('roundDesc').textContent=s.roundName;
      byId('boardInstructions').innerHTML=s.roundIndex===0?'🔎 Find <b>1 → 30</b> among 49 numbers!':s.roundIndex===1?'🧹 Only what you need: find <b>1 → 30</b>!':'📍 Everything in place: tap <b>1 → 30</b>!';
      ensureBoard();updateProgress(me.nextExpected,me.roundPoints,me.correct,me.completed);
      byId('gameOverlay').hidden=s.stage!=='countdown';
      if(me.completed){byId('gameOverlay').hidden=false;byId('countdownNumber').textContent='✓';document.querySelector('.countdown-label').textContent='FINISHED!';document.querySelector('.countdown-note').textContent='Wait for the round to end.';}
      else {document.querySelector('.countdown-label').textContent='GET READY';document.querySelector('.countdown-note').textContent='All players start together!';}
    } else if(['results','final'].includes(s.stage)){
      showScreen('resultsScreen');renderResults();
    } else {
      showScreen('lobbyScreen');byId('waitingTitle').textContent='Round in progress';byId('waitingDesc').textContent='You joined mid-round. You can play the next one!';
    }
    tickTimer();
  }
  function ensureBoard(){
    const s=state, version=s.roundIndex+':'+s.board.join(',');
    if(version===boardVersion)return;
    boardVersion=version;
    const board=byId('gameBoard');
    board.className='number-board '+(s.roundIndex===0?'cluttered':s.roundIndex===1?'sorted':'ordered');
    const fragment=document.createDocumentFragment();
    for(const num of s.board){
      const el=document.createElement('button');
      el.type='button';el.className='number-tile';el.textContent=num;el.dataset.value=String(num);
      el.setAttribute('aria-label','Number '+num);
      if(s.roundIndex===0){el.classList.add('clutter-tone-'+(num%5));}
      el.addEventListener('click',()=>{
        if(!state||state.stage!=='active'||!state.me?.eligible||localExpected>30)return;
        sock.send({type:'tap',value:num});
      });
      fragment.appendChild(el);
    }
    board.replaceChildren(fragment);
  }
  function updateProgress(next,points,correct,completed){
    localExpected=next;
    byId('nextNumber').textContent=completed?'✓':String(next);
    byId('roundPoints').textContent=points;
    byId('correctCount').textContent=correct;
    byId('progressFill').style.width=Math.min(100,correct/30*100)+'%';
    for(const tile of byId('gameBoard').children){
      const val=Number(tile.dataset.value);
      tile.classList.toggle('done',val<next&&val<=30);
      tile.disabled=completed||val<next;
    }
  }
  function applyTapResult(msg){
    if(!state||state.stage!=='active')return;
    updateProgress(msg.nextExpected,msg.roundPoints,msg.correctCount,msg.completed);
    const feedback=byId('tapFeedback');
    if(feedbackTimeout)clearTimeout(feedbackTimeout);
    feedback.textContent=msg.correct?'+10 XP · Nice!':'−2 XP · Keep going!';
    feedback.className='tap-feedback '+(msg.correct?'feedback-good':'feedback-bad');
    feedbackTimeout=setTimeout(()=>{feedback.textContent='Tap the next number!';feedback.className='tap-feedback';},600);
    if(msg.completed){
      byId('gameOverlay').hidden=false;
      byId('countdownNumber').textContent='✓';
      document.querySelector('.countdown-label').textContent='ALL 30 FOUND!';
      document.querySelector('.countdown-note').textContent='Bonus XP added for time left. Great job!';
    }
  }
  function renderResults(){
    const s=state, me=s.me;
    const myRow=s.results.find(x=>x.id===me.id);
    const rank=myRow?.rank||'—';
    byId('resultsMedal').textContent=typeof rank==='number'?medal(rank):'⭐';
    byId('resultEyebrow').textContent=s.stage==='final'?'GAME COMPLETE':'ROUND '+(s.roundIndex+1)+' COMPLETE';
    byId('resultHeadline').textContent=typeof rank==='number'&&rank<=3?'PODIUM FINISH!':'NICE WORK!';
    byId('myRank').textContent='#'+rank;
    byId('myRoundPoints').textContent=String(myRow?.roundPoints||0);
    byId('myTotalPoints').textContent=String(myRow?.total??me.points);
    byId('nextPrompt').textContent=s.stage==='final'?'Your team completed the challenge!':'Waiting for next round';
    byId('miniLeaderboard').innerHTML=s.results.slice(0,5).map(p=>`<div class="mini-rank-row"><span>${medal(p.rank)} ${escapeHtml(p.name)}</span><b>${p.total} XP</b></div>`).join('')||'<p>No results yet.</p>';
  }
  function tickTimer(){
    if(!state)return;
    const n=Date.now()+serverOffset;
    if(state.stage==='countdown'){
      byId('playerTimer').textContent='00:30';
      if(state.me?.eligible&&!state.me?.completed)byId('countdownNumber').textContent=Math.max(1,Math.ceil((state.startAt-n)/1000));
    } else if(state.stage==='active'){
      const remaining=state.endAt-n;
      byId('playerTimer').textContent=timeText(remaining);
      byId('playerTimer').classList.toggle('timer-urgent',remaining<10000);
    }
  }
  setInterval(tickTimer,100);
})();
