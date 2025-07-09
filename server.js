require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();
const PORT = process.env.PORT || 3000;

// Gmail 寄信設定
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 靜態資源目錄
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 初始化 SQLite 資料庫
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
  // 建立 clients 表
  db.run(`CREATE TABLE IF NOT EXISTS clients (
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

  // 建立 appointments 表
  db.run(`CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    service TEXT,
    first_name TEXT,
    last_name TEXT,
    phone TEXT,
    email TEXT,
    date TEXT,
    time TEXT
  )`);
});

// 註冊路由
app.post('/register', (req, res) => {
  const {
    username, password, repeat_password,
    contact_name, contact_phone, contact_email,
    company_name, company_address
  } = req.body;

  if (!contact_name || !username || !password || !repeat_password) {
    return res.send("<p style='color:red'>Please fill out all required information</p><a href='/register.html'>Return</a>");
  }
  if (password !== repeat_password) {
    return res.send("<p style='color:red'>Passwords do not match</p><a href='/register.html'>Return</a>");
  }

  const stmt = db.prepare(`
    INSERT INTO clients (username, password, contact_name, contact_phone, contact_email, company_name, company_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    username, password, contact_name, contact_phone, contact_email, company_name, company_address,
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          res.send("<p style='color:red'>Account already exists</p><a href='/register.html'>Return</a>");
        } else {
          console.error("Register error:", err);
          res.send("<p style='color:red'>Registration failed, please try again</p><a href='/register.html'>Return</a>");
        }
      } else {
        res.send(`<h2>Registration successful, welcome ${contact_name}!</h2><a href='/client.html'>Go to Login</a>`);
      }
    }
  );
});

// 登入路由
app.post('/login', (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).send('Missing username or password');
  }

  const stmt = db.prepare("SELECT * FROM clients WHERE username = ? AND password = ?");
  stmt.get(username, password, (err, row) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).send('Server error');
    }

    if (row) {
      res.redirect(`/client-dashboard.html?username=${encodeURIComponent(username)}`);
    } else {
      res.status(401).send('Invalid username or password');
    }
  });
});

// 查詢信件數量
app.get('/api/mailcount', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "No username provided" });

  const stmt = db.prepare("SELECT mail_count FROM clients WHERE username = ?");
  stmt.get(username, (err, row) => {
    if (err || !row) {
      return res.status(404).json({ error: "User not found" });
    }
    res.json({ mail_count: row.mail_count });
  });
});

// appointment 提交
app.post('/api/appointment', (req, res) => {
  const { service, first_name, last_name, phone, email, date, time } = req.body;

  if (!first_name || !last_name || !phone || !email || !date || !time || !service) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const stmt = db.prepare(`
    INSERT INTO appointments (service, first_name, last_name, phone, email, date, time)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(service, first_name, last_name, phone, email, date, time, function (err) {
    if (err) {
      console.error("Insert appointment failed:", err.message);
      return res.status(500).json({ error: err.message });
    }

    const customerFullName = `${first_name} ${last_name}`;

    const notifyMail = {
      from: '"Easy Postal Services" <easymialtestuse@gmail.com>',
      to: 'easymialtestuse@gmail.com',
      subject: `📬 New Appointment - ${service}`,
      text: `
New appointment received:

Service: ${service}
Customer: ${customerFullName}
Phone: ${phone}
Email: ${email}
Date: ${date}
Time: ${time}
      `
    };

    const confirmMail = {
      from: '"Easy Postal Services" <easymialtestuse@gmail.com>',
      to: email,
      subject: 'Appointment Confirmation',
      text: `
Hi ${customerFullName},

Thank you for booking a service with Easy Postal Services.

Service: ${service}
Date: ${date}
Time: ${time}

We look forward to seeing you!

Best regards,
Easy Postal Services
      `
    };

	transporter.sendMail(notifyMail, (err1, info1) => {
		  if (err1) {
			console.error("Notify email error:", err1.message);
			return res.status(500).json({ success: false, error: 'Notify email failed: ' + err1.message });
		  }

		  transporter.sendMail(confirmMail, (err2, info2) => {
			if (err2) {
			  console.error("Confirm email error:", err2.message);
			  return res.status(500).json({ success: false, error: 'Confirm email failed: ' + err2.message });
			}

			res.json({ success: true, id: this.lastID });
		  });
		});
	}); // <== 這是你漏掉的關閉大括號！
});     // <== 這是 appointment 路由的結尾

// 取得所有預約
app.get('/api/appointments', (req, res) => {
  db.all("SELECT * FROM appointments ORDER BY date DESC, time ASC", (err, rows) => {
    if (err) {
      console.error("Failed to fetch appointments:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});

// 首頁
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// 啟動伺服器
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});