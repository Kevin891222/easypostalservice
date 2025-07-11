// init_appointments_db.js
const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./appointments.db');

async function initializeAppointmentsDatabase() {
  await new Promise((resolve, reject) => {
    db.run(`DROP TABLE IF EXISTS appointments`, (err) => (err ? reject(err) : resolve()));
  });

  await new Promise((resolve, reject) => {
    db.run(`CREATE TABLE appointments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      service TEXT,
      first_name TEXT,
      last_name TEXT,
      phone TEXT,
      email TEXT,
      date TEXT,
      time TEXT
    )`, (err) => {
      if (err) reject(err);
      else {
        console.log("✅ Appointments table created.");
        resolve();
      }
    });
  });

  db.close();
}

initializeAppointmentsDatabase().catch((err) => {
  console.error("❌ Failed to initialize appointments DB:", err);
  db.close();
});