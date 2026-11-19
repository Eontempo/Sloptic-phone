'use strict';
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const { spawn, spawnSync } = require('child_process');
const express = require('express');
const multer = require('multer');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  maxHttpBufferSize: 1.5e6,
  transports: ['websocket', 'polling'],
  pingTimeout: 25000
});
const PORT = process.env.PORT || 3000;
const UPLOAD_DIR = path.join(__dirname, 'uploads');
const MAX_AUDIO_MB = Number(process.env.MAX_AUDIO_MB || 200);
const FFMPEG_PATH = process.env.FFMPEG_PATH || 'ffmpeg';
const ffmpegAvailable = spawnSync(FFMPEG_PATH,['-version'],{stdio:'ignore',timeout:3000}).status===0;
let exportsActive = 0;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
const rooms = new Map();
const roomCharset = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const safeString = (value, length) => String(value || '').replace(/[\u0000-\u001F\u007F]/g, ' ').trim().slice(0, length);
const isID = value => typeof value === 'string' && /^[a-f0-9-]{12,80}$/i.test(value);
function uniqueCode() {
  let code;
  do { code = Array.from(crypto.randomBytes(6), v => roomCharset[v % roomCharset.length]).join(''); } while (rooms.has(code));
  return code;
}
function ackSend(ack, body) { if (typeof ack === 'function') ack(body); }
function findPlayer(room, id) { return room?.players.find(p => p.id === id); }
function publicPlayer(p) {
  return { id: p.id, name: p.name, role: p.role, online: !!p.socketId, isHost: false,
    promptSubmitted: !!p.promptSubmitted, created: !!p.created, finished: !!p.finished };
}
function roomScores(room) {
  return room.players.map(p => {
    const votes = room.players.map(v => room.ratings[v.id]?.[p.id]).filter(v => Number.isInteger(v));
    const total = votes.reduce((a,b)=>a+b,0);
    return { id:p.id, total, votes: votes.length, max:15, mvp:total===15 && votes.length===3 };
  });
}
function stateFor(room, player, includeOps=false) {
  const recipient = room.promptMap[player.id];
  const sender = Object.keys(room.promptMap).find(id => room.promptMap[id]===player.id);
  const partner = room.players.find(p => p.role && p.role.includes('Artist') && p.id !== player.id);
  const destination = room.players.find(p => p.id === recipient);
  return {
    code: room.code, phase: room.phase, modeMinutes: room.modeMinutes,
    hostId: room.hostId, myId: player.id, serverNow: Date.now(),
    deadline: room.deadline, round: room.round, players: room.players.map(p => ({...publicPlayer(p), isHost:p.id===room.hostId})),
    recipient: destination ? {name:destination.name, role:destination.role, id:destination.id} : null,
    myPrompt: room.phase==='creation' || room.phase==='results' ? (room.prompts[sender] || '') : '',
    partnerPrompt: partner && (room.phase==='creation' || room.phase==='results') ?
      (room.prompts[Object.keys(room.promptMap).find(id=>room.promptMap[id]===partner.id)] || '') : '',
    partnerName: partner?.name || '',
    mySubmittedPrompt: room.phase==='planning' ? (room.prompts[player.id] || '') : '',
    audio: room.audio ? {url:room.audio.url, name:room.audio.name, size:room.audio.size} : null,
    artwork: room.artwork, videoExport: ffmpegAvailable,
    scores: roomScores(room),
    ratings: room.ratings[player.id] || {},
    ratingsComplete: room.players.filter(p => p.finished).length,
    ...(includeOps ? {canvasOps:room.canvasOps} : {})
  };
}
function emitRoom(room, includeOps=false) {
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit('room:state', stateFor(room, player, includeOps));
  }
}
function removeUploaded(url) {
  if (!url || !/^\/uploads\/[\w-]+\.(?:mp3|png)$/.test(url)) return;
  fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(()=>{});
}
function resetLobby(room) {
  room.phase='lobby'; room.modeMinutes=null; room.deadline=null; room.promptMap={}; room.prompts={};
  room.ratings={}; room.canvasOps=[]; room.redo={};
  for (const p of room.players) {p.role=null; p.promptSubmitted=false; p.created=false; p.finished=false;}
  removeUploaded(room.artwork); removeUploaded(room.audio?.url);
  room.artwork=null; room.audio=null; room.lastTouched=Date.now();
  emitRoom(room, true);
}
function enterResults(room) {
  if (room.phase!=='creation') return;
  room.phase='results'; room.deadline=null; room.lastTouched=Date.now();
  room.ratings={};
  for (const p of room.players) p.finished=false;
  emitRoom(room, true);
}
function enterCreation(room) {
  if (room.phase!=='planning') return;
  for (const p of room.players) {
    if (!room.promptSubmitted?.[p.id] && !p.promptSubmitted) {
      room.prompts[p.id] = 'Create a surprising little masterpiece!';
    }
  }
  room.phase='creation'; room.deadline=Date.now() + room.modeMinutes*60000;
  room.canvasOps=[]; room.redo={}; room.audio=null; room.artwork=null;
  for (const p of room.players) p.created=false;
  emitRoom(room, true);
}
function enterPlanning(room) {
  room.round++;
  room.phase='planning'; room.deadline=Date.now()+60000; room.prompts={}; room.promptMap={};
  // With exactly three players there are two possible no-self assignments.
  // Alternating the cycle guarantees a different recipient in consecutive rounds.
  room.lastDirection = room.lastDirection === 1 ? -1 : 1;
  const n=room.players.length;
  for(let i=0;i<n;i++) room.promptMap[room.players[i].id] = room.players[(i+ (room.lastDirection===1?1:2))%n].id;
  for (const p of room.players) {p.promptSubmitted=false; p.created=false; p.finished=false;}
  emitRoom(room, true);
}
function roomOf(socket) { return rooms.get(socket.data.code); }
function validMember(socket, ack) {
  const room=roomOf(socket); const p=findPlayer(room, socket.data.playerId);
  if (!room || !p || p.socketId!==socket.id) {ackSend(ack,{ok:false,error:'Your room session expired. Rejoin the room.'}); return null;}
  room.lastTouched=Date.now();
  return {room,p};
}
function requirePhase(socket, phase, ack) {
  const v=validMember(socket,ack); if (!v) return null;
  if (v.room.phase!==phase) {ackSend(ack,{ok:false,error:'That action is unavailable during this phase.'});return null;}
  return v;
}

io.on('connection', socket => {
  socket.on('room:create', (data={},ack) => {
    const name=safeString(data.name,22); const id=data.clientId; const token=data.authToken;
    if (!name || !isID(id) || !isID(token)) return ackSend(ack,{ok:false,error:'Please enter a name to play.'});
    const code=uniqueCode();
    const p={id,authToken:token,name,role:null,socketId:socket.id,promptSubmitted:false,created:false,finished:false};
    const room={code,hostId:id,players:[p],phase:'lobby',modeMinutes:null,deadline:null,round:0,
      promptMap:{},prompts:{},canvasOps:[],redo:{},ratings:{},audio:null,artwork:null,
      lastDirection:-1,lastTouched:Date.now()};
    rooms.set(code,room); socket.data={code,playerId:id}; socket.join(code);
    ackSend(ack,{ok:true,code}); emitRoom(room,true);
  });
  socket.on('room:join', (data={},ack) => {
    const code=safeString(data.code,6).toUpperCase(); const name=safeString(data.name,22); const id=data.clientId; const token=data.authToken;
    if(!name || !isID(id) || !isID(token)) return ackSend(ack,{ok:false,error:'Enter your name first.'});
    const room=rooms.get(code);
    if(!room) return ackSend(ack,{ok:false,error:'Room not found. Double-check the invite code.'});
    let p=findPlayer(room,id);
    if(p && p.authToken!==token)return ackSend(ack,{ok:false,error:'That session belongs to another player.'});
    if(!p && room.players.length===3) return ackSend(ack,{ok:false,error:'This room is full (3 players maximum).'});
    if(!p && room.phase!=='lobby') return ackSend(ack,{ok:false,error:'A round is already running. Join the next one.'});
    if(!p) {p={id,authToken:token,name,role:null,socketId:null,promptSubmitted:false,created:false,finished:false};room.players.push(p);}
    if(p.socketId && p.socketId!==socket.id) {const old=io.sockets.sockets.get(p.socketId); if(old) old.disconnect(true);}
    p.socketId=socket.id; p.name=name; socket.data={code,playerId:id}; socket.join(code);
    room.lastTouched=Date.now();
    ackSend(ack,{ok:true,code}); emitRoom(room,true);
  });
  socket.on('room:sync', (_,ack) => {
    const v=validMember(socket,ack); if(!v)return;
    socket.emit('room:state',stateFor(v.room,v.p,true)); ackSend(ack,{ok:true});
  });
  socket.on('room:mode', (data={},ack) => {
    const v=requirePhase(socket,'lobby',ack); if(!v)return;
    if(v.p.id!==v.room.hostId) return ackSend(ack,{ok:false,error:'Only the host can choose the round length.'});
    if(![5,10,15].includes(data.minutes))return ackSend(ack,{ok:false,error:'Choose 5, 10, or 15 minutes.'});
    v.room.modeMinutes=data.minutes; ackSend(ack,{ok:true});emitRoom(v.room);
  });
  socket.on('room:role', (data={},ack) => {
    const v=requirePhase(socket,'lobby',ack);if(!v)return;
    if(!['Artist 1','Artist 2','Composer'].includes(data.role))return ackSend(ack,{ok:false,error:'Select an available role.'});
    if(v.room.players.some(p=>p.id!==v.p.id && p.role===data.role)) return ackSend(ack,{ok:false,error:'That role has already been taken.'});
    v.p.role=data.role;ackSend(ack,{ok:true});emitRoom(v.room);
  });
  socket.on('room:start',(_,ack)=>{
    const v=requirePhase(socket,'lobby',ack);if(!v)return;
    if(v.p.id!==v.room.hostId)return ackSend(ack,{ok:false,error:'Only the host can start the match.'});
    if(v.room.players.length!==3 || v.room.players.some(p=>!p.socketId))return ackSend(ack,{ok:false,error:'Three connected players are required.'});
    if(!v.room.modeMinutes || new Set(v.room.players.map(p=>p.role)).size!==3 || v.room.players.some(p=>!p.role))
      return ackSend(ack,{ok:false,error:'Pick a game mode and fill all three roles first.'});
    ackSend(ack,{ok:true}); enterPlanning(v.room);
  });
  socket.on('planning:submit',(data={},ack)=>{
    const v=requirePhase(socket,'planning',ack);if(!v)return;
    const prompt=safeString(data.prompt,240);
    if(!prompt)return ackSend(ack,{ok:false,error:'Write a prompt before submitting.'});
    if(v.p.promptSubmitted)return ackSend(ack,{ok:false,error:'Your prompt is already locked in.'});
    v.p.promptSubmitted=true;v.room.prompts[v.p.id]=prompt;
    ackSend(ack,{ok:true});
    if(v.room.players.every(p=>p.promptSubmitted))enterCreation(v.room); else emitRoom(v.room);
  });
  socket.on('draw:op',(data={})=>{
    const v=roomOf(socket);const p=findPlayer(v,socket.data.playerId);
    if(!v || !p || p.socketId!==socket.id || v.phase!=='creation' || p.role==='Composer' || p.created)return;
    if(v.canvasOps.length>140000)return;
    if(!['segment','dot','fill'].includes(data.type) || typeof data.actionId!=='string' || !/^[a-f0-9-]{12,80}$/i.test(data.actionId))return;
    if(!/^#[a-f0-9]{6}$/i.test(data.color))return;
    const x=Number(data.x), y=Number(data.y), x2=Number(data.x2), y2=Number(data.y2);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>1600||y<0||y>900)return;
    if(data.type==='segment' && (!Number.isFinite(x2)||!Number.isFinite(y2)||x2<0||x2>1600||y2<0||y2>900))return;
    const op={type:data.type,actionId:data.actionId,actorId:p.id,color:data.color,
      opacity:Math.max(0.01,Math.min(1,Number(data.opacity)||1)),size:Math.max(1,Math.min(72,Number(data.size)||12)),
      x,y,...(data.type==='segment'?{x2,y2}:{})};
    v.canvasOps.push(op);v.redo[p.id]=[];
    socket.to(v.code).emit('draw:op',op);
  });
  socket.on('draw:undo',(_,ack)=>{
    const v=requirePhase(socket,'creation',ack); if(!v)return;
    if(v.p.role==='Composer'||v.p.created)return;
    const ops=v.room.canvasOps;let id=null;
    for(let i=ops.length-1;i>=0;i--)if(ops[i].actorId===v.p.id){id=ops[i].actionId;break;}
    if(!id)return ackSend(ack,{ok:false,error:'Nothing left to undo.'});
    const removed=ops.filter(op=>op.actionId===id&&op.actorId===v.p.id);
    v.room.canvasOps=ops.filter(op=>!(op.actionId===id&&op.actorId===v.p.id));
    (v.room.redo[v.p.id] ||= []).push(removed);
    ackSend(ack,{ok:true});emitRoom(v.room,true);
  });
  socket.on('draw:redo',(_,ack)=>{
    const v=requirePhase(socket,'creation',ack);if(!v)return;
    if(v.p.role==='Composer'||v.p.created)return;
    const ops=(v.room.redo[v.p.id]||[]).pop();
    if(!ops)return ackSend(ack,{ok:false,error:'Nothing left to redo.'});
    v.room.canvasOps.push(...ops); ackSend(ack,{ok:true});emitRoom(v.room,true);
  });
  socket.on('creation:submit',(_,ack)=>{
    const v=requirePhase(socket,'creation',ack);if(!v)return;
    if(v.p.created)return ackSend(ack,{ok:true});
    if(v.p.role==='Composer'&&!v.room.audio)return ackSend(ack,{ok:false,error:'Upload an MP3 before submitting your music.'});
    v.p.created=true;ackSend(ack,{ok:true});
    if(v.room.players.every(p=>p.created))enterResults(v.room);else emitRoom(v.room);
  });
  socket.on('rating:vote',(data={},ack)=>{
    const v=requirePhase(socket,'results',ack);if(!v)return;
    if(v.p.finished)return ackSend(ack,{ok:false,error:'Your ratings are locked after finishing.'});
    if(!v.room.players.find(p=>p.id===data.targetId) || !Number.isInteger(data.stars)||data.stars<0||data.stars>5)
      return ackSend(ack,{ok:false,error:'Choose a rating between 0 and 5.'});
    (v.room.ratings[v.p.id] ||= {})[data.targetId]=data.stars;
    ackSend(ack,{ok:true});emitRoom(v.room);
  });
  socket.on('room:finish',(_,ack)=>{
    const v=requirePhase(socket,'results',ack);if(!v)return;
    v.p.finished=true;ackSend(ack,{ok:true});
    if(v.room.players.every(p=>p.finished))resetLobby(v.room);else emitRoom(v.room);
  });
  socket.on('disconnect',()=>{
    const room=roomOf(socket);const p=findPlayer(room,socket.data.playerId);
    if(!room || !p || p.socketId!==socket.id)return;
    p.socketId=null;room.lastTouched=Date.now();
    if(room.hostId===p.id){const online=room.players.find(m=>m.socketId);if(online)room.hostId=online.id;}
    emitRoom(room);
  });
});

const audioUpload=multer({
  storage:multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>cb(null,crypto.randomUUID()+'.mp3')}),
  limits:{fileSize:MAX_AUDIO_MB*1024*1024,files:1}
}).single('audio');
const artworkUpload=multer({
  storage:multer.diskStorage({destination:UPLOAD_DIR,filename:(req,file,cb)=>cb(null,crypto.randomUUID()+'.png')}),
  limits:{fileSize:15*1024*1024,files:1}
}).single('artwork');
function uploadMiddleware(handler) {
  return (req,res,next)=>handler(req,res,err=>{
    if(err)return res.status(413).json({ok:false,error:err.code==='LIMIT_FILE_SIZE'?'File exceeds the upload limit.': 'Upload failed.'});
    next();
  });
}
app.post('/api/rooms/:code/music',uploadMiddleware(audioUpload),async(req,res)=>{
  const file=req.file;const room=rooms.get(String(req.params.code).toUpperCase());
  const player=findPlayer(room,req.body.clientId);
  const authorized=player && player.authToken===req.body.authToken;
  const fail=(status,error)=>{if(file)removeUploaded('/uploads/'+file.filename);return res.status(status).json({ok:false,error});};
  if(!room||!authorized||player.role!=='Composer'||room.phase!=='creation'||player.created)
    return fail(403,'Music uploads are only available to the active composer.');
  if(!file)return fail(400,'Choose an MP3 file first.');
  const head=Buffer.alloc(4);
  const fh=await fs.promises.open(file.path,'r');try{await fh.read(head,0,4,0);}finally{await fh.close();}
  const looksLikeMP3=head.subarray(0,3).toString()==='ID3'||(head[0]===0xff&&(head[1]&0xe0)===0xe0);
  if(!looksLikeMP3 || !/\.mp3$/i.test(file.originalname))return fail(415,'Upload a valid .mp3 audio file.');
  removeUploaded(room.audio?.url);
  room.audio={url:'/uploads/'+file.filename,name:safeString(file.originalname,110),size:file.size};
  res.json({ok:true,audio:room.audio}); emitRoom(room);
});
app.post('/api/rooms/:code/artwork',uploadMiddleware(artworkUpload),async(req,res)=>{
  const file=req.file;const room=rooms.get(String(req.params.code).toUpperCase());
  const player=findPlayer(room,req.body.clientId);
  const authorized=player && player.authToken===req.body.authToken;
  const fail=(status,error)=>{if(file)removeUploaded('/uploads/'+file.filename);return res.status(status).json({ok:false,error});};
  if(!room||!authorized||player.role==='Composer'||room.phase!=='results')return fail(403,'Artwork upload is unavailable.');
  if(room.artwork)return fail(409,'Artwork is already saved.');
  if(!file)return fail(400,'No artwork was received.');
  const buf=Buffer.alloc(8);const f=await fs.promises.open(file.path,'r');try{await f.read(buf,0,8,0);}finally{await f.close();}
  if(buf.toString('hex')!=='89504e470d0a1a0a')return fail(415,'Invalid PNG artwork.');
  room.artwork='/uploads/'+file.filename;res.json({ok:true,url:room.artwork});emitRoom(room);
});
// Optional zero-copy, streamed MP4 export. The drawing is a static video track,
// with the original MP3 remastered to high-bitrate AAC. ffmpeg is auto-detected.
app.get('/api/rooms/:code/export.mp4',(req,res)=>{
  const room=rooms.get(String(req.params.code).toUpperCase());
  if(!room||room.phase!=='results'||!room.artwork||!room.audio)return res.status(404).json({ok:false,error:'The completed artwork and soundtrack are not ready.'});
  if(!ffmpegAvailable)return res.status(503).json({ok:false,error:'MP4 export requires FFmpeg on the server.'});
  if(exportsActive>=2)return res.status(429).json({ok:false,error:'Exports are busy. Try again in a moment.'});
  const art=path.join(UPLOAD_DIR,path.basename(room.artwork)),music=path.join(UPLOAD_DIR,path.basename(room.audio.url));
  exportsActive++;
  const worker=spawn(FFMPEG_PATH,[
    '-hide_banner','-loglevel','error',
    '-loop','1','-framerate','1','-i',art,'-i',music,
    '-map','0:v:0','-map','1:a:0',
    '-c:v','libx264','-preset','veryfast','-tune','stillimage','-crf','18',
    '-c:a','aac','-b:a','320k','-pix_fmt','yuv420p',
    '-shortest','-movflags','frag_keyframe+empty_moov+default_base_moof',
    '-f','mp4','pipe:1'
  ]);
  let closed=false;
  const release=()=>{if(!closed){closed=true;exportsActive--;}};
  res.setHeader('Content-Type','video/mp4');
  res.setHeader('Content-Disposition',`attachment; filename=\"sloptic-${room.code}.mp4\"`);
  res.setHeader('Cache-Control','no-store');
  worker.stdout.pipe(res);
  worker.on('close',release);
  worker.on('error',()=>{release();if(!res.headersSent)res.status(500).end('Video export failed.');else res.end();});
  res.on('close',()=>{if(!closed)worker.kill('SIGTERM');});
});
app.get('/api/health',(req,res)=>res.json({ok:true,rooms:rooms.size}));
app.use('/uploads',express.static(UPLOAD_DIR,{setHeaders(res){res.setHeader('Cache-Control','private, max-age=3600');}}));
app.use(express.static(path.join(__dirname,'public')));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

setInterval(()=>{
  const now=Date.now();
  for (const [code,room] of rooms) {
    if(room.deadline && now>=room.deadline) {
      if(room.phase==='planning') enterCreation(room);
      else if(room.phase==='creation') enterResults(room);
    }
    if(now-room.lastTouched>6*60*60*1000 || (!room.players.some(p=>p.socketId) && now-room.lastTouched>30*60*1000)) {
      removeUploaded(room.artwork);removeUploaded(room.audio?.url);rooms.delete(code);
    }
  }
},400);
server.listen(PORT,'0.0.0.0',()=>console.log(`Sloptic Phone running on http://localhost:${PORT}`));
