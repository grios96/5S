(function(){
  const code=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()).toUpperCase();
  const playerIdKey='5sPlayer:'+code;
  let clientId=localStorage.getItem(playerIdKey);
  if(!clientId){clientId=(crypto.randomUUID?crypto.randomUUID():'p'+Date.now()+Math.random().toString(16).slice(2));localStorage.setItem(playerIdKey,clientId);}
  let myName=localStorage.getItem('5sName')||'',joined=false,state=null,serverOffset=0,boardVersion='',localExpected=1,feedbackTimeout=null;
  const TOTAL_ROUNDS=6;
  const FONT_CHOICES=[
    '"Trebuchet MS","Arial Black",Arial,sans-serif',
    'Verdana,Geneva,sans-serif',
    '"Tahoma",Geneva,sans-serif',
    '"Courier New",monospace',
    '"Georgia",serif',
    '"Comic Sans MS","Trebuchet MS",cursive'
  ];
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
  if(myName){joined=true;}
  function handle(msg){
    if(msg.type==='error'){
      byId('joinMessage').textContent=msg.message;
      if(msg.message.includes('Room not found')){showScreen('errorScreen');byId('errorMessage').textContent=msg.message;}
      return;
    }
    if(msg.type==='tap_result'){applyTapResult(msg);return;}
    if(msg.type==='guess_result'){applyGuessResult(msg);return;}
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
  function roundInstruction(idx){
    if(idx===0)return '🔎 Cross off <b>1 → 49</b> in a clutter of 90 numbers.';
    if(idx===1)return '🧹 Numbers 50–90 are gone. Cross off <b>1 → 49</b>.';
    if(idx===2)return '📍 3×3 zones and uniform color. Cross off <b>1 → 49</b>.';
    if(idx===3)return '📋 Standardized grid. Cross off <b>1 → 49</b> in order.';
    if(idx===4)return '🔍 Original workplace. One number from <b>1–49</b> is missing — which?';
    return '✨ Organized workplace. A different number from <b>1–49</b> is missing.';
  }
  function render(){
    if(!state||!state.me)return;
    const s=state,me=s.me;
    byId('welcomeTitle').textContent=`LET'S GO, ${me.name.toUpperCase()}!`;
    if(s.stage==='lobby'){
      showScreen('lobbyScreen');byId('waitingTitle').textContent='Waiting for the host';byId('waitingDesc').textContent='The next round will start on the big screen.';
    } else if(['countdown','active'].includes(s.stage) && me.eligible){
      showScreen('gameScreen');
      byId('roundTitle').textContent=`ROUND ${String(s.roundIndex+1).padStart(2,'0')} / ${String(TOTAL_ROUNDS).padStart(2,'0')}`;
      byId('roundDesc').textContent=s.roundName;
      byId('boardInstructions').innerHTML=roundInstruction(s.roundIndex);
      const missing=s.mode==='missing';
      byId('progressCard').hidden=missing;
      byId('missingChallenge').hidden=!missing;
      byId('guessBtn').disabled=!missing||s.stage!=='active'||me.completed;
      byId('guessInput').disabled=!missing||s.stage!=='active'||me.completed;
      byId('guessInput').max=String(s.targetMax);
      byId('gameOverlay').hidden=s.stage==='active';
      document.querySelector('.countdown-label').textContent='GET READY';
      document.querySelector('.countdown-note').textContent='All players start together!';
      ensureBoard();
      if(s.mode==='sequence') updateProgress(me.nextExpected,me.roundPoints,me.correct,me.completed);
      else if(me.completed){
        byId('guessFeedback').textContent='✓ Found! Your time: '+secondsText(me.missingTimeMs);
        byId('guessFeedback').className='guess-feedback found';
      }
    } else if(['results','final'].includes(s.stage)){
      showScreen('resultsScreen');renderResults();
    } else {
      showScreen('lobbyScreen');byId('waitingTitle').textContent='Round in progress';byId('waitingDesc').textContent='You joined mid-round. You can play the next one!';
    }
    tickTimer();
  }
  // Same number gets the SAME print styling across shifts 1-3.
  // Each player sees the same board; only the conditions change by shift.
  function styleSpecFor(num, idx){
    const visualIdx=idx===4?0:idx===5?3:idx;
    const seed=(num * 7919 + 1033) >>> 0;
    const pick=(k,mod)=>((seed * (k*17+11)) >>> 0)%mod;
    return {
      rotate:visualIdx===3?0:pick(1,321)-160,
      size:visualIdx===3?76+pick(2,64):70+pick(3,69),
      fontFamily:FONT_CHOICES[pick(4,FONT_CHOICES.length)],
      weight:pick(5,4)===0?'900':'700',
      color:visualIdx<2?['#232323','#b94b22','#2d6cba','#4b8f57','#7843b1'][pick(6,5)]:'#181818'
    };
  }
  function ensureBoard(){
    const s=state,version=s.roundIndex+':'+s.board.join(',');
    if(version===boardVersion)return;
    boardVersion=version;
    if(s.mode==='missing'){
      byId('guessForm').reset();
      byId('guessFeedback').textContent='Clock starts when the board appears. Wrong guesses have a short cooldown.';
      byId('guessFeedback').className='guess-feedback';
    }
    const board=byId('gameBoard');
    board.className='number-board '+(s.roundIndex===0||s.roundIndex===4?'paper-mess':s.roundIndex===1?'paper-sort':s.roundIndex===2?'paper-rack':'paper-standard')+(s.mode==='missing'?' missing-mode':'');
    const fragment=document.createDocumentFragment();
    for(const num of s.board){
      if(num===0){
        const gap=document.createElement('div');gap.className='number-gap';gap.setAttribute('aria-hidden','true');fragment.appendChild(gap);continue;
      }
      const el=document.createElement('button');
      el.type='button';el.className='number-tile';el.dataset.value=String(num);
      el.setAttribute('aria-label','Number '+num);
      const ink=document.createElement('span');ink.className='number-ink';ink.textContent=String(num);
      const spec=styleSpecFor(num,s.roundIndex);
      ink.style.setProperty('--ink-rotate',spec.rotate+'deg');
      ink.style.setProperty('--ink-scale',String(spec.size/100));
      ink.style.fontFamily=spec.fontFamily;
      ink.style.fontWeight=spec.weight;
      ink.style.color=spec.color;
      el.appendChild(ink);
      if(s.mode==='missing'){
        el.disabled=true;
        el.setAttribute('aria-label','Number '+num+' (visual only)');
      }else{
        el.addEventListener('click',()=>{
          if(!state||state.stage!=='active'||!state.me?.eligible||localExpected>49)return;
          sock.send({type:'tap',value:num});
        });
      }
      fragment.appendChild(el);
    }
    board.replaceChildren(fragment);
  }
  function secondsText(ms){
    return ms===null||ms===undefined?'Not found':(ms/1000).toFixed(1)+'s';
  }
  byId('guessForm').addEventListener('submit',e=>{
    e.preventDefault();
    if(!state||state.mode!=='missing'||state.stage!=='active'||!state.me?.eligible||state.me?.completed)return;
    const guess=Number(byId('guessInput').value);
    if(!Number.isInteger(guess)||guess<1||guess>49)return;
    sock.send({type:'guess',value:guess});
    byId('guessFeedback').textContent='Checking answer…';
    byId('guessFeedback').className='guess-feedback';
  });
  function applyGuessResult(msg){
    if(!state||state.mode!=='missing')return;
    if(msg.correct){
      byId('guessFeedback').textContent='✓ Correct! Found in '+secondsText(msg.foundTimeMs);
      byId('guessFeedback').className='guess-feedback found';
      byId('guessBtn').disabled=true;
      byId('guessInput').disabled=true;
    }else{
      byId('guessFeedback').textContent=msg.cooldown?'Wait 2 seconds before your next guess.':'Not quite. Look carefully; try again after a moment.';
      byId('guessFeedback').className='guess-feedback retry';
      byId('guessInput').select();
    }
  }
  function updateProgress(next,points,correct,completed){
    localExpected=next;
    byId('nextNumber').textContent=completed?'✓':String(next);
    byId('roundPoints').textContent=points;
    byId('correctCount').textContent=correct;
    byId('progressFill').style.width=Math.min(100,correct/49*100)+'%';
    for(const tile of byId('gameBoard').children){
      const val=Number(tile.dataset.value);
      tile.classList.toggle('done',val<next&&val>=1&&val<=49);
      tile.disabled=completed||val<next;
    }
  }
  function applyTapResult(msg){
    if(!state||state.stage!=='active')return;
    updateProgress(msg.nextExpected,msg.roundPoints,msg.correctCount,msg.completed);
    const feedback=byId('tapFeedback');
    if(feedbackTimeout)clearTimeout(feedbackTimeout);
    feedback.textContent=msg.correct?'✓ Crossed off '+msg.value:'Not in sequence. Find '+msg.nextExpected+' first.';
    feedback.className='tap-feedback '+(msg.correct?'feedback-good':'feedback-bad');
    feedbackTimeout=setTimeout(()=>{feedback.textContent='Tap the next number!';feedback.className='tap-feedback';},600);
    if(msg.completed){
      byId('gameOverlay').hidden=false;
      byId('countdownNumber').textContent='✓';
      document.querySelector('.countdown-label').textContent='ALL 49 FOUND!';
      document.querySelector('.countdown-note').textContent='49 / 49. Task completed!';
    }
  }
  function renderResults(){
    const s=state, me=s.me;
    const myRow=s.results.find(x=>x.id===me.id);
    const rank=myRow?.rank||'—';
    const missing=s.mode==='missing';
    byId('resultsMedal').textContent=missing?'🔎':typeof rank==='number'?medal(rank):'⭐';
    byId('resultEyebrow').textContent=s.stage==='final'?'GAME COMPLETE':'ROUND '+(s.roundIndex+1)+' COMPLETE';
    byId('resultHeadline').textContent=missing?(me.missingTimeMs!==null?'NUMBER FOUND!':'SEARCH COMPLETE'):typeof rank==='number'&&rank<=3?'PODIUM FINISH!':'NICE WORK!';
    byId('myRank').textContent='#'+rank;
    byId('shiftTeamResult').hidden=missing;
    byId('missingResult').hidden=!missing;
    byId('resultsSummary').hidden=missing;
    if(missing){
      const before=s.missingResults.find(r=>r.roundIndex===4);
      const after=s.missingResults.find(r=>r.roundIndex===5);
      byId('missingCompareTitle').textContent=s.roundIndex===5?'YOUR BEFORE → AFTER':'YOUR FINDING TIME · BEFORE 5S';
      byId('missingCompareTime').textContent=s.roundIndex===5?secondsText(me.beforeTimeMs)+' → '+secondsText(me.afterTimeMs):secondsText(me.beforeTimeMs);
      byId('missingCompareNote').textContent=s.roundIndex===5&&before&&after?' · Group median: '+secondsText(before.medianMs)+' → '+secondsText(after.medianMs)+(s.missingAnswers?.length===2?' · Answers: '+s.missingAnswers[0]+' / '+s.missingAnswers[1]:''):' · 20 seconds = one shift';
      byId('playersTitle').textContent='🔍 FASTEST DETECTORS';
      byId('miniLeaderboard').innerHTML=s.results.slice(0,7).map(p=>`<div class="mini-rank-row"><span>${p.missingTimeMs===null?'⌛':medal(p.rank)} ${escapeHtml(p.name)}</span><b>${secondsText(p.missingTimeMs)}</b></div>`).join('');
    }else{
      byId('myRoundPoints').textContent=String(myRow?.roundPoints||0);
      byId('myTotalPoints').textContent=String(myRow?.total??me.points);
      byId('myTeamScore').textContent=String(s.teamScore??'—');
      byId('playersTitle').textContent='🏅 TOP PLAYERS';
      byId('miniLeaderboard').innerHTML=s.results.slice(0,5).map(p=>`<div class="mini-rank-row"><span>${medal(p.rank)} ${escapeHtml(p.name)}</span><b>${p.total} numbers</b></div>`).join('')||'<p>No results yet.</p>';
    }
    byId('nextPrompt').textContent=s.stage==='final'?'Your team completed the challenge!':'Waiting for next round';
  }
  function tickTimer(){
    if(!state)return;
    const n=Date.now()+serverOffset;
    if(state.stage==='countdown'){
      byId('playerTimer').textContent=state.mode==='missing'?'00:00':'00:20';
      if(state.me?.eligible&&!state.me?.completed)byId('countdownNumber').textContent=Math.max(1,Math.ceil((state.startAt-n)/1000));
    } else if(state.stage==='active'){
      const missing=state.mode==='missing';
      const remaining=state.endAt-n;
      byId('playerTimer').textContent=timeText(missing?Math.max(0,n-state.startAt):remaining);
      byId('playerTimer').classList.toggle('timer-urgent',!missing&&remaining<10000);
    }
  }
  setInterval(tickTimer,100);
})();
