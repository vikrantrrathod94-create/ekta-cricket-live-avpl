const express = require('express');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const multer = require('multer');
const { nanoid } = require('nanoid');

const app = express();
const PORT = process.env.PORT || 10000;

app.use(cors());
app.use(express.json());
app.use('/public', express.static(path.join(__dirname, 'public')));

const DB_FILE = path.join(__dirname, 'db.json');
function readDB(){ try{ const txt = fs.readFileSync(DB_FILE,'utf8'); return JSON.parse(txt||'{}'); } catch(e){ return { teams:[], players:[], matches:[], currentMatch:null }; } }
function writeDB(data){ try{ fs.writeFileSync(DB_FILE, JSON.stringify(data,null,2),'utf8'); return true; } catch(e){ return false; } }

const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    const typ = req.body.type || req.query.type || req.params.type;
    if(typ === 'team') cb(null, path.join(__dirname,'public','assets','teams'));
    else cb(null, path.join(__dirname,'public','assets','players'));
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname) || '.png';
    cb(null, Date.now() + '-' + Math.random().toString(36).slice(2,8) + ext);
  }
});
const upload = multer({ storage });

let clients = [];
function sendEvent(data){
  const payload = `data: ${JSON.stringify(data)}\n\n`;
  clients.forEach(res=>{ try{ res.write(payload);}catch(e){} });
}

app.get('/api/public', (req,res)=>{
  const db = readDB();
  res.json(db);
});

app.post('/api/admin/addTeam', upload.single('logo'), (req,res)=>{
  const { name, short } = req.body;
  const db = readDB();
  const id = nanoid(8);
  const team = { id, name: name||('Team '+id), short: short||'', logo: req.file ? ('/public/assets/teams/' + req.file.filename) : '/public/assets/logo.png' };
  db.teams.push(team);
  writeDB(db);
  res.json({ ok:true, team });
});

app.post('/api/admin/addPlayer', upload.single('photo'), (req,res)=>{
  const { name, role, jersey, teamId } = req.body;
  const db = readDB();
  const id = nanoid(8);
  const player = { id, name: name||('Player '+id), role: role||'', jersey: jersey||'', teamId: teamId||null, photo: req.file?('/public/assets/players/'+req.file.filename):'/public/assets/logo.png', stats:{runs:0,balls:0,wickets:0} };
  db.players.push(player);
  writeDB(db);
  res.json({ ok:true, player });
});

app.post('/api/admin/createMatch', (req,res)=>{
  const { teamAId, teamBId, overs } = req.body;
  const db = readDB();
  const teamA = db.teams.find(t=>t.id===teamAId) || null;
  const teamB = db.teams.find(t=>t.id===teamBId) || null;
  if(!teamA || !teamB) return res.status(400).json({ error:'invalid teams' });
  const match = { id: nanoid(8), teamAId, teamBId, overs: Number(overs||20), innings:{ battingTeam:null, runs:0, wickets:0, overs:0, balls:0, ballsLog:[] }, status:'not_started' };
  db.matches.push(match);
  db.currentMatch = match;
  writeDB(db);
  sendEvent({ type:'match_created', match });
  res.json({ ok:true, match });
});

app.post('/api/admin/startInnings', (req,res)=>{
  const { battingTeam } = req.body;
  const db = readDB();
  if(!db.currentMatch) return res.status(400).json({ error:'no_match' });
  db.currentMatch.innings = { battingTeam, runs:0, wickets:0, overs:0, balls:0, ballsLog:[] };
  db.currentMatch.status = 'live';
  writeDB(db);
  sendEvent({ type:'start_innings', match: db.currentMatch });
  res.json({ ok:true, match: db.currentMatch });
});

app.post('/api/admin/addBall', (req,res)=>{
  const { runs, isWicket, extra } = req.body;
  const db = readDB();
  const m = db.currentMatch;
  if(!m || m.status!=='live') return res.status(400).json({ error:'no_live_match' });
  const entry = { id: nanoid(8), runs: Number(runs||0), isWicket: !!isWicket, extra: extra||'', time: Date.now() };
  const legal = !(entry.extra==='wide' || entry.extra==='no-ball');
  if(legal){
    m.innings.runs += entry.runs;
    if(entry.isWicket) m.innings.wickets += 1;
    m.innings.balls += 1;
    if(m.innings.balls >= 6){ m.innings.overs += 1; m.innings.balls = 0; }
  } else {
    m.innings.runs += (entry.runs + 1);
  }
  m.innings.ballsLog.push(entry);
  writeDB(db);
  sendEvent({ type:'ball', match: m, lastBall: entry });
  res.json({ ok:true, match: m, lastBall: entry });
});

app.get('/api/stream', (req,res)=>{
  res.set({ 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', Connection:'keep-alive' });
  res.flushHeaders();
  res.write('retry: 2000\n\n');
  clients.push(res);
  req.on('close', ()=>{ clients = clients.filter(c=>c!==res); });
});

app.get('/', (req,res)=>{ res.redirect('/public/index.html'); });

app.listen(PORT, ()=>console.log('✅ Server running on port', PORT));
