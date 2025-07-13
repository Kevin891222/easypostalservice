require('dotenv').config();

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const express = require('express');
const app = express();
const session = require('express-session');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const nodemailer = require('nodemailer');
const bcrypt = require('bcrypt');
const rateLimit = require('express-rate-limit');
	
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
app.use('/protected', isAuthenticated, express.static(path.join(__dirname, 'protected')));
app.use('/adminprotected', isAdmin, express.static(path.join(__dirname, 'adminprotected')));
app.use('/staffprotected', isStaff, express.static(path.join(__dirname, 'staffprotected')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use('/api/appointment', appointmentLimiter);

// ➕ 資料庫設定
const clientsDB = new sqlite3.Database('./clients.db');
const appointmentsDB = new sqlite3.Database('./appointments.db');
const packagesDB = new sqlite3.Database('./packages.db');
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
app.post('/register', isStaff, (req, res) => {
  const {
    username, password, repeat_password,
    contact_name, contact_phone, contact_email,
    company_name
  } = req.body;

  if (!username || !password || !repeat_password || !contact_name) {
    return res.status(400).json({ success: false, error: "Missing required fields." });
  }

  if (password !== repeat_password) {
    return res.status(400).json({ success: false, error: "Passwords do not match." });
  }

  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) return res.status(500).json({ success: false, error: "Error hashing password." });

    const stmt = clientsDB.prepare(
      `INSERT INTO clients 
      (username, password, contact_name, contact_phone, contact_email, company_name, role) 
      VALUES (?, ?, ?, ?, ?, ?, 'client')`
    );
    stmt.run(
      username, hashedPassword, contact_name, contact_phone, contact_email, company_name,
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
  const stmt = clientsDB.prepare("SELECT * FROM clients WHERE username = ?");
  stmt.get(username, async (err, user) => {
    if (err || !user) return res.status(401).send("Invalid credentials.");
    const match = await bcrypt.compare(password, user.password);
    if (!match) return res.status(401).send("Invalid credentials.");

    req.session.user = {
      username: user.username,
      role: user.role,
      mailbox_number: user.mailbox_number
    };

    if (user.role === 'admin') return res.redirect('/adminprotected/admin-dashboard.html');
    if (user.role === 'staff') return res.redirect('/staffprotected/staff-dashboard.html');
    return res.redirect(`/client/client-dashboard.html?username=${encodeURIComponent(user.username)}`);
  });
});

// ➕ 查詢信件數
app.get('/api/mailcount', isAuthenticated, (req, res) => {
  const { username } = req.query;
  const stmt = clientsDB.prepare("SELECT mail_count FROM clients WHERE username = ?");
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

  const stmt = appointmentsDB.prepare(
    `INSERT INTO appointments 
    (service, first_name, last_name, phone, email, date, time) 
    VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(service, first_name, last_name, phone, email, date, time, function (err) {
    if (err) return res.status(500).json({ error: err.message });

    const appointmentId = this.lastID;
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

    transporter.sendMail(notifyMail, function (err1) {
      if (err1) {
        console.error("Notify email error:", err1);
        return res.status(500).json({ success: false, error: "Failed to send notify email." });
      }

      transporter.sendMail(confirmMail, function (err2) {
        if (err2) {
          console.error("Confirm email error:", err2);
          return res.status(500).json({ success: false, error: "Failed to send confirmation email." });
        }

        res.json({ success: true, id: appointmentId });
      });
    });
  });
});

// ✅ Admin: 取得所有預約
app.get('/api/admin/appointments', isAdmin, (req, res) => {
  appointmentsDB.all("SELECT * FROM appointments ORDER BY date DESC, time ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json(rows);
  });
});

// ✅ 編輯客戶資訊
app.put('/api/admin/clients/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  const { contact_name, contact_phone, contact_email, company_name } = req.body;

  const stmt = clientsDB.prepare(`
    UPDATE clients SET
      contact_name = ?,
      contact_phone = ?,
      contact_email = ?,
      company_name = ?
    WHERE mailbox_number = ?
  `);
  stmt.run(contact_name, contact_phone, contact_email, company_name, id, function (err) {
    if (err) return res.status(500).json({ success: false, error: err.message });
    res.json({ success: true });
  });
});

// ✅ Admin: 刪除指定預約
app.delete('/api/admin/appointments/:id', isAdmin, (req, res) => {
  const { id } = req.params;
  appointmentsDB.run("DELETE FROM appointments WHERE id = ?", [id], function (err) {
    if (err) return res.status(500).json({ error: "Delete failed" });
    if (this.changes === 0) return res.status(404).json({ error: "Appointment not found" });
    res.json({ success: true });
  });
});

// ✅ Staff: 取得所有預約
app.get('/api/staff/appointments', isStaff, (req, res) => {
  appointmentsDB.all("SELECT * FROM appointments ORDER BY date DESC, time ASC", (err, rows) => {
    if (err) return res.status(500).json({ error: "DB error" });
    res.json(rows);
  });
});

// ✅ Admin 或 Staff: 取得所有 client 資料（不含密碼）
app.get('/api/admin/clients', isStaff, (req, res) => {
  clientsDB.all(`
    SELECT mailbox_number, username, role, mail_count, contact_name, contact_phone, contact_email, company_name 
    FROM clients 
    ORDER BY mailbox_number ASC
  `, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error." });
    }
    res.json(rows);
  });
});


const fs = require('fs');

// ✅ 允許的圖片格式與副檔名
const allowedFileTypes = [
  'image/jpeg', 'image/jpg', 'image/png', 'application/pdf'
];
const mimeToExt = {
  'image/jpeg': '.jpeg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'application/pdf': '.pdf'
};

// 🧱 建立根資料夾
const baseDir = path.join(__dirname, 'upload_mail_image');
if (!fs.existsSync(baseDir)) fs.mkdirSync(baseDir);

// 🔧 Multer 設定
const storage = multer.memoryStorage();

app.post('/api/staff/upload-package', isStaff, upload.fields([
  { name: 'image', maxCount: 1 },
  { name: 'pdf', maxCount: 1 }
]), (req, res) => {
  const { mailbox_number, length_inch, width_inch, height_inch, weight_pound, username } = req.body;

  const imageFile = req.files?.image?.[0];
  const pdfFile = req.files?.pdf?.[0];

  if (!mailbox_number || !username || !imageFile) {
    return res.status(400).json({ success: false, error: "Missing required fields (mailbox number, username, image)." });
  }

  if (!/^[1-9]\d*$/.test(mailbox_number)) {
    return res.status(400).json({ success: false, error: "Mailbox number must be a positive integer." });
  }

  // 建立對應資料夾
  const folderPath = path.join(baseDir, mailbox_number);
  if (!fs.existsSync(folderPath)) fs.mkdirSync(folderPath, { recursive: true });

  const safeParse = v => v ? parseFloat(v) : null;
  const length = safeParse(length_inch);
  const width = safeParse(width_inch);
  const height = safeParse(height_inch);
  const weight = safeParse(weight_pound);

  // 處理檔案儲存邏輯（支援 image 與 pdf）
  const saveFile = (file, index) => {
    const fileType = file.mimetype;
    if (!allowedFileTypes.includes(fileType)) {
      throw new Error(`Unsupported file type: ${fileType}`);
    }

    const ext = mimeToExt[fileType] || '.bin';
    const existingFiles = fs.readdirSync(folderPath).filter(f => f.startsWith(username + '_'));
    const fileName = `${username}_${existingFiles.length + index}${ext}`;
    const fullPath = path.join(folderPath, fileName);
    fs.writeFileSync(fullPath, file.buffer);
    return path.relative(__dirname, fullPath).replace(/\\/g, '/');
  };

  let image_path = null;
  let pdf_path = null;

  try {
    image_path = saveFile(imageFile, 1);
    if (pdfFile) pdf_path = saveFile(pdfFile, 2);
  } catch (err) {
    console.error("File save error:", err);
    return res.status(400).json({ success: false, error: err.message });
  }

  // 儲存資料到 DB
  const stmt = packagesDB.prepare(`
    INSERT INTO packages (mailbox_number, image_path, pdf_path, length_inch, width_inch, height_inch, weight_pound)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    parseInt(mailbox_number),
    image_path,
    pdf_path,
    length,
    width,
    height,
    weight,
    function (err) {
      if (err) {
        console.error("DB insert failed:", err);
        return res.status(500).json({ success: false, error: "Database insert failed." });
      }
      res.json({ success: true, id: this.lastID, image_path, pdf_path });
    }
  );
});


// 🔍 查詢 mailbox_number 對應的 username
app.get('/api/mailbox-to-username/:mailbox', isStaff, (req, res) => {
  const mailbox = parseInt(req.params.mailbox);
  if (isNaN(mailbox)) {
    return res.status(400).json({ error: "Invalid mailbox number" });
  }

  clientsDB.get("SELECT username FROM clients WHERE mailbox_number = ?", [mailbox], (err, row) => {
    if (err) {
      console.error("❌ Database error:", err);
      return res.status(500).json({ error: "Database error" });
    }
    if (!row) return res.status(404).json({ error: "Mailbox not found" });

    res.json({ username: row.username });
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
