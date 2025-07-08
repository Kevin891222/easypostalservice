const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
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
  console.log("Database initialized with 10 users.");
});

db.close();