/* Shared helpers; no third-party scripts or external API calls. */
const byId = id => document.getElementById(id);
const escapeHtml = (v) => String(v).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const medal = rank => ({1:'🥇',2:'🥈',3:'🥉'}[rank] || '✦');
function wsUrl(code){return `${location.protocol==='https:'?'wss':'ws'}://${location.host}/ws/${code}`;}
function timeText(ms){return `00:${String(Math.max(0,Math.ceil(ms/1000))).padStart(2,'0')}`;}
function createSocket(code, onMessage, onOpen, onClose){
  let sock, delay=550, stopped=false;
  function connect(){
    if(stopped)return;
    sock=new WebSocket(wsUrl(code));
    sock.addEventListener('open',()=>{ delay=550;onOpen(sock); });
    sock.addEventListener('message',e=>{try{onMessage(JSON.parse(e.data));}catch(err){console.error(err);}});
    sock.addEventListener('close',()=>{
      onClose();if(!stopped){setTimeout(connect,delay);delay=Math.min(delay*1.7,6000);}
    });
    sock.addEventListener('error',()=>{ try {sock.close()}catch(e){} });
  }
  connect();
  return {send(data){if(sock?.readyState===WebSocket.OPEN)sock.send(JSON.stringify(data));},close(){stopped=true;sock?.close();}};
}
