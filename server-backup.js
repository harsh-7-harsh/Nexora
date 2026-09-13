const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'nexora.json');

const SESSION_DAYS = 30;

app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));


/* =========================
   DATABASE
========================= */

const defaults = () => ({
  users: [],
  sessions: [],
  tasks: [],
  notes: [],
  projects: [],
  focusSessions: []
});


function saveDb(database) {
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const tmp = `${DB_FILE}.tmp`;

  fs.writeFileSync(
    tmp,
    JSON.stringify(database, null, 2),
    'utf8'
  );

  fs.renameSync(tmp, DB_FILE);
}


function loadDb() {

  fs.mkdirSync(DATA_DIR, { recursive: true });

  if (!fs.existsSync(DB_FILE)) {

    const database = defaults();

    saveDb(database);

    return database;
  }

  try {

    const parsed = JSON.parse(
      fs.readFileSync(DB_FILE, 'utf8')
    );

    return {
      ...defaults(),
      ...parsed,

      users: Array.isArray(parsed.users)
        ? parsed.users
        : [],

      sessions: Array.isArray(parsed.sessions)
        ? parsed.sessions
        : [],

      tasks: Array.isArray(parsed.tasks)
        ? parsed.tasks
        : [],

      notes: Array.isArray(parsed.notes)
        ? parsed.notes
        : [],

      projects: Array.isArray(parsed.projects)
        ? parsed.projects
        : [],

      focusSessions: Array.isArray(parsed.focusSessions)
        ? parsed.focusSessions
        : []
    };

  } catch {

    const backup =
      `${DB_FILE}.corrupt-${Date.now()}`;

    try {
      fs.copyFileSync(DB_FILE, backup);
    } catch {}

    const database = defaults();

    saveDb(database);

    return database;
  }
}


let db = loadDb();


/* =========================
   HELPERS
========================= */

function id(prefix) {

  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}


function now() {

  return new Date().toISOString();
}


function sessionExpiry() {

  return new Date(
    Date.now() +
    SESSION_DAYS *
    24 *
    60 *
    60 *
    1000
  ).toISOString();
}


function hashPassword(
  password,
  salt = crypto.randomBytes(16).toString('hex')
) {

  const derived =
    crypto.scryptSync(
      password,
      salt,
      64
    ).toString('hex');

  return {
    salt,
    hash: derived
  };
}


function verifyPassword(password, user) {

  try {

    const derived =
      crypto.scryptSync(
        password,
        user.salt,
        64
      ).toString('hex');

    const a =
      Buffer.from(derived, 'hex');

    const b =
      Buffer.from(user.passwordHash, 'hex');

    return (
      a.length === b.length &&
      crypto.timingSafeEqual(a, b)
    );

  } catch {

    return false;
  }
}


function cleanUser(user) {

  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt
  };
}


function normalizePriority(value) {

  const priority =
    String(value || 'Medium');

  if (
    priority === 'Low' ||
    priority === 'Medium' ||
    priority === 'High'
  ) {
    return priority;
  }

  return 'Medium';
}


function clampProgress(value) {

  const n = Number(value);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(n)
    )
  );
}


/* =========================
   AUTH
========================= */

function auth(req, res, next) {

  const header =
    req.headers.authorization || '';

  const token =
    header.startsWith('Bearer ')
      ? header.slice(7).trim()
      : '';

  if (!token) {

    return res.status(401).json({
      error: 'Authentication required'
    });
  }

  const session =
    db.sessions.find(
      s =>
        s.token === token &&
        new Date(s.expiresAt) > new Date()
    );

  if (!session) {

    return res.status(401).json({
      error:
        'Session expired. Please log in again.'
    });
  }

  const user =
    db.users.find(
      u => u.id === session.userId
    );

  if (!user) {

    return res.status(401).json({
      error: 'User not found'
    });
  }

  req.user = user;
  req.token = token;

  next();
}


function ownerOnly(
  collection,
  req,
  res,
  next
) {

  const item =
    db[collection].find(
      x =>
        x.id === req.params.id &&
        x.userId === req.user.id
    );

  if (!item) {

    return res.status(404).json({
      error: 'Not found'
    });
  }

  req.item = item;

  next();
}


/* =========================
   STATS
========================= */

function statsFor(userId) {

  const tasks =
    db.tasks.filter(
      x => x.userId === userId
    );

  const notes =
    db.notes.filter(
      x => x.userId === userId
    );

  const projects =
    db.projects.filter(
      x => x.userId === userId
    );

  const sessions =
    db.focusSessions.filter(
      x => x.userId === userId
    );


  const completedTasks =
    tasks.filter(
      x => x.done
    ).length;


  const focusMinutes =
    sessions.reduce(
      (sum, x) =>
        sum +
        Math.max(
          0,
          Number(x.minutes) || 0
        ),
      0
    );


  const projectProgress =
    projects.length
      ? Math.round(
          projects.reduce(
            (sum, p) =>
              sum +
              clampProgress(p.progress),
            0
          ) / projects.length
        )
      : 0;


  const totalXp =
    completedTasks * 35 +
    focusMinutes +
    notes.length * 12 +
    projects.length * 70;


  const level =
    Math.max(
      1,
      Math.floor(totalXp / 250) + 1
    );


  const xp =
    totalXp % 250;


  /*
    Calculate consecutive focus-session days.
  */

  const uniqueDates = [
    ...new Set(
      sessions
        .map(
          s =>
            String(
              s.date || ''
            ).slice(0, 10)
        )
        .filter(Boolean)
    )
  ].sort();


  let streak = 0;


  if (uniqueDates.length) {

    const dates =
      new Set(uniqueDates);

    const cursor =
      new Date(
        `${uniqueDates[uniqueDates.length - 1]}T00:00:00Z`
      );


    while (
      dates.has(
        cursor
          .toISOString()
          .slice(0, 10)
      )
    ) {

      streak++;

      cursor.setUTCDate(
        cursor.getUTCDate() - 1
      );
    }
  }


  return {

    tasks:
      tasks.length,

    completedTasks,

    notes:
      notes.length,

    projects:
      projects.length,

    focusMinutes,

    projectProgress,

    level,

    xp,

    streak
  };
}


/* =========================
   USER DATA
========================= */

function userData(userId) {

  return {

    tasks:
      db.tasks
        .filter(
          x =>
            x.userId === userId
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        ),


    notes:
      db.notes
        .filter(
          x =>
            x.userId === userId
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        ),


    projects:
      db.projects
        .filter(
          x =>
            x.userId === userId
        )
        .sort(
          (a, b) =>
            new Date(b.createdAt) -
            new Date(a.createdAt)
        ),


    stats:
      statsFor(userId)
  };
}


function createSession(userId) {

  const token =
    id('sess');

  db.sessions.push({

    token,

    userId,

    createdAt:
      now(),

    expiresAt:
      sessionExpiry()
  });

  return token;
}


function cleanupExpiredSessions() {

  const before =
    db.sessions.length;


  db.sessions =
    db.sessions.filter(
      s =>
        s &&
        s.token &&
        new Date(s.expiresAt) >
          new Date()
    );


  return (
    before !==
    db.sessions.length
  );
}


/* =========================
   HEALTH
========================= */

app.get(
  '/api/health',
  (_req, res) => {

    const changed =
      cleanupExpiredSessions();

    if (changed) {
      saveDb(db);
    }

    res.json({

      ok: true,

      service:
        'NEXORA API',

      time:
        now()
    });
  }
);


/* =========================
   REGISTER
========================= */

app.post(
  '/api/auth/register',
  (req, res) => {

    const name =
      String(
        req.body.name || ''
      ).trim();


    const email =
      String(
        req.body.email || ''
      )
      .trim()
      .toLowerCase();


    const password =
      String(
        req.body.password || ''
      );


    if (name.length < 2) {

      return res.status(400).json({
        error:
          'Name must be at least 2 characters'
      });
    }


    if (
      !/^\S+@\S+\.\S+$/.test(email)
    ) {

      return res.status(400).json({
        error:
          'Enter a valid email'
      });
    }


    if (password.length < 6) {

      return res.status(400).json({
        error:
          'Password must be at least 6 characters'
      });
    }


    if (
      db.users.some(
        u =>
          u.email === email
      )
    ) {

      return res.status(409).json({
        error:
          'An account with this email already exists'
      });
    }


    const {
      salt,
      hash
    } =
      hashPassword(password);


    const user = {

      id:
        id('usr'),

      name,

      email,

      salt,

      passwordHash:
        hash,

      createdAt:
        now()
    };


    db.users.push(user);


    /*
      IMPORTANT:
      New accounts start empty.
      No demo data is created.
    */


    const token =
      createSession(
        user.id
      );


    cleanupExpiredSessions();

    saveDb(db);


    res.status(201).json({

      token,

      user:
        cleanUser(user),

      data:
        userData(user.id)
    });
  }
);


/* =========================
   LOGIN
========================= */

app.post(
  '/api/auth/login',
  (req, res) => {

    const email =
      String(
        req.body.email || ''
      )
      .trim()
      .toLowerCase();


    const password =
      String(
        req.body.password || ''
      );


    const user =
      db.users.find(
        u =>
          u.email === email
      );


    if (
      !user ||
      !verifyPassword(
        password,
        user
      )
    ) {

      return res.status(401).json({
        error:
          'Invalid email or password'
      });
    }


    /*
      Keep existing valid sessions.
      This allows the same account
      on phone + laptop.
    */

    const token =
      createSession(
        user.id
      );


    cleanupExpiredSessions();

    saveDb(db);


    res.json({

      token,

      user:
        cleanUser(user),

      data:
        userData(user.id)
    });
  }
);


/* =========================
   LOGOUT
========================= */

app.post(
  '/api/auth/logout',
  auth,
  (req, res) => {

    db.sessions =
      db.sessions.filter(
        s =>
          s.token !==
          req.token
      );

    saveDb(db);

    res.json({
      ok: true
    });
  }
);


/* =========================
   CURRENT USER
========================= */

app.get(
  '/api/auth/me',
  auth,
  (req, res) => {

    res.json({

      user:
        cleanUser(
          req.user
        ),

      data:
        userData(
          req.user.id
        )
    });
  }
);


/* =========================
   BOOTSTRAP
========================= */

app.get(
  '/api/bootstrap',
  auth,
  (req, res) => {

    res.json(
      userData(
        req.user.id
      )
    );
  }
);


/* =========================
   TASKS
========================= */

app.post(
  '/api/tasks',
  auth,
  (req, res) => {

    const title =
      String(
        req.body.title || ''
      ).trim();


    if (!title) {

      return res.status(400).json({
        error:
          'Task title is required'
      });
    }


    const task = {

      id:
        id('task'),

      userId:
        req.user.id,

      title,

      due:
        String(
          req.body.due ||
          'Today'
        ),

      tag:
        String(
          req.body.tag ||
          'Practice'
        ),

      priority:
        normalizePriority(
          req.body.priority
        ),

      done:
        Boolean(
          req.body.done
        ),

      createdAt:
        now()
    };


    db.tasks.push(task);

    saveDb(db);


    res.status(201).json(
      task
    );
  }
);


app.patch(
  '/api/tasks/:id',
  auth,
  ownerOnly.bind(
    null,
    'tasks'
  ),
  (req, res) => {

    if (
      req.body.title !==
      undefined
    ) {

      const title =
        String(
          req.body.title
        ).trim();


      if (!title) {

        return res.status(400).json({
          error:
            'Task title cannot be empty'
        });
      }


      req.item.title =
        title;
    }


    if (
      req.body.due !==
      undefined
    ) {

      req.item.due =
        String(
          req.body.due
        );
    }


    if (
      req.body.tag !==
      undefined
    ) {

      req.item.tag =
        String(
          req.body.tag
        );
    }


    if (
      req.body.priority !==
      undefined
    ) {

      req.item.priority =
        normalizePriority(
          req.body.priority
        );
    }


    if (
      req.body.done !==
      undefined
    ) {

      req.item.done =
        Boolean(
          req.body.done
        );
    }


    saveDb(db);

    res.json(
      req.item
    );
  }
);


app.delete(
  '/api/tasks/:id',
  auth,
  ownerOnly.bind(
    null,
    'tasks'
  ),
  (req, res) => {

    db.tasks =
      db.tasks.filter(
        x =>
          x !==
          req.item
      );


    saveDb(db);


    res.json({
      ok: true
    });
  }
);


/* =========================
   NOTES
========================= */

app.post(
  '/api/notes',
  auth,
  (req, res) => {

    const title =
      String(
        req.body.title || ''
      ).trim();


    if (!title) {

      return res.status(400).json({
        error:
          'Note title is required'
      });
    }


    const note = {

      id:
        id('note'),

      userId:
        req.user.id,

      title,

      body:
        String(
          req.body.body ||
          ''
        ),

      createdAt:
        now()
    };


    db.notes.push(note);

    saveDb(db);


    res.status(201).json(
      note
    );
  }
);


app.patch(
  '/api/notes/:id',
  auth,
  ownerOnly.bind(
    null,
    'notes'
  ),
  (req, res) => {

    if (
      req.body.title !==
      undefined
    ) {

      const title =
        String(
          req.body.title
        ).trim();


      if (!title) {

        return res.status(400).json({
          error:
            'Note title cannot be empty'
        });
      }


      req.item.title =
        title;
    }


    if (
      req.body.body !==
      undefined
    ) {

      req.item.body =
        String(
          req.body.body
        );
    }


    saveDb(db);

    res.json(
      req.item
    );
  }
);


app.delete(
  '/api/notes/:id',
  auth,
  ownerOnly.bind(
    null,
    'notes'
  ),
  (req, res) => {

    db.notes =
      db.notes.filter(
        x =>
          x !==
          req.item
      );


    saveDb(db);


    res.json({
      ok: true
    });
  }
);


/* =========================
   PROJECTS
========================= */

app.post(
  '/api/projects',
  auth,
  (req, res) => {

    const title =
      String(
        req.body.title || ''
      ).trim();


    if (!title) {

      return res.status(400).json({
        error:
          'Project title is required'
      });
    }


    const progress =
      clampProgress(
        req.body.progress
      );


    const project = {

      id:
        id('project'),

      userId:
        req.user.id,

      title,

      small:
        String(
          req.body.small ||
          `Practice project · ${progress}% complete`
        ),

      cover:
        String(
          req.body.cover ||
          'purple'
        ),

      progress,

      status:
        progress >= 100
          ? 'complete'
          : 'in-progress',

      createdAt:
        now()
    };


    db.projects.push(project);

    saveDb(db);


    res.status(201).json(
      project
    );
  }
);


app.patch(
  '/api/projects/:id',
  auth,
  ownerOnly.bind(
    null,
    'projects'
  ),
  (req, res) => {

    for (
      const key of [
        'title',
        'small',
        'cover',
        'status'
      ]
    ) {

      if (
        req.body[key] !==
        undefined
      ) {

        req.item[key] =
          String(
            req.body[key]
          );
      }
    }


    if (
      req.body.progress !==
      undefined
    ) {

      req.item.progress =
        clampProgress(
          req.body.progress
        );


      req.item.status =
        req.item.progress >=
        100
          ? 'complete'
          : 'in-progress';
    }


    saveDb(db);

    res.json(
      req.item
    );
  }
);


app.delete(
  '/api/projects/:id',
  auth,
  ownerOnly.bind(
    null,
    'projects'
  ),
  (req, res) => {

    db.projects =
      db.projects.filter(
        x =>
          x !==
          req.item
      );


    saveDb(db);


    res.json({
      ok: true
    });
  }
);


/* =========================
   FOCUS SESSIONS
========================= */

app.post(
  '/api/focus/sessions',
  auth,
  (req, res) => {

    const minutes =
      Math.round(
        Number(
          req.body.minutes ||
          0
        )
      );


    if (
      !Number.isFinite(
        minutes
      ) ||
      minutes < 1
    ) {

      return res.status(400).json({
        error:
          'Minutes are required'
      });
    }


    const session = {

      id:
        id('focus'),

      userId:
        req.user.id,

      minutes,

      date:
        new Date()
          .toISOString()
          .slice(0, 10),

      completedAt:
        now()
    };


    db.focusSessions.push(
      session
    );

    saveDb(db);


    res.status(201).json({

      session,

      stats:
        statsFor(
          req.user.id
        )
    });
  }
);


app.get(
  '/api/stats',
  auth,
  (req, res) => {

    res.json(
      statsFor(
        req.user.id
      )
    );
  }
);


/* =========================
   FRONTEND
========================= */

app.get(
  /^\/(?!api(?:\/|$)).*/,
  (_req, res) => {

    res.sendFile(
      path.join(
        PUBLIC_DIR,
        'index.html'
      )
    );
  }
);


/* =========================
   START SERVER
========================= */

cleanupExpiredSessions();

saveDb(db);


app.listen(
  PORT,
  HOST,
  () => {

    console.log(
      `\nNEXORA is running at http://localhost:${PORT}`
    );

    console.log(
      `Data file: ${DB_FILE}`
    );

    console.log(
      `Host: ${HOST}`
    );

    console.log(
      `Port: ${PORT}\n`
    );
  }
);