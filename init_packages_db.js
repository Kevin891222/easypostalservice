const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./packages.db');

db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS packages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mailbox_number INTEGER NOT NULL,
    username TEXT NOT NULL,
    image_path TEXT NOT NULL,
    length_inch REAL,           -- 可為 NULL
    width_inch REAL,            -- 可為 NULL
    height_inch REAL,           -- 可為 NULL
    weight_pound REAL,          -- 可為 NULL
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  )`, (err) => {
    if (err) {
      console.error("❌ Failed to create packages table:", err);
    } else {
      console.log("✅ packages table created successfully in packages.db.");
    }

    db.close();
  });
});