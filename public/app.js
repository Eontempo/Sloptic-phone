/* Sloptic Phone — browser client */
(() => {
'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const app = $('#app');
const socket = io({autoConnect:true,reconnection:true,reconnectionDelay:450});
const roomFromUrl = new URLSearchParams(location.search).get('room')?.toUpperCase().replace(/[^A-Z0-9]/g,'').slice(0,6) || '';
let session=null;
try {session=JSON.parse(sessionStorage.getItem('sloptic-session') || 'null');}catch{}
let state=null, clockOffset=0, draftPrompt='', nameDraft=localStorage.getItem('sloptic-name')||'';
let color='#8256df', tool='brush', opacity=100, brushSize=12, uploadedPosterFor=null;
let ongoingStroke=null, lastStrokeTick=0, uploadProgress=null;
const W=1600,H=900;
const offscreen=document.createElement('canvas');offscreen.width=W;offscreen.height=H;
const offCtx=offscreen.getContext('2d',{willReadFrequently:true});
function blankCanvas(){offCtx.globalAlpha=1;offCtx.fillStyle='#ffffff';offCtx.fillRect(0,0,W,H);}
blankCanvas();
const palette=['#161423','#454153','#8d889c','#c4c0cc','#ffffff','#ff525e','#ff9a80','#ff6b2d','#ffc14d','#ffe376','#caff67','#85d959','#37b86b','#2ab0a5','#4be3e6','#4eaff3','#5584e9','#8256df','#b46ce3','#f477ce','#e64f9b','#992c6e','#834936','#ba7652','#e5ac84','#f4d8bc','#fff0dc','#ced8e6'];
const paths={
  pencil:'<path d="m12 19 7-7 3 3-7 7-4 1 1-4z"/><path d="M18 13 11 6 3 14l-1 6 6-1 8-8"/>',
  brush:'<path d="m14 6 7 7-8.5 8.5a3 3 0 0 1-4.24-4.24L14 6Z"/><path d="m16 8 2-2a2.8 2.8 0 0 1 4 4l-2 2"/><path d="m6.5 17.5-2 2"/>',
  eraser:'<path d="m7 21-5-5a2 2 0 0 1 0-3L13 2a2 2 0 0 1 3 0l6 6a2 2 0 0 1 0 3L12 21H7Z"/><path d="M10 11 16 17"/><path d="M9 21h13"/>',
  bucket:'<path d="m3 11 8-8 10 10-8 8-10-10Z"/><path d="m8 6 8 8"/><path d="M21 19s-2 2-2 3a2 2 0 0 0 4 0c0-1-2-3-2-3Z"/>',
  dropper:'<path d="m2 22 1-6L17.5 1.5a3 3 0 0 1 5 5L8 21l-6 1Z"/><path d="m13 6 5 5"/>',
  undo:'<path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-15.8-5.8L3 13"/>',
  redo:'<path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 15.8-5.8L21 13"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  music:'<path d="M9 18V5l12-2v13"/><ellipse cx="6" cy="18" rx="3" ry="2"/><ellipse cx="18" cy="16" rx="3" ry="2"/>',
  copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
  check:'<path d="m4 12 5 5L20 6"/>',
  arrow:'<path d="M5 12h14m-7-7 7 7-7 7"/>',
  arrowUp:'<path d="M12 19V5m-7 7 7-7 7 7"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  star:'<path d="m12 2 3.1 6.3 7 .9-5 5 .9 7-6-3.3-6 3.3.9-7-5-5 7-.9L12 2Z"/>',
  sparkle:'<path d="m12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2L12 3Z"/>',
  upload:'<path d="M12 16V3m-5 5 5-5 5 5"/><path d="M4 15v5a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-5"/>',
  download:'<path d="M12 3v12m-5-5 5 5 5-5"/><path d="M4 16v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4"/>',
  edit:'<path d="m16 5 3 3M3 21l5-1 13-13a3 3 0 0 0-4-4L4 16l-1 5Z"/>',
  headset:'<path d="M3 14v-3a9 9 0 0 1 18 0v3"/><path d="M3 14h4v7H6a3 3 0 0 1-3-3v-4ZM21 14h-4v7h1a3 3 0 0 0 3-3v-4Z"/>',
  lock:'<rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  info:'<circle cx="12" cy="12" r="10"/><path d="M12 11v6m0-10v.01"/>',
  trophy:'<path d="M8 21h8m-4-4v4M7 4h10v7a5 5 0 0 1-10 0V4Z"/><path d="M7 7H3v2a4 4 0 0 0 4 4M17 7h4v2a4 4 0 0 1-4 4"/>',
  replay:'<path d="M3 11a9 9 0 1 1 2 6M3 4v7h7"/>',
  volume:'<path d="m11 5-5 4H2v6h4l5 4V5Z"/><path d="M15.5 8.5a5 5 0 0 1 0 7m2-10a9 9 0 0 1 0 13"/>',
  link:'<path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-2 2M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l2-2"/>',
  heart:'<path d="M20.8 4.7a5.5 5.5 0 0 0-7.8 0L12 5.8l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.5a5.5 5.5 0 0 0 0-7.8Z"/>'
};
function icon(name,cls=''){return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.sparkle}</svg>`;}
function esc(str){return String(str ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmtDuration(ms){const n=Math.max(0,Math.ceil(ms/1000));return `${String(Math.floor(n/60)).padStart(2,'0')}:${String(n%60).padStart(2,'0')}`;}
function formatFile(n){if(n<1024*1024)return `${Math.round(n/1024)} KB`;return `${(n/1024/1024).toFixed(1)} MB`;}
function toast(message,error=false){const el=document.createElement('div');el.className=`toast ${error?'error':''}`;el.innerHTML=`${icon(error?'info':'check')}<span>${esc(message)}</span>`;$('#toasts').append(el);setTimeout(()=>{el.style.opacity='0';setTimeout(()=>el.remove(),250);},3500);}
function send(event,payload={},onSuccess){
 if(!socket.connected)return toast('Connection lost — reconnecting…',true);
 socket.timeout(8000).emit(event,payload,(err,response)=>{
   if(err)return toast('The connection timed out. Please try again.',true);
   if(!response?.ok)return toast(response?.error||'Something went wrong.',true);
   onSuccess?.(response);
 });
}
function setSession(x){session=x;sessionStorage.setItem('sloptic-session',JSON.stringify(session));}
function recordSession(code,name,clientId,authToken){setSession({code,name,clientId,authToken});history.replaceState({},'',`/?room=${code}`);localStorage.setItem('sloptic-name',name);}
function createOrJoin(mode){
 const inputName=$('#playerName'),inputRoom=$('#roomInput');
 const name=inputName?.value.trim().slice(0,22)||'';
 if(!name)return toast('Add your name first.',true);
 const code=(inputRoom?.value||'').trim().toUpperCase().replace(/[^A-Z0-9]/g,'');
 if(mode==='join' && code.length!==6)return toast('A room code has 6 characters.',true);
 const clientId=crypto.randomUUID();const authToken=crypto.randomUUID();
 const event=mode==='join'?'room:join':'room:create';
 send(event,{name,code,clientId,authToken},result=>{
   recordSession(result.code,name,clientId,authToken);
   // A state event may already have arrived before the acknowledgement.
   if(mode==='create')toast('Room created! Share the invite with two friends.');
 });
}
function showNav(){return `<div class="container"><header class="nav"><div class="brand"><span class="brand-mark">${icon('sparkle')}</span><span>sloptic<span class="brand-dot">.</span>phone</span></div><div class="top-right"><div class="nav-tag"><i class="dot ${socket.connected?'':'off'}"></i>${socket.connected?'All systems playful':'Reconnecting…'}</div>${state?`<span class="round-pill">Round ${state.round||1}</span>`:`<span class="round-pill">A 3-player creative party</span>`}</div></header></div>`;}
function landingArt(){return `<div class="hero-visual"><div class="floating float-one">${icon('brush')} Two minds, one canvas</div><div class="visual-main"><div class="visual-top"><span class="visual-dots"><i></i><i></i><i></i></span><span>LIVE COLLAB CANVAS</span><span>✳</span></div><div class="illustration"><svg viewBox="0 0 510 380" xmlns="http://www.w3.org/2000/svg"><rect width="510" height="380" fill="#faf6e8"/><path d="M30 330C103 270 160 351 236 291s188-47 249-3" stroke="#d5bdf7" stroke-width="35" fill="none" stroke-linecap="round"/><path d="M21 93c116-91 240 11 350-29" stroke="#b7e48a" stroke-width="22" fill="none" stroke-linecap="round"/><path d="M400 25c20 33 46 40 83 48" stroke="#ef8db2" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M145 275C79 224 131 104 253 113c115 8 169 95 110 177-55 77-166 57-218-15Z" fill="#a687e5" stroke="#342750" stroke-width="9"/><path d="M191 173c15-12 32-12 45 0m48 0c16-15 35-11 44 2" stroke="#3b295c" stroke-width="9" fill="none" stroke-linecap="round"/><path d="M216 224c35 41 75 44 111-1" stroke="#312443" stroke-width="10" fill="none" stroke-linecap="round"/><path d="M160 230c-23-7-33-19-41-34" stroke="#ff9eaf" stroke-width="13" fill="none" stroke-linecap="round"/><path d="M348 235c24 0 35-9 43-25" stroke="#ff9eaf" stroke-width="13" fill="none" stroke-linecap="round"/><path d="m65 190 5-13 6 13 15 6-15 6-6 13-5-13-15-6 15-6Z" fill="#e9b44f"/><path d="m439 167 5-13 6 13 15 6-15 6-6 13-5-13-15-6 15-6Z" fill="#5ec8cc"/><path d="M335 24c15 8 17 20 14 36" stroke="#e8a63a" stroke-width="8" fill="none" stroke-linecap="round"/></svg></div><div class="visual-bottom">${palette.slice(5,21).map(c=>`<span style="background:${c}"></span>`).join('')}</div></div><div class="floating float-two">${icon('music')} + one perfect soundtrack</div></div>`;}
function landing(){const prefilled=(state?state.code:roomFromUrl);return `${showNav()}<main class="container landing"><section class="hero"><div class="hero-copy"><div class="pill">${icon('sparkle','small-icon')} DRAW + MUSIC + CHAOS</div><h1>Three friends.<br>One <span class="scribble">ridiculous</span><br><span class="accent">masterpiece.</span></h1><p>Two artists. One composer. Three secret prompts. Turn mismatched ideas into something unexpectedly wonderful — together, in real time.</p><div class="land-form"><label class="field-label" for="playerName">WHAT SHOULD WE CALL YOU?</label><input class="input" id="playerName" autocomplete="nickname" maxlength="22" placeholder="Your legendary artist name" value="${esc(nameDraft)}"><div class="land-actions"><button class="btn" id="createRoom">Create a room ${icon('arrow')}</button><input class="input" id="roomInput" aria-label="6-character room code" maxlength="6" placeholder="ROOM ID" value="${esc(prefilled)}"><button class="btn secondary" id="joinRoom">Join</button></div></div><div class="hero-foot"><span class="flex">${icon('users')} Exactly 3 players</span><span class="flex">${icon('clock')} 5 · 10 · 15 min games</span><span class="flex">${icon('music')} Real MP3 soundtracks</span></div></div>${landingArt()}</section><section class="stepbar"><div class="step-inner"><div class="step"><span class="step-index">01</span><div><b>Choose your chaos</b><p>Start a private room, pick a role, and set your clock.</p></div></div><div class="step"><span class="step-index">02</span><div><b>Pass the prompt</b><p>Write an idea for a secret teammate in a 60-second planning phase.</p></div></div><div class="step"><span class="step-index">03</span><div><b>Make it yours</b><p>Draw together, upload a soundtrack, then unveil and rate the result.</p></div></div></div></section><footer class="footer">Sloptic Phone • Better together, weirder together.</footer></main>`;}
function playerIcon(p,index){return `<span class="avatar ${['purple-a','green-a','pink-a'][index%3]}">${esc(p.name.slice(0,1).toUpperCase())}</span>`;}
function gameBar(){return `<div class="game-bar"><div class="room-label"><div><div class="eyebrow" style="margin-bottom:6px">YOUR PRIVATE ROOM</div><button class="room-code" id="copyCode" title="Copy invite link">${esc(state.code)} ${icon('copy')}</button></div><span class="chip">${icon('users','small-icon')} ${state.players.filter(p=>p.online).length}/3 online</span></div><div class="game-stage"><span class="round-pill">${state.phase==='lobby'?'Lobby':state.phase==='planning'?'01 / Planning':state.phase==='creation'?'02 / Creation':'03 / Reveal'}</span>${state.modeMinutes?`<span class="round-pill">${state.modeMinutes} min mode</span>`:''}</div></div>`;}
function stageTitle(kicker,title,subtitle,hasTimer=true){return `<div class="stage-heading"><div><span class="pill">${icon('sparkle','small-icon')} ${kicker}</span><h1>${title}</h1><p>${subtitle}</p></div>${hasTimer?`<div class="timer" id="stageTimer">${icon('clock')}<div><small>TIME LEFT</small><b id="timerText">00:00</b></div></div>`:''}</div>`;}
function gameContainer(inner){return `${showNav()}<main class="container game-main">${gameBar()}${inner}<footer class="footer">Sloptic Phone • Made for 3 people & one beautiful mess.</footer></main>`;}
function lobby(){
 const host=state.myId===state.hostId, my=state.players.find(p=>p.id===state.myId), ready=state.players.length===3&&state.players.every(p=>p.online&&p.role)&&new Set(state.players.map(p=>p.role)).size===3&&!!state.modeMinutes;
 const tiles=[0,1,2].map(i=>{const p=state.players[i];return p?`<div class="player-card ${p.id===state.myId?'you':''}">${playerIcon(p,i)}<div><b>${esc(p.name)} ${p.id===state.myId?'(you)':''}</b><div class="player-sub"><i class="dot ${p.online?'':'off'}"></i>${p.online?'Connected':'Offline'}${p.role?' · '+esc(p.role):' · Picking role…'}</div></div>${p.isHost?'<span class="corner-badge">HOST</span>':''}</div>`:`<div class="player-card open">${icon('users')}<span>Waiting for player ${i+1}…</span></div>`;}).join('');
 const roles=[{id:'Artist 1',title:'1st Artist',caption:'Paint the beginning',ico:'brush'},{id:'Artist 2',title:'2nd Artist',caption:'Add to the madness',ico:'edit'},{id:'Composer',title:'Composer',caption:'Make it sound right',ico:'music'}];
 return gameContainer(`${stageTitle('THE PRE-GAME','Assemble your<br><span class="accent">creative crew.</span>','Invite two friends, pick different roles, then get ready for the unexpected.',false)}<div class="columns-2"><section class="panel panel-pad"><div class="flex spaced"><div><div class="section-title">THE ROOM</div><div class="section-help">Exactly three brilliant minds required.</div></div><span class="chip">${state.players.length} / 3 joined</span></div><div class="lobby-player-grid">${tiles}</div><button class="btn secondary block" id="copyInvite">${icon('link')} Copy invite link</button><div class="divider"></div><div class="section-title">CHOOSE YOUR ROLE</div><div class="section-help">One of each. Pick yours before the round starts.</div><div class="role-grid">${roles.map(r=>{const taken=state.players.some(p=>p.id!==state.myId&&p.role===r.id);const selected=my?.role===r.id;return `<button class="role-option ${selected?'selected':''} ${taken?'taken':''}" data-role="${r.id}" ${taken?'disabled':''}>${icon(r.ico)}<div><b>${r.title}</b><span>${taken?'Already taken':selected?'Your role':r.caption}</span></div></button>`;}).join('')}</div></section><section class="panel panel-pad"><div class="section-title">PICK A GAME MODE</div><div class="section-help">This is how long the creation phase lasts. Everyone gets the same time.</div><div class="mode-grid">${[5,10,15].map(n=>`<button class="mode-option ${state.modeMinutes===n?'selected':''}" data-mode="${n}" ${!host?'disabled':''}><strong>${n}<small style="font-size:14px"> min</small></strong><span>${n===5?'Quick sketch':n===10?'Creative flow':'The full experience'}</span></button>`).join('')}</div>${!host?`<div class="host-tip">${icon('info','small-icon')} Only the room host sets the timer. You can still choose your role.</div>`:`<div class="host-tip">${icon('info','small-icon')} Host controls: once all three players have unique roles and a mode, you're ready to start.</div>`}<div class="divider"></div><div class="section-title">HOW A ROUND WORKS</div><div class="tip-row">${icon('clock')} <span><b>60 seconds</b> to send secret prompts. Ends sooner if everyone submits.</span></div><div class="tip-row">${icon('brush')} <span><b>5, 10, or 15 minutes</b> to create one canvas and one soundtrack.</span></div><div class="tip-row">${icon('star')} <span><b>Rate everyone</b> from 0–5 stars. A perfect 15 earns MVP.</span></div><div class="lobby-bottom"><p>${ready?'Every role is filled. You are ready!':'Invite friends, fill all roles, and select a mode to begin.'}</p>${host?`<button id="startRound" class="btn" ${!ready?'disabled':''}>Start the round ${icon('arrow')}</button>`:`<span class="chip">Waiting for host ${icon('clock','small-icon')}</span>`}</div></section></div>`);
}
function planning(){
 const me=state.players.find(p=>p.id===state.myId), done=me?.promptSubmitted;
 return gameContainer(`${stageTitle('PHASE 01 / PLANNING','Plant an idea.<br><span class="accent">Pass it on.</span>','Your secret prompt is heading to another player. Make it weird, wonderful, or wildly specific.')}<div class="planning-grid"><section class="panel prompt-big"><div class="section-title">YOUR RECIPIENT</div><div class="recipient-block"><div class="recipient-avatar">${esc(state.recipient?.name?.slice(0,1)?.toUpperCase()||'?')}</div><div><span class="recipient-label">Your idea will go to</span><strong class="recipient-name">${esc(state.recipient?.name||'A mystery teammate')}</strong><span class="chip">${esc(state.recipient?.role||'Secret role')}</span></div></div><label class="field-label" for="promptInput">WRITE THEIR CREATIVE CHALLENGE</label>${done?`<div class="locked-box">${icon('check','wide-icon')} <strong>Prompt sent and locked!</strong><p>“${esc(state.mySubmittedPrompt)}”</p><p>Waiting for your teammates or the timer.</p></div>`:`<textarea class="input prompt-area" id="promptInput" maxlength="240" placeholder="A tiny astronaut discovers a secret underwater bakery…">${esc(draftPrompt)}</textarea><div class="prompt-footer"><span class="char-count" id="promptChars">${draftPrompt.length} / 240 characters</span><button class="btn" id="submitPrompt">Send secret prompt ${icon('arrow')}</button></div>`}<div class="status-row">${state.players.map(p=>`<span class="status-pill ${p.promptSubmitted?'done':''}">${p.promptSubmitted?'✓':'·'} ${esc(p.name)} ${p.promptSubmitted?'sent':'writing'}</span>`).join('')}</div></section><aside class="panel side-explain"><div class="illustrate-icon">${icon('sparkle','wide-icon')}</div><h3>Good prompts make<br>great surprises.</h3><p>The two artists will combine their separate prompts on the same live canvas. The composer will interpret their own prompt through music.</p><div class="tip-list"><div class="tip-row">${icon('check')} <span>Think visual, funny, atmospheric, or absurd.</span></div><div class="tip-row">${icon('check')} <span>Everyone receives exactly one prompt.</span></div><div class="tip-row">${icon('check')} <span>Your recipient changes next match for extra variety.</span></div></div></aside></div>`);
}
function swatchButton(c){return `<button class="swatch ${c.toLowerCase()===color.toLowerCase()?'active':''} ${c==='#161423'?'black':''}" style="background:${c}" aria-label="Color ${c}" title="${c}" data-color="${c}"></button>`;}
function myPlayer(){return state.players.find(p=>p.id===state.myId);}
function artistsCreation(){
 const me=myPlayer(),done=me.created,partner=state.players.find(p=>p.role.includes('Artist')&&p.id!==state.myId);
 const artControls=`<aside class="panel toolbar"><div class="tool-group-title">YOUR TOOLS</div><div class="tool-row">${[['brush','Brush (B)'],['eraser','Eraser (E)'],['bucket','Fill bucket (G)'],['dropper','Eyedropper (I)']].map(([id,label])=>`<button class="tool-button ${tool===id?'active':''}" data-tool="${id}" title="${label}" aria-label="${label}" ${done?'disabled':''}>${icon(id)}</button>`).join('')}</div><div class="divider"></div><div class="tool-group-title">COLOR PALETTE</div><div class="palette">${palette.map(swatchButton).join('')}</div><div class="color-footer"><span class="current-swatch" id="currentSwatch" style="background:${color}"></span><label for="customColor">+ Custom color <input id="customColor" class="custom-color" type="color" value="${color}"></label></div><div class="divider"></div><div class="range-wrap"><div class="range-head"><span>Brush size</span><span class="range-value" id="sizeValue">${brushSize} px</span></div><input type="range" class="range" id="brushSize" min="1" max="72" value="${brushSize}" ${done?'disabled':''} aria-label="Brush size"></div><div class="range-wrap"><div class="range-head"><span>Opacity</span><span class="range-value" id="opacityValue">${opacity}%</span></div><input type="range" class="range" id="brushOpacity" min="1" max="100" value="${opacity}" ${done?'disabled':''} aria-label="Brush opacity"></div><div class="tool-actions"><button id="undo" class="btn secondary small" ${done?'disabled':''}>${icon('undo')} Undo</button><button id="redo" class="btn secondary small" ${done?'disabled':''}>${icon('redo')} Redo</button></div><div class="tool-info"><span><span class="kbd">B</span> brush</span><span><span class="kbd">G</span> bucket</span></div></aside>`;
 const board=`<section class="canvas-pane"><div class="canvas-topline"><div class="flex">${icon('brush','small-icon')} SHARED MASTERPIECE</div><div class="live-tag"><i class="dot"></i> LIVE COLLABORATION</div></div><div class="canvas-frame"><canvas id="paintCanvas" width="1600" height="900" aria-label="Collaborative drawing canvas" class="${done?'frozen':''}"></canvas>${done?`<div class="canvas-lock">${icon('check','wide-icon')} Your artwork is submitted</div>`:''}</div><div class="canvas-bottomline"><span>${icon('users','small-icon')} You + ${esc(state.partnerName)} are drawing together</span><span>1600 × 900 canvas</span></div></section>`;
 const side=`<aside class="panel prompt-sidebar"><div class="section-title">YOUR CREATIVE BRIEF</div><div class="section-help">Keep these prompts in sight while you draw.</div><div class="prompt-tile"><span class="tag">${icon('sparkle','small-icon')} YOUR PROMPT</span><p>${esc(state.myPrompt||'Create something amazing!')}</p></div><div class="prompt-tile partner"><span class="tag">${icon('users','small-icon')} ${esc(partner?.name||'PARTNER')}'S PROMPT</span><p>${esc(state.partnerPrompt||'Add something wonderful!')}</p></div>${done?`<button class="btn block" disabled>${icon('check')} Artwork submitted</button>`:`<button id="submitCreation" class="btn block">${icon('check')} Submit my artwork</button>`}<div class="artist-state">${icon(partner?.created?'check':'clock','small-icon')} ${esc(partner?.name||'Other artist')}: ${partner?.created?'submitted':'still creating'}</div><div class="waiting-note">Only when all three players submit — or time runs out — will the reveal begin. Your partner can keep drawing after you submit.</div></aside>`;
 return gameContainer(`${stageTitle('PHASE 02 / CREATION','Make a beautiful<br><span class="accent">mess together.</span>','Both artists are editing one canvas in real time. Experiment with colors, layers, and ideas.')}<div class="workspace-grid">${artControls}${board}${side}</div>`);
}
function composerCreation(){
 const done=myPlayer().created, uploaded=!!state.audio;
 const dzContent=uploaded?`<div class="audio-loaded">${icon('music','audio-icon')}<b>${esc(state.audio.name)}</b><p>${formatFile(state.audio.size)} · MP3 uploaded successfully</p><audio controls preload="metadata" src="${esc(state.audio.url)}"></audio><button class="btn secondary small" id="replaceAudio" ${done?'disabled':''}>${icon('upload')} Replace MP3</button></div>`:`<div class="dropzone" id="dropzone"><div class="music-icon">${icon('music')}</div><h2>Put your music in me.</h2><p>Choose an MP3 from your computer, or drag it here. It will play with the artists' picture at the big reveal.</p><button id="chooseAudio" class="btn purple-btn">${icon('upload')} Choose your MP3</button><div class="field-hint">MP3 only · Any duration · Up to ${window.MAX_AUDIO_MB||200} MB per file</div>${uploadProgress!==null?`<div class="upload-meter"><div style="width:${uploadProgress}%"></div></div><span class="tiny">Uploading… ${uploadProgress}%</span>`:''}</div>`;
 return gameContainer(`${stageTitle('PHASE 02 / CREATION','Find the sound.<br><span class="accent">Set the mood.</span>','You are the composer. Your soundtrack will play over the artists’ final drawing during the reveal.')}<div class="composer-grid"><section class="panel composer-workspace"><div class="canvas-topline"><div class="flex">${icon('headset','small-icon')} MUSIC STUDIO</div><span class="live-tag">${icon('music','small-icon')} AUDIO ONLY</span></div><div class="composer-inner">${dzContent}<input class="music-file" type="file" id="audioInput" accept=".mp3,audio/mpeg"></div><div class="canvas-bottomline"><span>Use a finished MP3 file — make your track as long or short as you like.</span><div class="audio-wave">${'<i></i>'.repeat(8)}</div></div></section><aside class="panel prompt-sidebar"><div class="section-title">YOUR COMPOSER BRIEF</div><div class="section-help">Let this idea guide your soundtrack.</div><div class="prompt-tile"><span class="tag">${icon('sparkle','small-icon')} YOUR PROMPT</span><p>${esc(state.myPrompt||'Compose a fitting soundtrack!')}</p></div><div class="prompt-tile partner"><span class="tag">${icon('brush','small-icon')} THE ARTISTS</span><p>Two teammates are combining their own secret prompts on a shared canvas. You'll see their finished art at the reveal.</p></div>${done?`<button class="btn block" disabled>${icon('check')} Music submitted</button>`:`<button class="btn block" id="submitCreation" ${!uploaded?'disabled':''}>${icon('check')} Submit my music</button>`}<div class="waiting-note">The creation timer is shared by all players. You can preview or replace your MP3 before you submit.</div></aside></div>`);
}
function resultRating(p,i){
 const score=state.scores.find(x=>x.id===p.id)||{total:0,votes:0,mvp:false};
 const rated=state.ratings[p.id]; const finished=myPlayer().finished;
 return `<div class="rating-card"><div class="rating-header">${playerIcon(p,i)}<div><span class="rating-name">${esc(p.name)} ${p.id===state.myId?'(you)':''}</span><span class="rating-role">${esc(p.role)}</span></div>${score.mvp?`<span class="mvp-tag">${icon('trophy')} MVP</span>`:''}<div class="rating-total">${score.total}<span style="color:#8a839c;font-size:11px">/15</span></div></div><div class="star-row">${[1,2,3,4,5].map(n=>`<button class="star-btn ${rated!==undefined && n<=rated?'filled':''}" data-rate="${p.id}" data-stars="${n}" title="${n} stars" aria-label="Rate ${esc(p.name)} ${n} stars" ${finished?'disabled':''}>${icon('star')}</button>`).join('')}<button class="zero-btn ${rated===0?'selected':''}" data-rate="${p.id}" data-stars="0" ${finished?'disabled':''} title="Zero stars">0 ☆</button></div><div class="field-hint">${score.votes} / 3 ratings received ${rated!==undefined?`· Your vote: ${rated}/5`:''}</div></div>`;
}
function results(){
 const done=myPlayer().finished,finished=state.players.filter(p=>p.finished).length;
 const audio=state.audio?`<audio class="audio-player" id="resultAudio" controls preload="metadata" src="${esc(state.audio.url)}"></audio>`:`<div class="results-note">The composer didn't upload a track in time, so this is an art-only reveal.</div>`;
 return gameContainer(`${stageTitle('PHASE 03 / BIG REVEAL','Look what you<br><span class="accent">made together.</span>','Three prompts. Two paintbrushes. One soundtrack. Now give everyone their flowers.',false)}<div class="results-grid"><div><section class="panel reveal"><div class="reveal-top"><div class="section-title">THE FINAL MASTERPIECE</div><span class="chip">${icon('sparkle','small-icon')} SLIP-UPS ENCOURAGED</span></div><div class="result-art">${state.artwork?`<img src="${esc(state.artwork)}" alt="The combined drawing made by both artists">`:`<div class="result-loading skeleton-pulse">${icon('sparkle')}Preparing your masterpiece…</div>`}${state.audio?`<span class="play-overlay">${icon('music')} Press play below to hear the soundtrack</span>`:''}</div><div class="player-control"><div class="music-row"><div class="music-cover">${icon('music')}</div><div><b>${esc(state.audio?.name||'No soundtrack this round')}</b><small>Composed / selected by ${esc(state.players.find(p=>p.role==='Composer')?.name||'your composer')}</small></div></div>${audio}<div class="download-row">${state.artwork?`<a class="btn secondary small" href="${esc(state.artwork)}" download="sloptic-${esc(state.code)}-art.png">${icon('download')} Save artwork</a>`:''}${state.audio?`<a class="btn secondary small" href="${esc(state.audio.url)}" download="${esc(state.audio.name)}">${icon('download')} Save MP3</a>`:''}${state.artwork && state.audio && state.videoExport?`<a class="btn small" href="/api/rooms/${esc(state.code)}/export.mp4" download="sloptic-${esc(state.code)}.mp4">${icon('download')} Export MP4</a>`:''}</div></div></section><div class="results-note">${icon('info','small-icon')} <b>How the reveal works:</b> The drawing stays on screen while the MP3 plays at its original quality and full length. Pause, seek, or replay whenever you like.</div></div><aside class="panel score-panel"><div class="flex spaced"><div><div class="section-title">GIVE CREDIT</div><h3 style="margin-top:5px">Rate your crew ${icon('star','small-icon')}</h3></div><span class="chip">0–5 ★ each</span></div><p>Rate all three players, including yourself, from 0 to 5 stars. A perfect 15/15 across all three votes earns the MVP crown.</p>${state.players.map(resultRating).join('')}<div class="results-footer"><button class="btn block" id="finishRound" ${done?'disabled':''}>${done?`${icon('check')} You finished`:`${icon('replay')} Finish & return to lobby`}</button><div class="finish-status">${finished}/3 players finished · The next lobby opens when everyone finishes.</div></div></aside></div>`);
}
function render(){
 if(!state){app.innerHTML=landing();bindLanding();return;}
 let view;
 if(state.phase==='lobby')view=lobby();
 else if(state.phase==='planning')view=planning();
 else if(state.phase==='creation')view=myPlayer().role==='Composer'?composerCreation():artistsCreation();
 else view=results();
 let playback=null;
 const currentAudio=$('#resultAudio');if(currentAudio){playback={time:currentAudio.currentTime,playing:!currentAudio.paused};}
 app.innerHTML=view;
 bindCommon();
 if(state.phase==='lobby')bindLobby();
 if(state.phase==='planning')bindPlanning();
 if(state.phase==='creation'){if(myPlayer().role==='Composer')bindComposer();else bindArtist();}
 if(state.phase==='results'){
   bindResults();
   if(playback){const el=$('#resultAudio');if(el){el.currentTime=playback.time;if(playback.playing)el.play().catch(()=>{});}}
   ensurePoster();
 }
 updateClock();
}
function bindLanding(){
 $('#createRoom')?.addEventListener('click',()=>createOrJoin('create'));
 $('#joinRoom')?.addEventListener('click',()=>createOrJoin('join'));
 $('#playerName')?.addEventListener('input',e=>{nameDraft=e.target.value;});
 $('#roomInput')?.addEventListener('input',e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,'');});
 $('#playerName')?.addEventListener('keydown',e=>{if(e.key==='Enter')createOrJoin('create');});
 $('#roomInput')?.addEventListener('keydown',e=>{if(e.key==='Enter')createOrJoin('join');});
}
function bindCommon(){
 const copy=async()=>{
   const url=`${location.origin}/?room=${state.code}`;
   try {if(!navigator.clipboard?.writeText)throw Error('no clipboard');await navigator.clipboard.writeText(url);toast('Invite link copied!');}
   catch {const input=document.createElement('textarea');input.value=url;document.body.append(input);input.select();const okay=document.execCommand?.('copy');input.remove();toast(okay?'Invite link copied!':`Share this code: ${state.code}`);}
 };
 $('#copyCode')?.addEventListener('click',copy);$('#copyInvite')?.addEventListener('click',copy);
}
function bindLobby(){
 $$('[data-role]').forEach(el=>el.addEventListener('click',()=>send('room:role',{role:el.dataset.role})));
 $$('[data-mode]').forEach(el=>el.addEventListener('click',()=>send('room:mode',{minutes:Number(el.dataset.mode)})));
 $('#startRound')?.addEventListener('click',()=>send('room:start'));
}
function bindPlanning(){
 const input=$('#promptInput');input?.addEventListener('input',e=>{draftPrompt=e.target.value;$('#promptChars').textContent=`${draftPrompt.length} / 240 characters`;});
 $('#submitPrompt')?.addEventListener('click',()=>send('planning:submit',{prompt:input?.value||draftPrompt},()=>{draftPrompt='';toast('Prompt sent!');}));
}
function bindArtist(){
 bindCanvas();
 $$('[data-tool]').forEach(el=>el.addEventListener('click',()=>setTool(el.dataset.tool)));
 $$('[data-color]').forEach(el=>el.addEventListener('click',()=>setColor(el.dataset.color)));
 $('#customColor')?.addEventListener('input',e=>setColor(e.target.value));
 $('#brushSize')?.addEventListener('input',e=>{brushSize=+e.target.value;$('#sizeValue').textContent=brushSize+' px';});
 $('#brushOpacity')?.addEventListener('input',e=>{opacity=+e.target.value;$('#opacityValue').textContent=opacity+'%';});
 $('#undo')?.addEventListener('click',()=>send('draw:undo'));
 $('#redo')?.addEventListener('click',()=>send('draw:redo'));
 $('#submitCreation')?.addEventListener('click',()=>send('creation:submit',{},()=>toast('Drawing submitted. Waiting on your crew.')));
}
function setColor(next){color=next;$$('[data-color]').forEach(el=>el.classList.toggle('active',el.dataset.color.toLowerCase()===color.toLowerCase()));const sw=$('#currentSwatch');if(sw)sw.style.background=color;const pick=$('#customColor');if(pick)pick.value=color;}
function setTool(next){tool=next;$$('[data-tool]').forEach(el=>el.classList.toggle('active',el.dataset.tool===tool));const canvas=$('#paintCanvas');if(canvas)canvas.style.cursor=tool==='dropper'?'copy':tool==='bucket'?'cell':'crosshair';}
function bindComposer(){
 const input=$('#audioInput');
 $('#chooseAudio')?.addEventListener('click',()=>input?.click());
 $('#replaceAudio')?.addEventListener('click',()=>input?.click());
 input?.addEventListener('change',()=>uploadMP3(input.files?.[0]));
 const drop=$('#dropzone');if(drop){
   ['dragenter','dragover'].forEach(evt=>drop.addEventListener(evt,e=>{e.preventDefault();drop.classList.add('dragover');}));
   ['dragleave','drop'].forEach(evt=>drop.addEventListener(evt,e=>{e.preventDefault();drop.classList.remove('dragover');}));
   drop.addEventListener('drop',e=>uploadMP3(e.dataTransfer.files?.[0]));
 }
 $('#submitCreation')?.addEventListener('click',()=>send('creation:submit',{},()=>toast('Soundtrack submitted. Waiting on your crew.')));
}
function uploadMP3(file){
 if(!file)return;
 if(!/\.mp3$/i.test(file.name))return toast('Please choose a .mp3 audio file.',true);
 if(!session)return;
 const data=new FormData();data.append('clientId',session.clientId);data.append('authToken',session.authToken);data.append('audio',file);
 uploadProgress=0;const target=$('#dropzone');if(target)target.innerHTML=`<div class="music-icon">${icon('upload')}</div><h3>Uploading your soundtrack…</h3><p>${esc(file.name)}</p><div class="upload-meter"><div id="uploadBar" style="width:0%"></div></div><span id="uploadPercent" class="tiny">0%</span>`;
 const xhr=new XMLHttpRequest();xhr.open('POST',`/api/rooms/${session.code}/music`);
 xhr.upload.addEventListener('progress',e=>{if(e.lengthComputable){uploadProgress=Math.round(e.loaded/e.total*100);const bar=$('#uploadBar');if(bar)bar.style.width=uploadProgress+'%';const percent=$('#uploadPercent');if(percent)percent.textContent=uploadProgress+'%';}});
 xhr.addEventListener('load',()=>{
   uploadProgress=null;let result;try{result=JSON.parse(xhr.responseText);}catch{}
   if(xhr.status>=200&&xhr.status<300){toast('MP3 uploaded. Give it a listen!');}
   else{toast(result?.error||'MP3 upload failed.',true);render();}
 });
 xhr.addEventListener('error',()=>{uploadProgress=null;toast('Network error during upload.',true);render();});
 xhr.send(data);
}
function bindResults(){
 $$('[data-rate]').forEach(el=>el.addEventListener('click',()=>send('rating:vote',{targetId:el.dataset.rate,stars:+el.dataset.stars})));
 $('#finishRound')?.addEventListener('click',()=>send('room:finish',{},()=>toast('Your scores are locked. Waiting for the others.')));
}
function updateClock(){
 const display=$('#timerText');if(!display||!state?.deadline)return;
 const left=state.deadline-(Date.now()+clockOffset);display.textContent=fmtDuration(left);
 $('#stageTimer')?.classList.toggle('urgent',left<20000);
}
setInterval(updateClock,200);
function getPoint(e,canvas){const r=canvas.getBoundingClientRect();return {x:Math.min(W,Math.max(0,(e.clientX-r.left)/r.width*W)),y:Math.min(H,Math.max(0,(e.clientY-r.top)/r.height*H))};}
function bindCanvas(){
 const canvas=$('#paintCanvas');if(!canvas)return;
 const ctx=canvas.getContext('2d');ctx.drawImage(offscreen,0,0);
 if(myPlayer().created)return;
 canvas.addEventListener('contextmenu',e=>e.preventDefault());
 canvas.addEventListener('pointerdown',e=>{
   if(e.button!==0||!socket.connected)return;
   e.preventDefault();canvas.setPointerCapture(e.pointerId);
   const pos=getPoint(e,canvas);
   if(tool==='dropper'){
     const d=offCtx.getImageData(Math.min(W-1,Math.floor(pos.x)),Math.min(H-1,Math.floor(pos.y)),1,1).data;
     const hex='#'+[d[0],d[1],d[2]].map(n=>n.toString(16).padStart(2,'0')).join('');setColor(hex);setTool('brush');return;
   }
   const actionId=crypto.randomUUID();
   const op={type:tool==='bucket'?'fill':'dot',actionId,color:tool==='eraser'?'#ffffff':color,opacity:tool==='eraser'?1:opacity/100,size:brushSize,...pos};
   applyOp(op);socket.emit('draw:op',op);
   if(tool!=='bucket'){ongoingStroke={pointerId:e.pointerId,actionId,last:pos};lastStrokeTick=performance.now();}
 });
 canvas.addEventListener('pointermove',e=>{
   if(!ongoingStroke||ongoingStroke.pointerId!==e.pointerId)return;
   if(performance.now()-lastStrokeTick<24)return;
   const pos=getPoint(e,canvas);sendStrokeSegment(pos);lastStrokeTick=performance.now();
 });
 function end(e){if(ongoingStroke&&ongoingStroke.pointerId===e.pointerId){sendStrokeSegment(getPoint(e,canvas));ongoingStroke=null;}}
 canvas.addEventListener('pointerup',end);canvas.addEventListener('pointercancel',end);
}
function sendStrokeSegment(pos){
 if(!ongoingStroke)return;
 const {last,actionId}=ongoingStroke;
 if(Math.abs(pos.x-last.x)+Math.abs(pos.y-last.y)<.4)return;
 const op={type:'segment',actionId,color:tool==='eraser'?'#ffffff':color,opacity:tool==='eraser'?1:opacity/100,size:brushSize,x:last.x,y:last.y,x2:pos.x,y2:pos.y};
 applyOp(op);if(socket.connected)socket.emit('draw:op',op);ongoingStroke.last=pos;
}
function paintOp(ctx,op){
 if(op.type==='fill'){fillArea(ctx,op);return;}
 ctx.save();ctx.globalAlpha=op.opacity;ctx.lineCap='round';ctx.lineJoin='round';ctx.strokeStyle=op.color;ctx.fillStyle=op.color;ctx.lineWidth=op.size;
 if(op.type==='dot'){ctx.beginPath();ctx.arc(op.x,op.y,op.size/2,0,Math.PI*2);ctx.fill();}
 else {ctx.beginPath();ctx.moveTo(op.x,op.y);ctx.lineTo(op.x2,op.y2);ctx.stroke();}
 ctx.restore();
}
function fillArea(ctx,op){
 const sx=Math.max(0,Math.min(W-1,Math.floor(op.x))),sy=Math.max(0,Math.min(H-1,Math.floor(op.y)));
 const image=ctx.getImageData(0,0,W,H),data=image.data;
 const source=(sy*W+sx)*4, r0=data[source],g0=data[source+1],b0=data[source+2];
 const hex=op.color.replace('#','');const rr=parseInt(hex.slice(0,2),16),gg=parseInt(hex.slice(2,4),16),bb=parseInt(hex.slice(4,6),16);
 const a=Math.max(.01,Math.min(1,op.opacity));
 const nr=Math.round(rr*a+r0*(1-a)),ng=Math.round(gg*a+g0*(1-a)),nb=Math.round(bb*a+b0*(1-a));
 if(nr===r0&&ng===g0&&nb===b0)return;
 const visited=new Uint8Array(W*H), stack=[sy*W+sx];
 // Fill contiguous pixels close to the clicked color; antialiased edges remain crisp.
 const match=(i)=>{const k=i*4;return Math.abs(data[k]-r0)<=9&&Math.abs(data[k+1]-g0)<=9&&Math.abs(data[k+2]-b0)<=9;};
 while(stack.length){const cur=stack.pop();if(visited[cur])continue;visited[cur]=1;if(!match(cur))continue;
   const k=cur*4;data[k]=nr;data[k+1]=ng;data[k+2]=nb;data[k+3]=255;
   const x=cur%W;
   if(x>0 && !visited[cur-1])stack.push(cur-1);
   if(x<W-1 && !visited[cur+1])stack.push(cur+1);
   if(cur>=W && !visited[cur-W])stack.push(cur-W);
   if(cur<W*(H-1) && !visited[cur+W])stack.push(cur+W);
 }
 ctx.putImageData(image,0,0);
}
function applyOp(op){paintOp(offCtx,op);syncVisibleCanvas();}
function syncVisibleCanvas(){const c=$('#paintCanvas');if(c)c.getContext('2d').drawImage(offscreen,0,0);}
function rebuildCanvas(ops){blankCanvas();for(const op of ops)paintOp(offCtx,op);syncVisibleCanvas();}
async function ensurePoster(){
 if(!state||state.phase!=='results'||state.artwork||myPlayer().role==='Composer'||!session)return;
 const key=`${state.code}-${state.round}`;
 if(uploadedPosterFor===key)return;
 uploadedPosterFor=key;
 await new Promise(resolve=>offscreen.toBlob(async blob=>{
   if(!blob)return resolve();
   const body=new FormData();body.append('clientId',session.clientId);body.append('authToken',session.authToken);body.append('artwork',blob,'masterpiece.png');
   try{await fetch(`/api/rooms/${state.code}/artwork`,{method:'POST',body});}catch{}
   resolve();
 },'image/png'));
}
window.addEventListener('keydown',e=>{
 if(!state||state.phase!=='creation'||myPlayer().role==='Composer'||myPlayer().created)return;
 if(['INPUT','TEXTAREA'].includes(document.activeElement?.tagName))return;
 const k=e.key.toLowerCase();
 if((e.ctrlKey||e.metaKey)&&k==='z'){e.preventDefault();send(e.shiftKey?'draw:redo':'draw:undo');return;}
 if(e.ctrlKey||e.metaKey||e.altKey)return;
 if(k==='b')setTool('brush');else if(k==='e')setTool('eraser');else if(k==='g')setTool('bucket');else if(k==='i')setTool('dropper');
});
socket.on('connect',()=>{
 if(session?.code)socket.emit('room:join',{code:session.code,name:session.name,clientId:session.clientId,authToken:session.authToken},response=>{
   if(!response?.ok){toast(response?.error||'Could not rejoin.',true);session=null;sessionStorage.removeItem('sloptic-session');state=null;render();}
 });
 else render();
});
socket.on('disconnect',()=>{if(state)toast('Connection lost. Reconnecting automatically…',true);render();});
socket.on('room:state',next=>{
 const oldPhase=state?.phase,oldRound=state?.round;
 state=next;
 clockOffset=next.serverNow-Date.now();
 if(oldPhase!==state.phase || oldRound!==state.round){ongoingStroke=null;if(state.phase==='planning')draftPrompt='';if(state.phase==='lobby'){uploadedPosterFor=null;uploadProgress=null;}}
 if(next.canvasOps)rebuildCanvas(next.canvasOps);
 else if((oldPhase!==state.phase || oldRound!==state.round) && state.phase==='creation')blankCanvas();
 render();
});
socket.on('draw:op',op=>{
 if(state?.phase!=='creation')return;
 if(op.actorId===state.myId)return; // Locally painted already.
 applyOp(op);
});
render();
})();
