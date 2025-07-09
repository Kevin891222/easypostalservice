const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./database.db');

const username = 'jchung';
const password = 'Jasper@6954';
const contactName = 'Administrator';

db.run(`
  INSERT INTO clients (username, password, contact_name)
  VALUES (?, ?, ?)
`, [username, password, contactName], function (err) {
  if (err) {
    return console.error("❌ Failed to create admin:", err.message);
  }
  console.log("✅ Admin account created.");
  db.close();
});