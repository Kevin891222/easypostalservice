const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./packages.db');

db.run("ALTER TABLE packages ADD COLUMN pdf_path TEXT", (err) => {
  if (err) {
    if (err.message.includes("duplicate column name")) {
      console.log("🔁 Column already exists.");
    } else {
      console.error("❌ Migration failed:", err.message);
    }
  } else {
    console.log("✅ pdf_path column added successfully.");
  }
  db.close();
});
