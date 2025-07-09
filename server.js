const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const app = express();
const PORT = 3000;

// 設定 Gmail SMTP 寄信功能
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: 'easymialtestuse@gmail.com',
    pass: 'cackrxdylnfvgtmk' 
  }
});


// 靜態檔案目錄
app.use(express.static(path.join(__dirname, 'public')));

// 解析表單與 JSON
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// SQLite 資料庫初始化
const db = new sqlite3.Database('./database.db');

db.serialize(() => {
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
});

// 註冊路由
app.post('/register', (req, res) => {
  const {
    username, password, repeat_password,
    contact_name, contact_phone, contact_email,
    company_name, company_address
  } = req.body;

  if (!contact_name || !username || !password || !repeat_password) {
    return res.send("<p style='color:red'>Please fill out all required informations</p><a href='/register.html'>Return</a>");
  }
  if (password !== repeat_password) {
    return res.send("<p style='color:red'>Password you enter is not the same</p><a href='/register.html'>Return</a>");
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
          res.send("<p style='color:red'>Register failed, please try again</p><a href='/register.html'>Return</a>");
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
  console.log('Login request body:', req.body);

  if (!username || !password) {
    return res.status(400).send('Missing username or password');
  }

  const stmt = db.prepare("SELECT * FROM clients WHERE username = ? AND password = ?");
  stmt.get(username, password, (err, row) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).send('Server error');
    }
    console.log('Login query result:', row);
    if (row) {
      res.redirect(`/client-dashboard.html?username=${encodeURIComponent(username)}`);
    } else {
      res.status(401).send('Invalid username or password');
    }
  });
});

// 取得信件數量 API
app.get('/api/mailcount', (req, res) => {
  const { username } = req.query;
  console.log("Query mailcount username:", username);

  if (!username) return res.status(400).json({ error: "No username provided" });

  const stmt = db.prepare("SELECT mail_count FROM clients WHERE username = ?");
  stmt.get(username, (err, row) => {
    if (err || !row) {
      console.log("User not found or DB error:", err);
      return res.status(404).json({ error: "User not found" });
    }

    console.log("Mail count found:", row.mail_count);
    res.json({ mail_count: row.mail_count });
  });
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});


// POST /api/appointment - 接收預約資料
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
      return res.status(500).json({ error: 'Failed to save appointment' });
    }

    const customerFullName = `${first_name} ${last_name}`;

    // ✅ 1. 寄給老闆
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

    // ✅ 2. 寄給客戶
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

    // 發送通知信 & 確認信
    transporter.sendMail(notifyMail, (err1) => {
      if (err1) {
        console.error("Failed to send notify email:", err1.message);
      }
      transporter.sendMail(confirmMail, (err2) => {
        if (err2) {
          console.error("Failed to send confirmation email:", err2.message);
        }

        // 成功完成
        res.json({ success: true, id: this.lastID });
      });
    });
  });
});


app.get('/api/appointments', (req, res) => {
  db.all("SELECT * FROM appointments ORDER BY date DESC, time ASC", (err, rows) => {
    if (err) {
      console.error("Failed to fetch appointments:", err);
      return res.status(500).json({ error: "Database error" });
    }
    res.json(rows);
  });
});