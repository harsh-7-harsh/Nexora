require('dotenv').config();
const express=require('express');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {Pool}=require('pg');
const app=express();
const PORT=process.env.PORT||3000, HOST=process.env.HOST||'0.0.0.0', ROOT=__dirname;
if(!process.env.DATABASE_URL){console.error('DATABASE_URL missing in .env');process.exit(1)}
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:{rejectUnauthorized:false},max:5});
app.use(express.json({limit:'1mb'}));app.use(express.urlencoded({extended:true}));app.use(express.static(path.join(ROOT,'public')));
const id=p=>`${p}_${crypto.randomBytes(8).toString('hex')}`;
const now=()=>new Date().toISOString();
function hashPassword(password,salt=crypto.randomBytes(16).toString('hex')){return{salt,hash:crypto.scryptSync(password,salt,64).toString('hex')}}
function verifyPassword(password,u){const a=crypto.scryptSync(password,u.salt,64),b=Buffer.from(u.passwordHash,'hex');return a.length===b.length&&crypto.timingSafeEqual(a,b)}
const cleanUser=u=>({id:u.id,name:u.name,email:u.email,createdAt:u.createdAt});
const priority=v=>['Low','Medium','High'].includes(String(v))?String(v):'Medium';
const progress=v=>Number.isFinite(Number(v))?Math.max(0,Math.min(100,Math.round(Number(v)))):0;

async function initDb(){await pool.query(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,email TEXT UNIQUE NOT NULL,salt TEXT NOT NULL,password_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS tasks(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,due TEXT NOT NULL,tag TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'Medium',done BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS notes(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,body TEXT NOT NULL DEFAULT '',created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,title TEXT NOT NULL,small TEXT NOT NULL DEFAULT '',cover TEXT NOT NULL DEFAULT 'purple',progress INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'in-progress',created_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS focus_sessions(id TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id) ON DELETE CASCADE,minutes INTEGER NOT NULL,session_date DATE NOT NULL,completed_at TIMESTAMPTZ NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);CREATE INDEX IF NOT EXISTS idx_focus_user ON focus_sessions(user_id);`);}

async function auth(req,res,next){try{const h=req.headers.authorization||'',token=h.startsWith('Bearer ')?h.slice(7):null;if(!token)return res.status(401).json({error:'Authentication required'});const q=await pool.query(`SELECT s.token,s.expires_at,u.id,u.name,u.email,u.created_at,u.salt,u.password_hash FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=$1 AND s.expires_at>NOW()`,[token]);if(!q.rowCount)return res.status(401).json({error:'Session expired. Please log in again.'});const r=q.rows[0];req.token=token;req.user={id:r.id,name:r.name,email:r.email,createdAt:r.created_at,salt:r.salt,passwordHash:r.password_hash};next()}catch(e){next(e)}}

async function statsFor(uid){
const q=await pool.query(`SELECT (SELECT COUNT(*) FROM tasks WHERE user_id=$1)::int tasks,(SELECT COUNT(*) FROM tasks WHERE user_id=$1 AND done)::int completed_tasks,(SELECT COUNT(*) FROM notes WHERE user_id=$1)::int notes,(SELECT COUNT(*) FROM projects WHERE user_id=$1)::int projects,(SELECT COALESCE(SUM(minutes),0) FROM focus_sessions WHERE user_id=$1)::int focus_minutes,(SELECT COALESCE(ROUND(AVG(progress)),0) FROM projects WHERE user_id=$1)::int project_progress`,[uid]);
const r=q.rows[0],totalXp=r.completed_tasks*35+r.focus_minutes+r.notes*12+r.projects*70;
const dates=await pool.query(`SELECT DISTINCT session_date::text date FROM focus_sessions WHERE user_id=$1 ORDER BY date DESC`,[uid]);
let streak=0;if(dates.rowCount){let prev=new Date(dates.rows[0].date+'T00:00:00Z');streak=1;for(let i=1;i<dates.rows.length;i++){const d=new Date(dates.rows[i].date+'T00:00:00Z');if(Math.round((prev-d)/86400000)!==1)break;streak++;prev=d}streak=Math.min(30,streak)}
return{tasks:r.tasks,completedTasks:r.completed_tasks,notes:r.notes,projects:r.projects,focusMinutes:r.focus_minutes,projectProgress:r.project_progress,level:Math.max(1,Math.floor(totalXp/250)+1),xp:totalXp%250,totalXp,streak}
}

async function userData(uid){
const [t,n,p,s]=await Promise.all([
pool.query(`SELECT id,user_id "userId",title,due,tag,priority,done,created_at "createdAt" FROM tasks WHERE user_id=$1 ORDER BY created_at DESC`,[uid]),
pool.query(`SELECT id,user_id "userId",title,body,created_at "createdAt" FROM notes WHERE user_id=$1 ORDER BY created_at DESC`,[uid]),
pool.query(`SELECT id,user_id "userId",title,small,cover,progress,status,created_at "createdAt" FROM projects WHERE user_id=$1 ORDER BY created_at DESC`,[uid]),
statsFor(uid)]);
return{tasks:t.rows,notes:n.rows,projects:p.rows,stats:s}
}

app.get('/api/health',async(_q,res,next)=>{try{await pool.query('SELECT 1');res.json({ok:true,service:'NEXORA API',database:'PostgreSQL',time:now()})}catch(e){next(e)}});

app.post('/api/auth/register',async(req,res,next)=>{try{
const name=String(req.body.name||'').trim(),email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||'');
if(name.length<2)return res.status(400).json({error:'Name must be at least 2 characters'});
if(!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Enter a valid email'});
if(password.length<6)return res.status(400).json({error:'Password must be at least 6 characters'});
if((await pool.query('SELECT 1 FROM users WHERE email=$1',[email])).rowCount)return res.status(409).json({error:'An account with this email already exists'});
const {salt,hash}=hashPassword(password),u={id:id('usr'),name,email,salt,passwordHash:hash,createdAt:now()};
await pool.query('INSERT INTO users VALUES($1,$2,$3,$4,$5,$6)',[u.id,u.name,u.email,u.salt,u.passwordHash,u.createdAt]);
const token=id('sess');await pool.query("INSERT INTO sessions VALUES($1,$2,NOW()+INTERVAL '30 days')",[token,u.id]);
res.status(201).json({token,user:cleanUser(u),data:await userData(u.id)})
}catch(e){next(e)}});

app.post('/api/auth/login',async(req,res,next)=>{try{
const email=String(req.body.email||'').trim().toLowerCase(),password=String(req.body.password||''),q=await pool.query('SELECT id,name,email,salt,password_hash "passwordHash",created_at "createdAt" FROM users WHERE email=$1',[email]),u=q.rows[0];
if(!u||!verifyPassword(password,u))return res.status(401).json({error:'Invalid email or password'});
await pool.query('DELETE FROM sessions WHERE expires_at<=NOW()');
const token=id('sess');await pool.query("INSERT INTO sessions VALUES($1,$2,NOW()+INTERVAL '30 days')",[token,u.id]);
res.json({token,user:cleanUser(u),data:await userData(u.id)})
}catch(e){next(e)}});

app.post('/api/auth/logout',auth,async(req,res,next)=>{try{await pool.query('DELETE FROM sessions WHERE token=$1',[req.token]);res.json({ok:true})}catch(e){next(e)}});
app.get('/api/auth/me',auth,async(req,res,next)=>{try{res.json({user:cleanUser(req.user),data:await userData(req.user.id)})}catch(e){next(e)}});
app.get('/api/bootstrap',auth,async(req,res,next)=>{try{res.json(await userData(req.user.id))}catch(e){next(e)}});

app.post('/api/tasks',auth,async(req,res,next)=>{try{
const title=String(req.body.title||'').trim();if(!title)return res.status(400).json({error:'Task title is required'});
const t={id:id('task'),userId:req.user.id,title,due:String(req.body.due||'Today'),tag:String(req.body.tag||'Practice'),priority:priority(req.body.priority),done:false,createdAt:now()};
await pool.query('INSERT INTO tasks VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[t.id,t.userId,t.title,t.due,t.tag,t.priority,t.done,t.createdAt]);
res.status(201).json(t)
}catch(e){next(e)}});

app.patch('/api/tasks/:id',auth,async(req,res,next)=>{try{
const q=await pool.query('SELECT * FROM tasks WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
if(!q.rowCount)return res.status(404).json({error:'Not found'});
const x=q.rows[0],title=req.body.title!==undefined?String(req.body.title).trim():x.title;
if(!title)return res.status(400).json({error:'Task title is required'});
const r=await pool.query(`UPDATE tasks SET title=$1,due=$2,tag=$3,priority=$4,done=$5 WHERE id=$6 AND user_id=$7 RETURNING id,user_id "userId",title,due,tag,priority,done,created_at "createdAt"`,
[title,req.body.due!==undefined?String(req.body.due):x.due,req.body.tag!==undefined?String(req.body.tag):x.tag,priority(req.body.priority!==undefined?req.body.priority:x.priority),req.body.done!==undefined?Boolean(req.body.done):x.done,req.params.id,req.user.id]);
res.json(r.rows[0])
}catch(e){next(e)}});

app.delete('/api/tasks/:id',auth,async(req,res,next)=>{try{const r=await pool.query('DELETE FROM tasks WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Not found'});res.json({ok:true})}catch(e){next(e)}});

app.post('/api/notes',auth,async(req,res,next)=>{try{
const title=String(req.body.title||'').trim();if(!title)return res.status(400).json({error:'Note title is required'});
const n={id:id('note'),userId:req.user.id,title,body:String(req.body.body||''),createdAt:now()};
await pool.query('INSERT INTO notes VALUES($1,$2,$3,$4,$5)',[n.id,n.userId,n.title,n.body,n.createdAt]);
res.status(201).json(n)
}catch(e){next(e)}});

app.patch('/api/notes/:id',auth,async(req,res,next)=>{try{
const r=await pool.query(`UPDATE notes SET title=COALESCE($1,title),body=COALESCE($2,body) WHERE id=$3 AND user_id=$4 RETURNING id,user_id "userId",title,body,created_at "createdAt"`,
[req.body.title!==undefined?String(req.body.title).trim():null,req.body.body!==undefined?String(req.body.body):null,req.params.id,req.user.id]);
if(!r.rowCount)return res.status(404).json({error:'Not found'});res.json(r.rows[0])
}catch(e){next(e)}});

app.delete('/api/notes/:id',auth,async(req,res,next)=>{try{const r=await pool.query('DELETE FROM notes WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Not found'});res.json({ok:true})}catch(e){next(e)}});

app.post('/api/projects',auth,async(req,res,next)=>{try{
const title=String(req.body.title||'').trim();if(!title)return res.status(400).json({error:'Project title is required'});
const pr=progress(req.body.progress),p={id:id('project'),userId:req.user.id,title,small:String(req.body.small||`Practice project · ${pr}% complete`),cover:String(req.body.cover||'purple'),progress:pr,status:pr>=100?'complete':'in-progress',createdAt:now()};
await pool.query('INSERT INTO projects VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[p.id,p.userId,p.title,p.small,p.cover,p.progress,p.status,p.createdAt]);
res.status(201).json(p)
}catch(e){next(e)}});

app.patch('/api/projects/:id',auth,async(req,res,next)=>{try{
const q=await pool.query('SELECT * FROM projects WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);
if(!q.rowCount)return res.status(404).json({error:'Not found'});
const x=q.rows[0],pr=req.body.progress!==undefined?progress(req.body.progress):x.progress;
const r=await pool.query(`UPDATE projects SET title=$1,small=$2,cover=$3,progress=$4,status=$5 WHERE id=$6 AND user_id=$7 RETURNING id,user_id "userId",title,small,cover,progress,status,created_at "createdAt"`,
[req.body.title!==undefined?String(req.body.title).trim():x.title,req.body.small!==undefined?String(req.body.small):x.small,req.body.cover!==undefined?String(req.body.cover):x.cover,pr,req.body.status!==undefined?String(req.body.status):(pr>=100?'complete':'in-progress'),req.params.id,req.user.id]);
res.json(r.rows[0])
}catch(e){next(e)}});

app.delete('/api/projects/:id',auth,async(req,res,next)=>{try{const r=await pool.query('DELETE FROM projects WHERE id=$1 AND user_id=$2',[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Not found'});res.json({ok:true})}catch(e){next(e)}});

app.post('/api/focus/sessions',auth,async(req,res,next)=>{try{
const minutes=Math.round(Number(req.body.minutes||0));if(!Number.isFinite(minutes)||minutes<1)return res.status(400).json({error:'Minutes are required'});
const s={id:id('focus'),userId:req.user.id,minutes:Math.min(minutes,1440),date:new Date().toISOString().slice(0,10),completedAt:now()};
await pool.query('INSERT INTO focus_sessions VALUES($1,$2,$3,$4,$5)',[s.id,s.userId,s.minutes,s.date,s.completedAt]);
res.status(201).json({session:s,stats:await statsFor(req.user.id)})
}catch(e){next(e)}});

app.get('/api/stats',auth,async(req,res,next)=>{try{res.json(await statsFor(req.user.id))}catch(e){next(e)}});
app.get(/^\/(?!api(?:\/|$)).*/,(_q,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
app.use((e,_q,res,_n)=>{console.error(e);res.status(500).json({error:'Server error. Please try again.'})});

initDb().then(()=>app.listen(PORT,HOST,()=>console.log(`\nNEXORA is running at http://localhost:${PORT}\nDatabase: PostgreSQL (Neon)\n`))).catch(e=>{console.error('NEXORA could not start:',e.message);process.exit(1)});