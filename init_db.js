const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  // Reset clients table
  db.run(`DROP TABLE IF EXISTS clients`);
  db.run(`CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT,
    password TEXT,
    mail_count INTEGER
  )`);

  const stmt = db.prepare("INSERT INTO clients (username, password, mail_count) VALUES (?, ?, ?)");
  for (let i = 1; i <= 10; i++) {
    stmt.run(`user${i}`, `pass${i}`, Math.floor(Math.random() * 20));
  }
  stmt.finalize();
  console.log("✅ Clients table initialized with 10 users.");

  // New: Create appointments table
  db.run(`DROP TABLE IF EXISTS appointments`);
  db.run(`CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    email TEXT NOT NULL,
    date TEXT NOT NULL,
    time TEXT NOT NULL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) console.error("❌ Failed to create appointments table:", err.message);
    else console.log("✅ Appointments table created.");
  });
});

db.close();