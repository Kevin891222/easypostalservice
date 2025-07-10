
if (process.env.INIT_DB === 'true') {
  require('./init_db');
}

require('dotenv').config();

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const app = express();
const PORT = process.env.PORT || 3000;



const rateLimit = require('express-rate-limit');

// 對 /api/appointment 限制每個 IP 每分鐘最多 5 次
const appointmentLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 分鐘
  max: 3,
  message: 'Too many appointment requests, please try again later.'
});

app.use('/api/appointment', appointmentLimiter);





// Gmail 寄信設定
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// 靜態資源與中介軟體設定
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// 初始化 SQLite 資料庫
const db = new sqlite3.Database('./database.db');

// 註冊新帳號
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

  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) return res.send("Error encrypting password");

    const stmt = db.prepare(`
      INSERT INTO clients (username, password, contact_name, contact_phone, contact_email, company_name, company_address)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      username, hashedPassword, contact_name, contact_phone, contact_email, company_name, company_address,
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
});

// 登入驗證
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).send('Missing username or password');
  }

  const stmt = db.prepare("SELECT * FROM clients WHERE username = ?");
  stmt.get(username, async (err, row) => {
    if (err) {
      console.error('DB error:', err);
      return res.status(500).send('Server error');
    }

    if (!row) {
      return res.status(401).send('Invalid username or password');
    }

    const match = await bcrypt.compare(password, row.password); // bcrypt 驗證
    if (match) {
      if (username === 'jchung') {
        return res.redirect('/admin-dashboard.html');
      } else {
        return res.redirect(`/client-dashboard.html?username=${encodeURIComponent(username)}`);
      }
    } else {
      return res.status(401).send('Invalid username or password');
    }
  });
});


// 查詢信件數量
app.get('/api/mailcount', (req, res) => {
  const { username } = req.query;
  if (!username) return res.status(400).json({ error: "No username provided" });

  const stmt = db.prepare("SELECT mail_count FROM clients WHERE username = ?");
  stmt.get(username, (err, row) => {
    if (err || !row) return res.status(404).json({ error: "User not found" });
    res.json({ mail_count: row.mail_count });
  });
});




// appointment 預約處理
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
    if (err) return res.status(500).json({ error: err.message });

    const customerFullName = `${first_name} ${last_name}`;
    const logoUrl = "https://mail-system-ur12.onrender.com/image/logo.jpg";

    // ✅ 寄給老闆
    const notifyMail = {
      from: `"Easy Postal Services" <${process.env.EMAIL_USER}>`,
      to: process.env.EMAIL_USER,
      subject: `📬 New Appointment - ${service}`,
      text: `
New appointment received:

Service: ${service}
Customer: ${customerFullName}
Phone: ${phone}
Email: ${email}
Date: ${date}
Time: ${time}

Company Logo: ${logoUrl}
      `,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <img src="${logoUrl}" alt="Company Logo" style="max-width: 180px;"><br>
          <h2>📬 New Appointment Received</h2>
          <p><strong>Service:</strong> ${service}</p>
          <p><strong>Customer:</strong> ${customerFullName}</p>
          <p><strong>Phone:</strong> ${phone}</p>
          <p><strong>Email:</strong> ${email}</p>
          <p><strong>Date:</strong> ${date}</p>
          <p><strong>Time:</strong> ${time}</p>
        </div>
      `
    };

    // ✅ 寄給客戶
    const confirmMail = {
      from: `"Easy Postal Services" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Appointment Confirmation',
      text: `
Hi ${customerFullName},

Thank you for booking a service.

Service: ${service}
Date: ${date}
Time: ${time}

We look forward to seeing you.

Easy Postal Services

Logo: ${logoUrl}
      `,
      html: `
        <div style="font-family: Arial, sans-serif;">
          <img src="${logoUrl}" alt="Company Logo" style="max-width: 180px;"><br>
          <h2>Appointment Confirmation</h2>
          <p>Hi ${customerFullName},</p>
          <p>Thank you for booking a service with <strong>Easy Postal Services</strong>.</p>
          <p><strong>Service:</strong> ${service}</p>
          <p><strong>Date:</strong> ${date}</p>
          <p><strong>Time:</strong> ${time}</p>
          <p>We look forward to seeing you!</p>
        </div>
      `
    };

    transporter.sendMail(notifyMail, (err1) => {
      if (err1) return res.status(500).json({ success: false, error: 'Notify email failed: ' + err1.message });

      transporter.sendMail(confirmMail, (err2) => {
        if (err2) return res.status(500).json({ success: false, error: 'Confirm email failed: ' + err2.message });

        res.json({ success: true, id: this.lastID });
      });
    });
  });
});





// 取得所有預約
app.get('/api/appointments', (req, res) => {
  db.all("SELECT * FROM appointments ORDER BY date DESC, time ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: "Database error" });
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
