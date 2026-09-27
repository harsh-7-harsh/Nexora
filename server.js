require('dotenv').config();
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL missing. Create a .env file with DATABASE_URL=...');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30000
});

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(ROOT, 'public')));

const id = (prefix) => `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
const now = () => new Date().toISOString();
const cleanText = (value, fallback = '') => String(value ?? fallback).trim();
const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v)));
const priority = (v) => ['Low', 'Medium', 'High'].includes(String(v)) ? String(v) : 'Medium';
const status = (v) => ['planning', 'in-progress', 'complete', 'paused'].includes(String(v)) ? String(v) : 'in-progress';
const progress = (v) => Number.isFinite(Number(v)) ? Math.round(clamp(v, 0, 100)) : 0;
const dateKey = (d = new Date()) => new Date(d).toISOString().slice(0, 10);
const weekKey = (d = new Date()) => { const x = new Date(d); x.setUTCHours(0,0,0,0); const day = x.getUTCDay() || 7; x.setUTCDate(x.getUTCDate() - day + 1); return x.toISOString().slice(0,10); };

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function verifyPassword(password, user) {
  const a = crypto.scryptSync(password, user.salt, 64);
  const b = Buffer.from(user.passwordHash, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function cleanUser(u) {
  return { id: u.id, name: u.name, email: u.email, createdAt: u.createdAt ?? u.created_at };
}

const MODULES = [
  { id: 'mod_01', title: 'Editing fundamentals', skill: 'Cutting & Storytelling', icon: '🎬', description: 'Timeline, clips, bins, trims and the editing mindset.' },
  { id: 'mod_02', title: 'Story & pacing', skill: 'Cutting & Storytelling', icon: '✂️', description: 'Build rhythm, structure scenes and shape viewer attention.' },
  { id: 'mod_03', title: 'Advanced cutting', skill: 'Cutting & Storytelling', icon: '⚡', description: 'J-cuts, L-cuts, match cuts, montage and continuity.' },
  { id: 'mod_04', title: 'Color correction', skill: 'Color Grading', icon: '🎨', description: 'Exposure, white balance, scopes and clean correction.' },
  { id: 'mod_05', title: 'Color grading', skill: 'Color Grading', icon: '🌈', description: 'Looks, contrast, skin tones and cinematic consistency.' },
  { id: 'mod_06', title: 'Sound design', skill: 'Sound Design', icon: '🔊', description: 'Dialogue, ambience, SFX, mixing and loudness basics.' },
  { id: 'mod_07', title: 'Motion graphics', skill: 'Motion Graphics', icon: '✨', description: 'Keyframes, text animation, masks and motion systems.' },
  { id: 'mod_08', title: 'Speed ramps & effects', skill: 'Motion Graphics', icon: '🚀', description: 'Speed changes, transitions and controlled visual effects.' },
  { id: 'mod_09', title: 'Client workflow', skill: 'Workflow & Delivery', icon: '🗂️', description: 'Briefs, versions, feedback, organization and delivery.' },
  { id: 'mod_10', title: 'Portfolio & showreel', skill: 'Workflow & Delivery', icon: '🏆', description: 'Select work, build a showreel and publish with confidence.' }
];

const LESSON_SETS = {
  mod_01: ['Workspace setup', 'Import & organize footage', 'Timeline fundamentals', 'Cut, trim & ripple', 'Export your first edit'],
  mod_02: ['Hook in the first seconds', 'Scene structure', 'Pacing with cut points', 'B-roll for storytelling', 'Rhythm practice'],
  mod_03: ['J-cuts & L-cuts', 'Match cuts', 'Montage construction', 'Continuity techniques', 'Advanced trim practice'],
  mod_04: ['Exposure basics', 'White balance', 'Contrast & black levels', 'Scopes explained', 'Clean correction pass'],
  mod_05: ['Building a look', 'Curves & selective color', 'Skin tone workflow', 'Shot matching', 'Cinematic grade practice'],
  mod_06: ['Dialogue cleanup', 'Room tone & ambience', 'SFX layering', 'Music & ducking', 'Mix & loudness check'],
  mod_07: ['Keyframe fundamentals', 'Text animation', 'Mask animation', 'Easing & timing', 'Motion design practice'],
  mod_08: ['Speed ramp basics', 'Graph editor control', 'Transitions with purpose', 'Effects without clutter', 'Effects practice'],
  mod_09: ['Reading a brief', 'Project organization', 'Versioning & backups', 'Handling feedback', 'Delivery checklist'],
  mod_10: ['Choose your strongest work', 'Before/after presentation', 'Showreel structure', 'Portfolio page polish', 'Publish & review']
};

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      salt TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      due TEXT NOT NULL,
      tag TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'Medium',
      done BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'Idea',
      tags TEXT NOT NULL DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      small TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      cover TEXT NOT NULL DEFAULT 'purple',
      progress INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'in-progress',
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS focus_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      minutes INTEGER NOT NULL,
      session_date DATE NOT NULL,
      completed_at TIMESTAMPTZ NOT NULL
    );
    CREATE TABLE IF NOT EXISTS learning_modules (
      id TEXT PRIMARY KEY,
      position INTEGER NOT NULL UNIQUE,
      title TEXT NOT NULL,
      skill TEXT NOT NULL,
      icon TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS learning_lessons (
      id TEXT PRIMARY KEY,
      module_id TEXT REFERENCES learning_modules(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      title TEXT NOT NULL,
      minutes INTEGER NOT NULL DEFAULT 20,
      xp INTEGER NOT NULL DEFAULT 25,
      UNIQUE(module_id, position)
    );
    CREATE TABLE IF NOT EXISTS lesson_progress (
      user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
      lesson_id TEXT REFERENCES learning_lessons(id) ON DELETE CASCADE,
      completed_at TIMESTAMPTZ NOT NULL,
      PRIMARY KEY(user_id, lesson_id)
    );
    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      weekly_goal_minutes INTEGER NOT NULL DEFAULT 720,
      notifications BOOLEAN NOT NULL DEFAULT TRUE,
      compact_mode BOOLEAN NOT NULL DEFAULT FALSE,
      challenge_week TEXT NOT NULL DEFAULT '',
      challenge_step INTEGER NOT NULL DEFAULT 0,
      challenge_completions INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_tasks_user ON tasks(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id);
    CREATE INDEX IF NOT EXISTS idx_focus_user_date ON focus_sessions(user_id, session_date);
    CREATE INDEX IF NOT EXISTS idx_lessons_module ON learning_lessons(module_id);
  `);

  // Safe migrations for the database created by the previous NEXORA version.
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Idea'`);
  await pool.query(`ALTER TABLE notes ADD COLUMN IF NOT EXISTS tags TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE projects ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`);
  await pool.query(`ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS challenge_completions INTEGER NOT NULL DEFAULT 0`);

  for (const m of MODULES) {
    await pool.query(
      `INSERT INTO learning_modules(id,position,title,skill,icon,description) VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT(id) DO UPDATE SET position=EXCLUDED.position,title=EXCLUDED.title,skill=EXCLUDED.skill,icon=EXCLUDED.icon,description=EXCLUDED.description`,
      [m.id, MODULES.indexOf(m) + 1, m.title, m.skill, m.icon, m.description]
    );
    const lessons = LESSON_SETS[m.id] || [];
    for (let i = 0; i < lessons.length; i++) {
      await pool.query(
        `INSERT INTO learning_lessons(id,module_id,position,title,minutes,xp) VALUES($1,$2,$3,$4,$5,$6)
         ON CONFLICT(id) DO UPDATE SET position=EXCLUDED.position,title=EXCLUDED.title,minutes=EXCLUDED.minutes,xp=EXCLUDED.xp`,
        [`${m.id}_lesson_${i + 1}`, m.id, i + 1, lessons[i], i === lessons.length - 1 ? 30 : 20, 25]
      );
    }
  }
}

async function auth(req, res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const q = await pool.query(`
      SELECT s.token,s.expires_at,u.id,u.name,u.email,u.created_at,u.salt,u.password_hash
      FROM sessions s JOIN users u ON u.id=s.user_id
      WHERE s.token=$1 AND s.expires_at>NOW()
    `, [token]);
    if (!q.rowCount) return res.status(401).json({ error: 'Session expired. Please log in again.' });
    const r = q.rows[0];
    req.token = token;
    req.user = { id: r.id, name: r.name, email: r.email, createdAt: r.created_at, salt: r.salt, passwordHash: r.password_hash };
    next();
  } catch (e) { next(e); }
}

async function getSettings(uid) {
  const q = await pool.query(`SELECT weekly_goal_minutes,notifications,compact_mode,challenge_week,challenge_step,challenge_completions FROM user_settings WHERE user_id=$1`, [uid]);
  if (!q.rowCount) {
    const week = weekKey(new Date());
    await pool.query(`INSERT INTO user_settings(user_id,weekly_goal_minutes,notifications,compact_mode,challenge_week,challenge_step,challenge_completions) VALUES($1,720,TRUE,FALSE,$2,0,0) ON CONFLICT(user_id) DO NOTHING`, [uid, week]);
    return { weeklyGoalMinutes: 720, notifications: true, compactMode: false, challengeWeek: week, challengeStep: 0, challengeCompletions: 0 };
  }
  const r = q.rows[0];
  const week = weekKey(new Date());
  let step = r.challenge_step;
  if (r.challenge_week !== week) {
    await pool.query(`UPDATE user_settings SET challenge_week=$1,challenge_step=0 WHERE user_id=$2`, [week, uid]);
    step = 0;
  }
  return { weeklyGoalMinutes: r.weekly_goal_minutes, notifications: r.notifications, compactMode: r.compact_mode, challengeWeek: week, challengeStep: step, challengeCompletions: r.challenge_completions || 0 };
}

async function streakData(uid) {
  const q = await pool.query(`SELECT DISTINCT session_date::text AS date FROM focus_sessions WHERE user_id=$1 ORDER BY session_date DESC`, [uid]);
  const dates = q.rows.map(r => new Date(`${r.date}T00:00:00Z`));
  let current = 0;
  if (dates.length) {
    let prev = dates[0];
    for (let i = 0; i < dates.length; i++) {
      const diff = Math.round((prev - dates[i]) / 86400000);
      if (i > 0 && diff !== 1) break;
      current += 1;
      prev = dates[i];
    }
  }
  let best = 0;
  if (dates.length) {
    let run = 1;
    best = 1;
    for (let i = 1; i < dates.length; i++) {
      const diff = Math.round((dates[i - 1] - dates[i]) / 86400000);
      if (diff === 1) run += 1; else run = 1;
      best = Math.max(best, run);
    }
  }
  return { current, best };
}

async function statsFor(uid) {
  const [base, lessons, streak] = await Promise.all([
    pool.query(`
      SELECT
        (SELECT COUNT(*) FROM tasks WHERE user_id=$1)::int AS tasks,
        (SELECT COUNT(*) FROM tasks WHERE user_id=$1 AND done)::int AS completed_tasks,
        (SELECT COUNT(*) FROM notes WHERE user_id=$1)::int AS notes,
        (SELECT COUNT(*) FROM projects WHERE user_id=$1)::int AS projects,
        (SELECT COALESCE(SUM(minutes),0) FROM focus_sessions WHERE user_id=$1)::int AS focus_minutes,
        (SELECT COALESCE(ROUND(AVG(progress)),0) FROM projects WHERE user_id=$1)::int AS project_progress
    `, [uid]),
    pool.query(`SELECT COUNT(*)::int AS completed_lessons FROM lesson_progress WHERE user_id=$1`, [uid]),
    streakData(uid)
  ]);
  const r = base.rows[0];
  const completedLessons = lessons.rows[0].completed_lessons;
  const settingsQ = await pool.query(`SELECT challenge_completions FROM user_settings WHERE user_id=$1`, [uid]);
  const challengeCompletions = settingsQ.rows[0]?.challenge_completions || 0;
  const totalXp = r.completed_tasks * 35 + r.focus_minutes + r.notes * 12 + r.projects * 70 + completedLessons * 25 + challengeCompletions * 250;
  return {
    tasks: r.tasks,
    completedTasks: r.completed_tasks,
    notes: r.notes,
    projects: r.projects,
    focusMinutes: r.focus_minutes,
    projectProgress: r.project_progress,
    completedLessons,
    level: Math.max(1, Math.floor(totalXp / 250) + 1),
    xp: totalXp % 250,
    totalXp,
    streak: streak.current,
    bestStreak: streak.best
  };
}

async function userData(uid) {
  const [t, n, p, s, settings, learning] = await Promise.all([
    pool.query(`SELECT id,user_id AS "userId",title,due,tag,priority,done,created_at AS "createdAt" FROM tasks WHERE user_id=$1 ORDER BY created_at DESC`, [uid]),
    pool.query(`SELECT id,user_id AS "userId",title,body,category,tags,created_at AS "createdAt" FROM notes WHERE user_id=$1 ORDER BY created_at DESC`, [uid]),
    pool.query(`SELECT id,user_id AS "userId",title,small,description,cover,progress,status,created_at AS "createdAt" FROM projects WHERE user_id=$1 ORDER BY created_at DESC`, [uid]),
    statsFor(uid),
    getSettings(uid),
    learningData(uid)
  ]);
  return { tasks: t.rows, notes: n.rows, projects: p.rows, stats: s, settings, learning };
}

async function learningData(uid) {
  const q = await pool.query(`
    SELECT m.id AS module_id,m.position,m.title,m.skill,m.icon,m.description,
           l.id AS lesson_id,l.position AS lesson_position,l.title AS lesson_title,l.minutes,l.xp,
           CASE WHEN lp.lesson_id IS NOT NULL THEN TRUE ELSE FALSE END AS completed
    FROM learning_modules m
    JOIN learning_lessons l ON l.module_id=m.id
    LEFT JOIN lesson_progress lp ON lp.lesson_id=l.id AND lp.user_id=$1
    ORDER BY m.position,l.position
  `, [uid]);

  const modules = [];
  for (const row of q.rows) {
    let m = modules.find(x => x.id === row.module_id);
    if (!m) {
      m = { id: row.module_id, position: row.position, title: row.title, skill: row.skill, icon: row.icon, description: row.description, lessons: [] };
      modules.push(m);
    }
    m.lessons.push({ id: row.lesson_id, position: row.lesson_position, title: row.lesson_title, minutes: row.minutes, xp: row.xp, completed: row.completed });
  }
  let previousComplete = true;
  for (const m of modules) {
    const done = m.lessons.filter(l => l.completed).length;
    m.completedLessons = done;
    m.totalLessons = m.lessons.length;
    m.progress = m.totalLessons ? Math.round(done / m.totalLessons * 100) : 0;
    m.unlocked = previousComplete;
    previousComplete = m.progress === 100;
  }
  return modules;
}

app.get('/api/health', async (_req, res, next) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true, database: 'PostgreSQL', service: 'NEXORA API', time: now() }); }
  catch (e) { next(e); }
});

app.post('/api/auth/register', async (req, res, next) => {
  try {
    const name = cleanText(req.body.name), email = cleanText(req.body.email).toLowerCase(), password = String(req.body.password || '');
    if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
    if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email' });
    if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    if ((await pool.query('SELECT 1 FROM users WHERE email=$1', [email])).rowCount) return res.status(409).json({ error: 'An account with this email already exists' });
    const { salt, hash } = hashPassword(password);
    const u = { id: id('usr'), name, email, salt, passwordHash: hash, createdAt: now() };
    await pool.query('INSERT INTO users(id,name,email,salt,password_hash,created_at) VALUES($1,$2,$3,$4,$5,$6)', [u.id, u.name, u.email, u.salt, u.passwordHash, u.createdAt]);
    await pool.query(`INSERT INTO user_settings(user_id,weekly_goal_minutes,notifications,compact_mode,challenge_week,challenge_step,challenge_completions) VALUES($1,720,TRUE,FALSE,$2,0,0)`, [u.id, weekKey()]);
    const token = id('sess');
    await pool.query(`INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')`, [token, u.id]);
    res.status(201).json({ token, user: cleanUser(u), data: await userData(u.id) });
  } catch (e) { next(e); }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const email = cleanText(req.body.email).toLowerCase(), password = String(req.body.password || '');
    const q = await pool.query(`SELECT id,name,email,salt,password_hash AS "passwordHash",created_at AS "createdAt" FROM users WHERE email=$1`, [email]);
    const u = q.rows[0];
    if (!u || !verifyPassword(password, u)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = id('sess');
    await pool.query('DELETE FROM sessions WHERE expires_at<=NOW()');
    await pool.query(`INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,NOW()+INTERVAL '30 days')`, [token, u.id]);
    res.json({ token, user: cleanUser(u), data: await userData(u.id) });
  } catch (e) { next(e); }
});

app.post('/api/auth/logout', auth, async (req, res, next) => {
  try { await pool.query('DELETE FROM sessions WHERE token=$1', [req.token]); res.json({ ok: true }); }
  catch (e) { next(e); }
});

app.get('/api/auth/me', auth, async (req, res, next) => {
  try { res.json({ user: cleanUser(req.user), data: await userData(req.user.id) }); }
  catch (e) { next(e); }
});

app.patch('/api/auth/profile', auth, async (req, res, next) => {
  try {
    const name = cleanText(req.body.name, req.user.name);
    if (name.length < 2) return res.status(400).json({ error: 'Name must be at least 2 characters' });
    const q = await pool.query(`UPDATE users SET name=$1 WHERE id=$2 RETURNING id,name,email,created_at AS "createdAt"`, [name, req.user.id]);
    res.json({ user: cleanUser(q.rows[0]) });
  } catch (e) { next(e); }
});

app.get('/api/bootstrap', auth, async (req, res, next) => {
  try { res.json(await userData(req.user.id)); }
  catch (e) { next(e); }
});

app.get('/api/stats', auth, async (req, res, next) => {
  try { res.json(await statsFor(req.user.id)); }
  catch (e) { next(e); }
});

app.post('/api/tasks', auth, async (req, res, next) => {
  try {
    const title = cleanText(req.body.title);
    if (!title) return res.status(400).json({ error: 'Task title is required' });
    const t = {
      id: id('task'), userId: req.user.id, title,
      due: cleanText(req.body.due, 'Today'),
      tag: cleanText(req.body.tag, 'Practice'),
      priority: priority(req.body.priority), done: false, createdAt: now()
    };
    await pool.query(`INSERT INTO tasks(id,user_id,title,due,tag,priority,done,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [t.id,t.userId,t.title,t.due,t.tag,t.priority,t.done,t.createdAt]);
    res.status(201).json(t);
  } catch (e) { next(e); }
});

app.patch('/api/tasks/:id', auth, async (req, res, next) => {
  try {
    const q = await pool.query(`SELECT * FROM tasks WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'Task not found' });
    const x = q.rows[0];
    const title = req.body.title !== undefined ? cleanText(req.body.title) : x.title;
    if (!title) return res.status(400).json({ error: 'Task title is required' });
    const r = await pool.query(`
      UPDATE tasks SET title=$1,due=$2,tag=$3,priority=$4,done=$5
      WHERE id=$6 AND user_id=$7
      RETURNING id,user_id AS "userId",title,due,tag,priority,done,created_at AS "createdAt"
    `, [title, req.body.due !== undefined ? cleanText(req.body.due, x.due) : x.due, req.body.tag !== undefined ? cleanText(req.body.tag, x.tag) : x.tag, priority(req.body.priority !== undefined ? req.body.priority : x.priority), req.body.done !== undefined ? Boolean(req.body.done) : x.done, req.params.id, req.user.id]);
    res.json(r.rows[0]);
  } catch (e) { next(e); }
});

app.delete('/api/tasks/:id', auth, async (req, res, next) => {
  try { const r = await pool.query(`DELETE FROM tasks WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]); if (!r.rowCount) return res.status(404).json({ error: 'Task not found' }); res.json({ ok: true }); }
  catch (e) { next(e); }
});

app.post('/api/notes', auth, async (req, res, next) => {
  try {
    const title = cleanText(req.body.title);
    if (!title) return res.status(400).json({ error: 'Note title is required' });
    const n = { id: id('note'), userId: req.user.id, title, body: String(req.body.body || ''), category: cleanText(req.body.category, 'Idea'), tags: cleanText(req.body.tags), createdAt: now() };
    await pool.query(`INSERT INTO notes(id,user_id,title,body,category,tags,created_at) VALUES($1,$2,$3,$4,$5,$6,$7)`, [n.id,n.userId,n.title,n.body,n.category,n.tags,n.createdAt]);
    res.status(201).json(n);
  } catch (e) { next(e); }
});

app.patch('/api/notes/:id', auth, async (req, res, next) => {
  try {
    const q = await pool.query(`UPDATE notes SET title=COALESCE(NULLIF($1,''),title),body=COALESCE($2,body),category=COALESCE(NULLIF($3,''),category),tags=COALESCE($4,tags) WHERE id=$5 AND user_id=$6 RETURNING id,user_id AS "userId",title,body,category,tags,created_at AS "createdAt"`, [req.body.title !== undefined ? cleanText(req.body.title) : null, req.body.body !== undefined ? String(req.body.body) : null, req.body.category !== undefined ? cleanText(req.body.category) : null, req.body.tags !== undefined ? cleanText(req.body.tags) : null, req.params.id, req.user.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'Note not found' });
    res.json(q.rows[0]);
  } catch (e) { next(e); }
});

app.delete('/api/notes/:id', auth, async (req, res, next) => {
  try { const r = await pool.query(`DELETE FROM notes WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]); if (!r.rowCount) return res.status(404).json({ error: 'Note not found' }); res.json({ ok: true }); }
  catch (e) { next(e); }
});

app.post('/api/projects', auth, async (req, res, next) => {
  try {
    const title = cleanText(req.body.title);
    if (!title) return res.status(400).json({ error: 'Project title is required' });
    const pr = progress(req.body.progress);
    const p = { id:id('project'), userId:req.user.id, title, small:cleanText(req.body.small, 'Practice project'), description:String(req.body.description || ''), cover:['purple','orange','pink','cyan'].includes(String(req.body.cover)) ? String(req.body.cover) : 'purple', progress:pr, status:pr >= 100 ? 'complete' : status(req.body.status), createdAt:now() };
    await pool.query(`INSERT INTO projects(id,user_id,title,small,description,cover,progress,status,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [p.id,p.userId,p.title,p.small,p.description,p.cover,p.progress,p.status,p.createdAt]);
    res.status(201).json(p);
  } catch (e) { next(e); }
});

app.patch('/api/projects/:id', auth, async (req, res, next) => {
  try {
    const q = await pool.query(`SELECT * FROM projects WHERE id=$1 AND user_id=$2`, [req.params.id, req.user.id]);
    if (!q.rowCount) return res.status(404).json({ error: 'Project not found' });
    const x=q.rows[0], pr=req.body.progress!==undefined?progress(req.body.progress):x.progress;
    const r=await pool.query(`UPDATE projects SET title=$1,small=$2,description=$3,cover=$4,progress=$5,status=$6 WHERE id=$7 AND user_id=$8 RETURNING id,user_id AS "userId",title,small,description,cover,progress,status,created_at AS "createdAt"`, [req.body.title!==undefined?cleanText(req.body.title,x.title):x.title,req.body.small!==undefined?cleanText(req.body.small,x.small):x.small,req.body.description!==undefined?String(req.body.description):x.description,req.body.cover!==undefined?cleanText(req.body.cover,x.cover):x.cover,pr,req.body.status!==undefined?status(req.body.status):(pr>=100?'complete':x.status),req.params.id,req.user.id]);
    res.json(r.rows[0]);
  } catch(e){next(e)}
});

app.delete('/api/projects/:id', auth, async(req,res,next)=>{try{const r=await pool.query(`DELETE FROM projects WHERE id=$1 AND user_id=$2`,[req.params.id,req.user.id]);if(!r.rowCount)return res.status(404).json({error:'Project not found'});res.json({ok:true})}catch(e){next(e)}});

app.post('/api/focus/sessions', auth, async (req,res,next)=>{
  try {
    const minutes=Math.round(Number(req.body.minutes||0));
    if(!Number.isFinite(minutes)||minutes<1||minutes>1440)return res.status(400).json({error:'Minutes must be between 1 and 1440'});
    const requestedDate=cleanText(req.body.sessionDate,dateKey());
    const s={id:id('focus'),userId:req.user.id,minutes,sessionDate:/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)?requestedDate:dateKey(),completedAt:now()};
    await pool.query(`INSERT INTO focus_sessions(id,user_id,minutes,session_date,completed_at) VALUES($1,$2,$3,$4,$5)`,[s.id,s.userId,s.minutes,s.sessionDate,s.completedAt]);
    res.status(201).json({session:s,stats:await statsFor(req.user.id)});
  }catch(e){next(e)}
});

app.get('/api/focus/history', auth, async(req,res,next)=>{
  try{
    const q=await pool.query(`SELECT id,minutes,session_date::text AS date,completed_at AS "completedAt" FROM focus_sessions WHERE user_id=$1 ORDER BY completed_at DESC LIMIT 20`,[req.user.id]);
    res.json(q.rows);
  }catch(e){next(e)}
});

app.get('/api/focus/weekly', auth, async(req,res,next)=>{
  try {
    const q=await pool.query(`SELECT session_date::text AS date,COALESCE(SUM(minutes),0)::int AS minutes FROM focus_sessions WHERE user_id=$1 AND session_date >= CURRENT_DATE-INTERVAL '6 days' GROUP BY session_date ORDER BY session_date ASC`,[req.user.id]);
    const map=new Map(q.rows.map(r=>[r.date,Number(r.minutes)||0]));
    const days=[]; const start=new Date(); start.setUTCHours(0,0,0,0); start.setUTCDate(start.getUTCDate()-6);
    for(let i=0;i<7;i++){const d=new Date(start);d.setUTCDate(start.getUTCDate()+i);const key=d.toISOString().slice(0,10);days.push({date:key,minutes:map.get(key)||0})}
    res.json({days,totalMinutes:days.reduce((s,d)=>s+d.minutes,0)});
  }catch(e){next(e)}
});

app.get('/api/learning', auth, async(req,res,next)=>{try{res.json(await learningData(req.user.id))}catch(e){next(e)}});

app.post('/api/learning/lessons/:id/complete', auth, async(req,res,next)=>{
  try{
    const lesson=await pool.query(`SELECT l.id,l.module_id,m.position FROM learning_lessons l JOIN learning_modules m ON m.id=l.module_id WHERE l.id=$1`,[req.params.id]);
    if(!lesson.rowCount)return res.status(404).json({error:'Lesson not found'});
    const m=await learningData(req.user.id); const moduleId=lesson.rows[0].module_id; const moduleInfo=m.find(x=>x.id===moduleId); if(!moduleInfo||!moduleInfo.unlocked)return res.status(403).json({error:'Complete the previous module first'});
    const done=Boolean(req.body.completed);
    if(done){await pool.query(`INSERT INTO lesson_progress(user_id,lesson_id,completed_at) VALUES($1,$2,NOW()) ON CONFLICT(user_id,lesson_id) DO NOTHING`,[req.user.id,req.params.id])}
    else {await pool.query(`DELETE FROM lesson_progress WHERE user_id=$1 AND lesson_id=$2`,[req.user.id,req.params.id])}
    res.json({learning:await learningData(req.user.id),stats:await statsFor(req.user.id)});
  }catch(e){next(e)}
});

app.get('/api/settings', auth, async(req,res,next)=>{try{res.json(await getSettings(req.user.id))}catch(e){next(e)}});
app.patch('/api/settings', auth, async(req,res,next)=>{
  try{
    const current=await getSettings(req.user.id);
    const weeklyGoalMinutes=Math.round(clamp(req.body.weeklyGoalMinutes!==undefined?req.body.weeklyGoalMinutes:current.weeklyGoalMinutes,60,60*80));
    const notifications=req.body.notifications!==undefined?Boolean(req.body.notifications):current.notifications;
    const compactMode=req.body.compactMode!==undefined?Boolean(req.body.compactMode):current.compactMode;
    const challengeStep=req.body.challengeStep!==undefined?Math.round(clamp(req.body.challengeStep,0,5)):current.challengeStep;
    await pool.query(`UPDATE user_settings SET weekly_goal_minutes=$1,notifications=$2,compact_mode=$3,challenge_week=$4,challenge_step=$5 WHERE user_id=$6`,[weeklyGoalMinutes,notifications,compactMode,weekKey(),challengeStep,req.user.id]);
    res.json(await getSettings(req.user.id));
  }catch(e){next(e)}
});

app.post('/api/challenge/step', auth, async(req,res,next)=>{
  try{
    const s=await getSettings(req.user.id);
    const oldStep=Number(s.challengeStep||0);
    const step=Math.round(clamp(oldStep+(req.body.delta!==undefined?Number(req.body.delta):1),0,5));
    const completedBefore=Number(s.challengeCompletions||0);
    const addCompletion=oldStep<5 && step===5 ? 1 : 0;
    await pool.query(`UPDATE user_settings SET challenge_week=$1,challenge_step=$2,challenge_completions=challenge_completions+$3 WHERE user_id=$4`,[weekKey(),step,addCompletion,req.user.id]);
    res.json(await userData(req.user.id));
  }catch(e){next(e)}
});

app.get('/api/notifications', auth, async(req,res,next)=>{
  try{
    const items=[];
    const [tasks,focus,lessons,projects]=await Promise.all([
      pool.query(`SELECT id,title,due,priority FROM tasks WHERE user_id=$1 AND done=FALSE ORDER BY created_at DESC LIMIT 6`,[req.user.id]),
      pool.query(`SELECT minutes,completed_at FROM focus_sessions WHERE user_id=$1 ORDER BY completed_at DESC LIMIT 6`,[req.user.id]),
      pool.query(`SELECT l.title,lp.completed_at FROM lesson_progress lp JOIN learning_lessons l ON l.id=lp.lesson_id WHERE lp.user_id=$1 ORDER BY lp.completed_at DESC LIMIT 6`,[req.user.id]),
      pool.query(`SELECT title,progress,status,created_at FROM projects WHERE user_id=$1 ORDER BY created_at DESC LIMIT 6`,[req.user.id])
    ]);
    tasks.rows.filter(t=>/^today$/i.test(String(t.due))||/overdue/i.test(String(t.due))).slice(0,4).forEach(t=>items.push({type:'task',icon:'✓',title:`Task needs attention: ${t.title}`,time:t.due}));
    focus.rows.slice(0,3).forEach(f=>items.push({type:'focus',icon:'⏱',title:`Focus session: ${f.minutes} min`,time:f.completed_at}));
    lessons.rows.slice(0,3).forEach(l=>items.push({type:'lesson',icon:'📚',title:`Lesson complete: ${l.title}`,time:l.completed_at}));
    projects.rows.filter(p=>p.progress===100).slice(0,2).forEach(p=>items.push({type:'project',icon:'🏆',title:`Project completed: ${p.title}`,time:p.created_at}));
    items.sort((a,b)=>new Date(b.time)-new Date(a.time));
    res.json(items.slice(0,10));
  }catch(e){next(e)}
});

app.get(/^\/(?!api(?:\/|$)).*/, (_req,res)=>res.sendFile(path.join(ROOT,'public','index.html')));
app.use((err,_req,res,_next)=>{console.error(err);res.status(500).json({error:'Server error. Please try again.'})});

initDb().then(()=>{
  app.listen(PORT,HOST,()=>console.log(`\nNEXORA is running at http://localhost:${PORT}\nDatabase: PostgreSQL (Neon)\n`));
}).catch(err=>{console.error('NEXORA could not start:',err);process.exit(1)});
