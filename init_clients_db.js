const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');
const db = new sqlite3.Database('./clients.db');
const saltRounds = 10;

async function initializeClientsDatabase() {
  // 🔄 Drop & Create clients 表
  await new Promise((resolve, reject) => {
    db.run(`DROP TABLE IF EXISTS clients`, (err) => (err ? reject(err) : resolve()));
  });

  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE clients (
      mailbox_number INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE,
      password TEXT,
      role TEXT CHECK(role IN ('admin', 'staff', 'client')) DEFAULT 'client',
      mail_count INTEGER DEFAULT 0,
      contact_name TEXT,
      contact_phone TEXT,
      contact_email TEXT,
      company_name TEXT
    )`, (err) => (err ? reject(err) : resolve()));
  });

  const stmt = db.prepare(`INSERT INTO clients 
    (username, password, role, mail_count, contact_name, contact_phone, contact_email, company_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);

  // ➕ 建立 client 資料
  for (let i = 1; i <= 5; i++) {
    const hashedPassword = await bcrypt.hash(`pass${i}`, saltRounds);
    stmt.run(
      `user${i}`,
      hashedPassword,
      'client',
      Math.floor(Math.random() * 20),
      `Client ${i}`,
      `12345678${i}`,
      `user${i}@mail.com`,
      `Company ${i}`
    );
  }

  // 🔐 admin
  const adminPwd = await bcrypt.hash("Jasper@9654", saltRounds);
  stmt.run(
    "jchung",
    adminPwd,
    'admin',
    0,
    "Admin",
    "0000000000",
    "admin@mail.com",
    "Easy Postal"
  );

  // 👤 staff
  const staffPwd = await bcrypt.hash("Emily@jasper", saltRounds);
  stmt.run(
    "emsstaff",
    staffPwd,
    'staff',
    0,
    "Staff Member",
    "0999123456",
    "staff@mail.com",
    "Easy Postal"
  );

  stmt.finalize(() => {
    console.log("✅ Clients created successfully.");
    db.close();
  });
}

initializeClientsDatabase().catch((err) => {
  console.error("❌ Failed to initialize clients DB:", err);
  db.close();
});
