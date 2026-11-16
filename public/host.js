(function(){
  const code=decodeURIComponent(location.pathname.split('/').filter(Boolean).pop()).toUpperCase();
  const hashToken=new URLSearchParams(location.hash.replace(/^#/, '')).get('token');
  if(hashToken){sessionStorage.setItem('hostToken:'+code, hashToken);history.replaceState({},'',location.pathname);}
  const token=sessionStorage.getItem('hostToken:'+code);
  if(!token){alert('Host token is missing. Create a new room from the home page.');location.replace('/');return;}
  let state=null,serverOffset=0,joinBase=location.origin;
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
    byId('hostHint').textContent=phase==='lobby'?'At least one person must join.':phase==='active'?'Each correct number = 10 pts. Wrong tap = −2 pts.':'Show the leaderboard and ask the team what changed.';
    document.querySelectorAll('.round-node').forEach((node,i)=>{
      node.classList.toggle('selected',i===Math.max(0,index));
      node.classList.toggle('passed',i<index || (i===index && ['results','final'].includes(phase)));
    });
    const title={lobby:'Leaderboard',countdown:`Round ${index+1} · Starting`,active:`Round ${index+1} · Live ranking`,results:`Round ${index+1} · Results`,final:'Final leaderboard'};
    byId('scoreTitle').textContent=title[phase];
    const subs=[
      'Before 5S: numbers 1–30 mixed with 19 unnecessary numbers.',
      'Sort: unnecessary numbers have been removed.',
      'Set in Order: the numbers now have a fixed, visual sequence.'
    ];
    byId('scoreSubtitle').textContent=phase==='lobby'?'Everyone starts at zero. Who will move up?':subs[index];
    const ranked=['results','final'].includes(phase) ? s.results : s.leaderboard;
    renderPodium(ranked);
    renderLeaderboard(ranked,phase);
    const tips=[
      '👀 <strong>Ask:</strong> How much time was spent searching instead of doing the actual task?',
      '🧹 <strong>Ask:</strong> Did removing unnecessary items make the job easier?',
      '📍 <strong>Ask:</strong> Did a consistent location make the job predictable and faster?'
    ];
    byId('takeaway').innerHTML=phase==='lobby'?'💡 <strong>Goal:</strong> Same task, three environments. Watch what organization changes.':tips[Math.max(0,index)];
    tickTimer();
  }
  function renderPodium(data){
    const top=data.slice(0,3);
    byId('podium').innerHTML=top.length?top.map((p,i)=>{
      const score=p.total||0;
      return `<div class="podium-player podium-${i+1}"><span class="podium-medal">${medal(i+1)}</span><div class="podium-name" title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</div><strong>${score} XP</strong></div>`;
    }).join(''):'';
  }
  function renderLeaderboard(data,phase){
    if(!data.length){byId('leaderboard').innerHTML='<div class="empty-state"><span>🏁</span><h3>Ready, team?</h3><p>Scan the QR code on the left to get started.</p></div>';return;}
    const hasDelta=['results','final'].includes(phase);
    byId('leaderboard').innerHTML=`<div class="leaderboard-heading"><span>RANK / PLAYER</span><span>${hasDelta?'ROUND XP':'FOUND'}</span><span>TOTAL XP</span></div>`+data.map((p,i)=>{
      const moving=hasDelta && p.delta>0 ? `<span class="rank-up">▲${p.delta}</span>` : hasDelta && p.delta<0 ? `<span class="rank-down">▼${-p.delta}</span>` : '';
      return `<div class="rank-row ${i<3?'rank-top':''}">
          <div class="rank-name"><span class="rank-number">${medal(i+1)} <b>${i+1}</b></span><strong title="${escapeHtml(p.name)}">${escapeHtml(p.name)}</strong>${moving}</div>
          <div class="rank-round">${hasDelta?'+'+p.roundPoints:p.correct+'/30'}</div>
          <div class="rank-total">${p.total}</div>
        </div>`;
    }).join('');
  }
  function tickTimer(){
    if(!state)return;
    const time=Date.now()+serverOffset;
    let val='00:30';
    if(state.stage==='active')val=timeText(state.endAt-time);
    else if(state.stage==='countdown')val=String(Math.max(1,Math.ceil((state.startAt-time)/1000)))+'…';
    else if(['results','final'].includes(state.stage))val='00:00';
    byId('bigTimer').textContent=val;
    byId('bigTimer').classList.toggle('timer-urgent',state.stage==='active'&&state.endAt-time<10_000);
  }
  setInterval(tickTimer,100);
})();
