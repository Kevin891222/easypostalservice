const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('./database.db');
const saltRounds = 10;

(async () => {
  db.serialize(async () => {
    // 建立 clients 表
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

    const clientStmt = db.prepare(`INSERT INTO clients 
      (username, password, mail_count, contact_name, contact_phone, contact_email, company_name, company_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

    // ➕ 插入 5 筆使用者資料（密碼加密）
    for (let i = 1; i <= 5; i++) {
      const hashedPassword = await bcrypt.hash(`pass${i}`, saltRounds);
      clientStmt.run(
        `user${i}`,
        hashedPassword,
        Math.floor(Math.random() * 20),
        `Client ${i}`,
        `12345678${i}`,
        `user${i}@mail.com`,
        `Company ${i}`,
        `Address ${i}`
      );
    }

    // 🔐 插入 admin 帳號（使用 bcrypt 加密）
    const adminHashedPassword = await bcrypt.hash("Jasper@9654", saltRounds);
    clientStmt.run(
      "jchung",
      adminHashedPassword,
      0,
      "Admin",
      "0000000000",
      "admin@mail.com",
      "Easy Postal",
      "Admin HQ"
    );

    clientStmt.finalize(() => {
      console.log("✅ Clients including admin created.");
    });

    // 建立 appointments 表
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
    )`, () => {
      console.log("✅ Appointments table created.");
      db.close();
    });
  });
})();
