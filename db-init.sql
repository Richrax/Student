-- users (students & faculty)
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('student','faculty'))
);

-- sections / courses
CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  code TEXT,
  title TEXT,
  faculty_id TEXT,
  FOREIGN KEY(faculty_id) REFERENCES users(id)
);

-- sessions (attendance sessions)
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  section_id TEXT,
  token TEXT,
  start_at INTEGER,
  expires_at INTEGER,
  FOREIGN KEY(section_id) REFERENCES sections(id)
);

-- attendance records
CREATE TABLE IF NOT EXISTS attendance (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  student_id TEXT,
  status TEXT,
  checkin_time INTEGER,
  method TEXT,
  FOREIGN KEY(session_id) REFERENCES sessions(id),
  FOREIGN KEY(student_id) REFERENCES users(id)
);
