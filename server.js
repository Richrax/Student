// server.js - Smart Attendance (QR-only) - Node + Express + SQLite
const express = require('express');
const bodyParser = require('body-parser');
const QRCode = require('qrcode');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const stringify = require('csv-stringify').stringify;
const cors = require('cors');

const PORT = process.env.PORT || 3001;
const DB_FILE = path.join(__dirname, 'attendance.db');
const app = express();

app.use(cors());
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());
app.use('/public', express.static(path.join(__dirname, 'public')));
app.use('/views', express.static(path.join(__dirname, 'views')));

// Database
const db = new sqlite3.Database(DB_FILE);

// Helpers
function runSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
      if (err) reject(err); else resolve(this);
    });
  });
}
function allSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => err ? reject(err) : resolve(rows));
  });
}
function getSql(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

// Initialize DB (if db-init.sql exists)
async function initDb() {
  try {
    const schemaPath = path.join(__dirname, 'db-init.sql');
    if (fs.existsSync(schemaPath)) {
      const schema = fs.readFileSync(schemaPath, 'utf8');
      const stmts = schema.split(';').map(s=>s.trim()).filter(Boolean);
      for (const s of stmts) await runSql(s + ';');
    }
    // seed demo data if none
    const users = await allSql('SELECT * FROM users LIMIT 1');
    if (!users || users.length === 0) {
      await runSql('INSERT INTO users (id,name,role) VALUES (?,?,?)', ['faculty1','Prof. Alice','faculty']);
      await runSql('INSERT INTO users (id,name,role) VALUES (?,?,?)', ['stu1','Bob Student','student']);
      await runSql('INSERT INTO users (id,name,role) VALUES (?,?,?)', ['stu2','Cara Student','student']);
      await runSql('INSERT INTO sections (id,code,title,faculty_id) VALUES (?,?,?,?)', ['sec101','CS101','Intro to CS','faculty1']);
      console.log('DB seeded with demo data.');
    }
  } catch (err) {
    console.error('DB init error', err);
  }
}

// Allow CLI flag to init DB then exit
if (process.argv.includes('--initdb')) {
  initDb().then(()=>{ console.log('DB init complete'); process.exit(0); });
}

// Routes - serve views
app.get('/', (req,res) => res.sendFile(path.join(__dirname,'views','index.html')));
app.get('/faculty', (req,res) => res.sendFile(path.join(__dirname,'views','faculty.html')));
app.get('/faculty_management', (req,res) => res.sendFile(path.join(__dirname,'views','faculty_management.html')));
app.get('/scan', (req,res) => res.sendFile(path.join(__dirname,'views','scan.html')));
app.get('/qr', (req,res) => res.sendFile(path.join(__dirname,'views','qr.html')));
app.get('/report', (req,res) => res.sendFile(path.join(__dirname,'views','report.html')));

// API - sections, users
app.get('/api/sections', async (req,res) => {
  try { const rows = await allSql('SELECT * FROM sections'); res.json(rows); } catch(e){ res.status(500).json({error:e.message});}
});
app.get('/api/users', async (req,res)=> {
  try { const rows = await allSql('SELECT * FROM users'); res.json(rows); } catch(e){ res.status(500).json({error:e.message});}
});

// Faculty management APIs
app.get('/api/faculty', async (req,res)=> {
  try { const rows = await allSql("SELECT * FROM users WHERE role='faculty'"); res.json(rows);} catch(e){res.status(500).json({error:e.message});}
});
app.post('/api/faculty/add', async (req,res)=> {
  try {
    const { id, name } = req.body;
    if (!id || !name) return res.status(400).json({error:'id & name required'});
    await runSql('INSERT INTO users (id,name,role) VALUES (?,?,?)',[id,name,'faculty']);
    res.json({success:true});
  } catch(e){ res.status(500).json({error:e.message}); }
});
app.delete('/api/faculty/delete/:id', async (req,res)=> {
  try { await runSql('DELETE FROM users WHERE id=? AND role="faculty"', [req.params.id]); res.json({success:true}); } catch(e){ res.status(500).json({error:e.message}); }
});

// Create session (faculty)
app.post('/api/session', async (req,res) => {
  try {
    const { facultyId, sectionId, durationMinutes } = req.body;
    if (!facultyId || !sectionId) return res.status(400).json({error:'Missing fields'});
    const faculty = await getSql('SELECT * FROM users WHERE id=? AND role=?',[facultyId,'faculty']);
    if (!faculty) return res.status(400).json({error:'Invalid faculty'});
    const section = await getSql('SELECT * FROM sections WHERE id=?',[sectionId]);
    if (!section) return res.status(400).json({error:'Invalid section'});

    const id = uuidv4();
    const token = uuidv4().split('-')[0];
    const startAt = Date.now();
    const expiresAt = startAt + ((parseInt(durationMinutes || 30,10))*60*1000);
    await runSql('INSERT INTO sessions (id,section_id,token,start_at,expires_at) VALUES (?,?,?,?,?)',[id,sectionId,token,startAt,expiresAt]);
    res.json({sessionId:id, token, expiresAt, checkinUrl:`${req.protocol}://${req.get('host')}/scan?session=${id}&token=${token}`});
  } catch(e){ res.status(500).json({error:e.message}); }
});

// Generate QR (renders directly)
app.get('/session/:id/qr', async (req,res) => {
  try {
    const sessionId = req.params.id;
    const session = await getSql('SELECT * FROM sessions WHERE id=?',[sessionId]);
    if (!session) return res.status(404).send('Session not found');
    const url = `${req.protocol}://${req.get('host')}/scan?session=${sessionId}&token=${session.token}`;
    const dataUrl = await QRCode.toDataURL(url);
    // render simple page showing QR
    res.send(`
      <html><head><title>QR</title></head><body style="font-family:Arial, sans-serif; text-align:center; padding:30px;">
        <h2>Scan to check-in</h2>
        <img src="${dataUrl}" style="width:260px;"/>
        <p>Session: ${sessionId}</p>
        <p>URL: <a href="${url}">${url}</a></p>
        <p><a href="/">Back</a></p>
      </body></html>
    `);
  } catch(e){ res.status(500).send('QR error'); }
});

// Student check-in API (used by scan page)
app.post('/api/checkin', async (req,res) => {
  try {
    const { sessionId, token, studentId } = req.body;
    if (!sessionId || !token || !studentId) return res.status(400).json({error:'Missing params'});
    const session = await getSql('SELECT * FROM sessions WHERE id=?',[sessionId]);
    if (!session) return res.status(404).json({error:'Session not found'});
    if (session.token !== token) return res.status(403).json({error:'Invalid token'});
    if (Date.now() > session.expires_at) return res.status(403).json({error:'Session expired'});
    const student = await getSql('SELECT * FROM users WHERE id=? AND role=?',[studentId,'student']);
    if (!student) return res.status(403).json({error:'Student not found'});
    const existing = await getSql('SELECT * FROM attendance WHERE session_id=? AND student_id=?',[sessionId,studentId]);
    if (existing) return res.status(409).json({error:'Already checked in'});

    const recId = uuidv4();
    await runSql('INSERT INTO attendance (id,session_id,student_id,status,checkin_time,method) VALUES (?,?,?,?,?,?)',[recId,sessionId,studentId,'present',Date.now(),'qr']);
    res.json({success:true, message:'Checked in'});
  } catch(e){ res.status(500).json({error:e.message});}
});

// API: list sessions & attendance
app.get('/api/sessions', async (req,res) => {
  try { const rows = await allSql('SELECT s.*, sec.code, sec.title FROM sessions s LEFT JOIN sections sec ON sec.id=s.section_id ORDER BY s.start_at DESC'); res.json(rows);} catch(e){ res.status(500).json({error:e.message});}
});
app.get('/api/attendance', async (req,res) => {
  try { const rows = await allSql('SELECT a.*, u.name as student_name FROM attendance a LEFT JOIN users u ON u.id=a.student_id ORDER BY a.checkin_time DESC'); res.json(rows);} catch(e){ res.status(500).json({error:e.message});}
});

// CSV report
app.get('/report/csv', async (req,res) => {
  try {
    const { section } = req.query;
    let sessions;
    if (section) sessions = await allSql('SELECT id FROM sessions WHERE section_id=?',[section]); else sessions = await allSql('SELECT id FROM sessions');
    const ids = sessions.map(s=>s.id);
    if (ids.length===0) return res.send('No sessions');
    const ph = ids.map(()=>'?').join(',');
    const rows = await allSql(`SELECT a.*, s.section_id FROM attendance a LEFT JOIN sessions s ON s.id=a.session_id WHERE a.session_id IN (${ph})`, ids);
    const data = rows.map(r=>({attendance_id:r.id, session_id:r.session_id, section_id:r.section_id, student_id:r.student_id, status:r.status, checkin_time:new Date(r.checkin_time).toISOString(), method:r.method}));
    res.setHeader('Content-Type','text/csv');
    res.setHeader('Content-disposition','attachment; filename=attendance_report.csv');
    stringify(data, { header: true }).pipe(res);
  } catch(e){ res.status(500).send('Report failed'); }
});

// Start
initDb();
app.listen(PORT, ()=> console.log(`Server running at http://localhost:${PORT}`));
