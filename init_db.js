const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  // 重建 clients 表格
  db.run(`DROP TABLE IF EXISTS clients`);
  db.run(`CREATE TABLE clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    mail_count INTEGER DEFAULT 0,
    contact_name TEXT,
    contact_phone TEXT,
    contact_email TEXT,
    company_name TEXT,
    company_address TEXT
  )`);

  const clientStmt = db.prepare("INSERT INTO clients (username, password, mail_count, contact_name, contact_phone, contact_email, company_name, company_address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");

  for (let i = 1; i <= 5; i++) {
    clientStmt.run(
      `user${i}`,
      `pass${i}`,
      Math.floor(Math.random() * 20),
      `Client ${i}`,
      `12345678${i}`,
      `user${i}@mail.com`,
      `Company ${i}`,
      `Address ${i}`
    );
  }

  clientStmt.finalize();

  // 建立 appointments 表格
  db.run(`DROP TABLE IF EXISTS appointments`);
  db.run(`CREATE TABLE appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    email TEXT,
    date TEXT,
    time TEXT
  )`);

  console.log("✅ Database initialized with sample clients and appointments table.");
});

db.close();
