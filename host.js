(function(){
  const code=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()).toUpperCase();
  const hashToken=new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
  if(hashToken){sessionStorage.setItem('hostToken:'+code, hashToken);history.replaceState({},'',location.pathname);}
  const token=sessionStorage.getItem('hostToken:'+code);
  if(!token){alert('Host token is missing. Create a new room from the home page.');location.replace('/');return;}
  let state=null,serverOffset=0,joinBase=location.origin;
  const ROUND_SUBS=[
    'Before 5S: 90 scattered numbers in different colors, angles, fonts and sizes.',
    'Sort: numbers 50–90 removed; all other numbers stay in place.',
    'Straighten + Sweep: visual 3×3 zones and a single ink color.',
    'Standardize: numbers 1–49 in a consistent sequence and grid.',
    'Find the missing number in the original, cluttered workplace. Time is measured.',
    'Find a different missing number in the standardized grid. Compare finding times.'
  ];
  const ROUND_TIPS=[
    '👀 <strong>Ask:</strong> How much time did we lose looking for the next number?',
    '🧹 <strong>Ask:</strong> What changed when we removed 41 unnecessary items?',
    '📍 <strong>Ask:</strong> How do defined zones and consistent visual conditions help?',
    '📋 <strong>Ask:</strong> What changed when the location of every number was predictable?',
    '🔍 <strong>Ask:</strong> How long did it take to identify what was missing?',
    '✨ <strong>Ask:</strong> How quickly can we see a missing tool after visual management?' 
  ];
  byId('roomCode').textContent=code;
  byId('baseUrl').value=joinBase;
  function qrRefresh(){
    const url=joinBase.replace(/\/$/,'')+'/join/'+code;
    byId('joinUrl').textContent=url.replace(/^https?:\/\//,'');
    byId('qrImage').src='/api/qr?url='+encodeURIComponent(url);
    return url;
  }
  qrRefresh();
  byId('updateUrl').addEventListener('click',()=>{
    let url=byId('baseUrl').value.trim().replace(/\/$/,'');
    try{const u=new URL(url);if(!['http:','https:'].includes(u.protocol))throw Error();joinBase=u.origin;byId('baseUrl').value=joinBase;qrRefresh();}
    catch(e){alert('Use a full address like https://my-game.onrender.com or http://192.168.1.5:8000');}
  });
  byId('copyLink').addEventListener('click',async()=>{
    const url=qrRefresh();
    try{await navigator.clipboard.writeText(url);byId('copyLink').textContent='Copied!';setTimeout(()=>byId('copyLink').textContent='Copy',1400);}
    catch(e){window.prompt('Copy the participant link:',url);}
  });
  const sock=createSocket(code, handle, ws=>{
    byId('connection').innerHTML='<span class="live-dot"></span> Connected';
    ws.send(JSON.stringify({type:'host_auth',token}));
  },()=>{byId('connection').innerHTML='<span class="live-dot offline"></span> Reconnecting';});
  byId('startBtn').addEventListener('click',()=>sock.send({type:'start'}));
  byId('endBtn').addEventListener('click',()=>sock.send({type:'end'}));
  byId('resetBtn').addEventListener('click',()=>{
    if(confirm('Reset the game? All round scores will be erased (players stay connected).'))sock.send({type:'reset'});
  });
  function handle(msg){
    if(msg.type==='error'){
      byId('connection').textContent=msg.message;
      if(msg.message.includes('not found')||msg.message.includes('Invalid host')){
        byId('hostHint').textContent='Room unavailable. Create a new room from the homepage.';
      }
      return;
    }
    if(msg.type!=='snapshot')return;
    state=msg;serverOffset=msg.serverNow-Date.now();render();
  }
  function render(){
    const s=state,phase=s.stage,index=s.roundIndex;
    byId('playerCount').textContent=`${s.playersCount} player${s.playersCount===1?'':'s'}`;
    byId('phaseBadge').textContent={lobby:'WAITING ROOM',countdown:'GET READY',active:'ROUND IN PROGRESS',results:'ROUND COMPLETE',final:'GAME COMPLETE'}[phase];
    byId('stageTitle').textContent=phase==='lobby'?'Ready to play':phase==='final'?'All rounds completed':`Round ${index+1} · ${s.roundName}`;
    const blurbs={lobby:'Invite players using the QR code above.',countdown:'Everyone starts together in a moment!',active:'Players are tapping numbers on their phones.',results:'Compare scores, then start the next round.',final:'Celebrate your team and discuss the 5S lessons.'};
    byId('stageDescription').textContent=blurbs[phase];
    byId('startBtn').hidden=!['lobby','results'].includes(phase);
    byId('startBtn').disabled=s.playersCount===0;
    byId('startBtn').innerHTML=index<0?'START ROUND 1 →':`START ROUND ${index+2} →`;
    byId('endBtn').hidden=!['countdown','active'].includes(phase);
    byId('hostHint').textContent=phase==='lobby'?'At least one person must join.':phase==='active'?(s.mode==='missing'?'One number missing. Players type the answer; compare elapsed time.':'One correct number = one point. Team score = lowest player.'):'Show the leaderboard and ask the team what changed.';
    byId('endBtn').textContent=s.mode==='missing'?'End missing-number search':'End round now';
    document.querySelectorAll('.round-node').forEach((node,i)=>{
      node.classList.toggle('selected',i===Math.max(0,index));
      node.classList.toggle('passed',i<index || (i===index && ['results','final'].includes(phase)));
    });
    const title={lobby:'Leaderboard',countdown:`Round ${index+1} · Starting`,active:`Round ${index+1} · Live ranking`,results:`Round ${index+1} · Results`,final:'Final leaderboard'};
    byId('scoreTitle').textContent=title[phase];
    byId('scoreSubtitle').textContent=phase==='lobby'?'Everyone starts at zero. Who will improve?':ROUND_SUBS[index]||'';
    const ranked=['results','final'].includes(phase) ? s.results : s.leaderboard;
    renderPodium(ranked,s.mode);
    renderLeaderboard(ranked,phase,s.mode,index);
    if(s.mode==='missing'){
      const eligible=ranked.filter(p=>p.eligible!==false);
      const found=eligible.filter(p=>p.missingTimeMs!==null);
      const before=s.missingResults.find(x=>x.roundIndex===4);
      const after=s.missingResults.find(x=>x.roundIndex===5);
      byId('leagueLabel').textContent='VISUAL MANAGEMENT · MISSING NUMBER';
      byId('teamLabel').textContent='FOUND / PARTICIPANTS';
      byId('historyLabel').textContent='FINDING TIME · GROUP MEDIAN';
      byId('teamScore').innerHTML=found.length+' <small>/ '+eligible.length+'</small>';
      byId('teamHistory').innerHTML=`<span class="mini-pill">Before: ${secondsText(before?.medianMs)}</span><span class="mini-pill">After: ${secondsText(after?.medianMs)}</span>`;
    }else{
      byId('leagueLabel').textContent='LIVE LEAGUE · 20-SECOND SHIFTS';
      byId('teamLabel').textContent='TEAM SCORE · LOWEST INDIVIDUAL';
      byId('historyLabel').textContent='SHIFT SCORES';
      byId('teamScore').innerHTML=(s.teamScore===null?'—':String(s.teamScore))+' <small>/ 49</small>';
      byId('teamHistory').innerHTML=s.teamScores.length?s.teamScores.map((value,i)=>`<span class="mini-pill">R${i+1}: ${value}/49</span>`).join(''):'<span class="mini-pill">Not started</span>';
    }
    byId('takeaway').innerHTML=phase==='lobby'?'💡 <strong>Goal:</strong> Four shifts, then two missing-number searches. Same tools; different organization.':phase==='final'&&s.missingAnswers?.length===2?`💡 <strong>Answer reveal:</strong> Before 5S: <b>${s.missingAnswers[0]}</b> was missing. After 5S: <b>${s.missingAnswers[1]}</b> was missing. What was easier to detect, and why?`:ROUND_TIPS[Math.max(0,index)]||ROUND_TIPS[0];
    tickTimer();
  }
  function secondsText(ms){return ms===null||ms===undefined?'—':(ms/1000).toFixed(1)+'s';}
  function renderPodium(data,mode){
    const top=(mode==='missing'?data.filter(p=>p.missingTimeMs!==null):data).slice(0,3);
    byId('podium').innerHTML=top.length?top.map((p,i)=>{
      const score=mode==='missing'?secondsText(p.missingTimeMs):p.total+' numbers';
      return `<div class="podium-player podium-${i+1}"><span class="podium-medal">${medal(i+1)}</span><div class="podium-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div><strong>${score}</strong></div>`;
    }).join(''):'';
  }
  function renderLeaderboard(data,phase,mode,index){
    if(!data.length){byId('leaderboard').innerHTML='<div class="empty-state"><span>🏁</span><h3>Ready, team?</h3><p>Scan the QR code on the left to get started.</p></div>';return;}
    if(mode==='missing'){
      const finalCompare=index===5;
      const header=finalCompare?'<span>BEFORE</span><span>AFTER</span>':'<span>STATUS</span><span>TIME</span>';
      byId('leaderboard').innerHTML=`<div class="leaderboard-heading"><span>RANK / PLAYER</span>${header}</div>`+data.map((p,i)=>{
        const before=finalCompare?secondsText(p.beforeTimeMs):(p.missingTimeMs===null?'Searching':'Found ✓');
        const after=secondsText(p.missingTimeMs);
        return `<div class="rank-row ${i<3&&p.missingTimeMs!==null?'rank-top':''}"><div class="rank-name"><span class="rank-number">${p.missingTimeMs===null?'⌛':medal(i+1)} <b>${i+1}</b></span><strong>${escapeHtml(p.name)}</strong></div><div class="rank-round">${before}</div><div class="rank-total">${after}</div></div>`;
      }).join('');
      return;
    }
    const hasDelta=['results','final'].includes(phase);
    byId('leaderboard').innerHTML=`<div class="leaderboard-heading"><span>RANK / PLAYER</span><span>${hasDelta?'THIS SHIFT':'FOUND'}</span><span>4-SHIFT TOTAL</span></div>`+data.map((p,i)=>{
      const moving=hasDelta && p.delta>0 ? `<span class="rank-up">▲${p.delta}</span>` : hasDelta && p.delta<0 ? `<span class="rank-down">▼${-p.delta}</span>` : '';
      return `<div class="rank-row ${i<3?'rank-top':''}"><div class="rank-name"><span class="rank-number">${medal(i+1)} <b>${i+1}</b></span><strong title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</strong>${moving}</div><div class="rank-round">${hasDelta?'+'+p.roundPoints:p.correct+'/49'}</div><div class="rank-total">${p.total}</div></div>`;
    }).join('');
  }
  function tickTimer(){
    if(!state)return;
    const time=Date.now()+serverOffset;
    const missing=state.mode==='missing';
    let val=missing?'00:00':'00:20';
    if(state.stage==='active')val=timeText(missing?Math.max(0,time-state.startAt):state.endAt-time);
    else if(state.stage==='countdown')val=String(Math.max(1,Math.ceil((state.startAt-time)/1000)))+'…';
    else if(['results','final'].includes(state.stage))val=missing?timeText(Math.max(0,state.endAt-state.startAt)):'00:00';
    byId('bigTimer').textContent=val;
    byId('shiftCounter').hidden=!missing;
    if(missing){
      const secs=state.stage==='active'?Math.max(0,time-state.startAt):['results','final'].includes(state.stage)?Math.max(0,state.endAt-state.startAt):0;
      byId('shiftCounter').textContent=Math.floor(secs/20000)+' × 20s shifts elapsed';
    }
    byId('bigTimer').classList.toggle('timer-urgent',!missing&&state.stage==='active'&&state.endAt-time<10_000);
  }
  setInterval(tickTimer,100);
})();
