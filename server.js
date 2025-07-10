require('dotenv').config();

const express = require('express');
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
const app = express();
const PORT = process.env.PORT || 3000;


app.set('trust proxy', 1);


// ➕ Rate limit for booking
const appointmentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 3,
  message: 'Too many appointment requests, please try again later.'
});

// ➕ Session 設定
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretkey',
  resave: false,
  saveUninitialized: true,
  cookie: { httpOnly: true, secure: false }
}));

// ➕ 中介軟體
app.use(express.static(path.join(__dirname, 'public')));
app.use('/protected', express.static(path.join(__dirname, 'protected')));
app.use('/adminprotected', express.static(path.join(__dirname, 'adminprotected')));
app.use('/staffprotected', express.static(path.join(__dirname, 'staffprotected')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/api/appointment', appointmentLimiter);

// ➕ 資料庫設定
const db = new sqlite3.Database('./database.db');

// ➕ Email 設定
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// ➕ 權限中介
function isAuthenticated(req, res, next) {
  if (req.session.user) return next();
  res.status(403).send('Unauthorized');
}
function isAdmin(req, res, next) {
  if (req.session.user?.role === 'admin') return next();
  res.status(403).send('Admin access only');
}
function isStaff(req, res, next) {
  if (['admin', 'staff'].includes(req.session.user?.role)) return next();
  res.status(403).send('Staff or Admin access only');
}

// ➕ 註冊帳號
app.post('/register', (req, res) => {
  const {
    username, password, repeat_password,
    contact_name, contact_phone, contact_email,
    company_name, company_address
  } = req.body;

  if (!username || !password || !repeat_password || !contact_name) {
    return res.status(400).json({ success: false, error: "Missing required fields." });
  }

  if (password !== repeat_password) {
    return res.status(400).json({ success: false, error: "Passwords do not match." });
  }

  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) return res.status(500).json({ success: false, error: "Error hashing password." });

    const stmt = db.prepare(
      `INSERT INTO clients 
      (username, password, contact_name, contact_phone, contact_email, company_name, company_address, role) 
      VALUES (?, ?, ?, ?, ?, ?, ?, 'client')`
    );
    stmt.run(
      username, hashedPassword, contact_name, contact_phone, contact_email, company_name, company_address,
      function (err) {
        if (err) {
          if (err.message.includes('UNIQUE')) {
            return res.status(400).json({ success: false, error: "Username already exists." });
          }
          return res.status(500).json({ success: false, error: "Registration failed." });
        }
        res.json({ success: true, message: "Registration successful." });
      }
    );
  });
});


// ➕ 登入
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  const stmt = db.prepare("SELECT * FROM clients WHERE username = ?");
  stmt.get(username, async (err, user) => {
    if (err || !user) return res.status(401).send("Invalid credentials.");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send("Invalid credentials.");

    req.session.user = { username: user.username, role: user.role };
    if (user.role === 'admin') return res.redirect('/adminprotected/admin-dashboard.html');
    if (user.role === 'staff') return res.redirect('/staffprotected/staff-dashboard.html');
    return res.redirect(`/client/client-dashboard.html?username=${encodeURIComponent(user.username)}`);
  });
});

// ➕ 查詢信件數
app.get('/api/mailcount', isAuthenticated, (req, res) => {
  const { username } = req.query;
  const stmt = db.prepare("SELECT mail_count FROM clients WHERE username = ?");
  stmt.get(username, (err, row) => {
    if (err || !row) return res.status(404).json({ error: "User not found" });
    res.json({ mail_count: row.mail_count });
  });
});

// ➕ 建立預約
app.post('/api/appointment', (req, res) => {
  const { service, first_name, last_name, phone, email, date, time } = req.body;
  if (!service || !first_name || !last_name || !phone || !email || !date || !time) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  const stmt = db.prepare(
    `INSERT INTO appointments 
    (service, first_name, last_name, phone, email, date, time) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(service, first_name, last_name, phone, email, date, time, function (err) {
    if (err) return res.status(500).json({ error: err.message });

    const customerName = `${first_name} ${last_name}`;
    const logoUrl = "https://mail-system-ur12.onrender.com/image/logo.jpg";

    const notifyMail = {
      from: `"Easy Postal Services" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `📬 New Appointment - ${service}`,
      html: `<div style="font-family: Arial;"><img src="${logoUrl}" style="max-width: 180px;" />
        <h2>New Appointment</h2>
        <p><b>Service:</b> ${service}</p><p><b>Name:</b> ${customerName}</p>
        <p><b>Date:</b> ${date} ${time}</p><p><b>Email:</b> ${email}</p></div>`
    };

    const confirmMail = {
      from: `"Easy Postal Services" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Appointment Confirmation",
      html: `<div style="font-family: Arial;"><img src="${logoUrl}" style="max-width: 180px;" />
        <h2>Appointment Confirmed</h2>
        <p>Hi ${customerName},</p><p>Thank you for booking:</p>
        <p><b>Service:</b> ${service}</p><p><b>Date:</b> ${date}</p><p><b>Time:</b> ${time}</p></div>`
    };

    transporter.sendMail(notifyMail, (err1) => {
      if (err1) {
        console.error("Notify email error:", err1);
        return res.status(500).json({ success: false, error: "Failed to send notify email." });
      }

      transporter.sendMail(confirmMail, (err2) => {
        if (err2) {
          console.error("Confirm email error:", err2);
          return res.status(500).json({ success: false, error: "Failed to send confirmation email." });
        }

        res.json({ success: true, id: this.lastID });
      });
    });
  });
});

// ✅ Admin: 取得所有預約
app.get('/api/admin/appointments', isAdmin, (req, res) => {
  db.all("SELECT * FROM appointments ORDER BY date DESC, time ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json(rows);
  });
});

// ✅ Admin: 刪除指定預約
app.delete('/api/admin/appointments/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  db.run("DELETE FROM appointments WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: "Delete failed" });
    if (this.changes === 0) return res.status(404).json({ error: "Appointment not found" });
    res.json({ success: true });
  });
});

// ✅ Staff: 取得所有預約（目前不分派，只讀）
app.get('/api/staff/appointments', isStaff, (req, res) => {
  db.all("SELECT * FROM appointments ORDER BY date DESC, time ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json(rows);
  });
});

// ➕ 首頁導向
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

// ➕ 啟動
app.listen(PORT, () => {
  console.log(`✅ Server running at http://localhost:${PORT}`);
});
