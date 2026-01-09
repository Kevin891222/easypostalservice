// .env 不是必要，有就載入（保留一個就好）
try { require('dotenv').config(); } catch (e) { console.log('dotenv not used'); }

// bcrypt：優先用原生；失敗則退回純 JS 版
let bcrypt;
try { bcrypt = require('bcrypt'); }
catch { bcrypt = require('bcryptjs'); console.log('fallback to bcryptjs'); }

// sqlite3：一定要成功載入；失敗就印原因並中止
let sqlite3;
try { sqlite3 = require('sqlite3').verbose(); }
catch (e) {
  console.error('Failed to load sqlite3:', e && e.message);
  process.exit(1);
}

const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });
const express = require('express');
const app = express();               // 只保留這一行，底下那行「app = app || ...」請刪掉
const session = require('express-session');
const path = require('path');
const nodemailer = require('nodemailer');
const rateLimit = require('express-rate-limit');


app.set('trust proxy', 1);



//////////////////////

// 設定靜態資源路徑
app.use(express.static(path.join(__dirname, 'public')));
app.use('/upload_mail_image', express.static(path.join(__dirname, 'upload_mail_image')));
// 預設首頁導向 public/index.html
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});


///////////////////////


// ➕ Rate limit for booking
const appointmentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 2,
  message: 'Too many appointment requests, please try again later.'
});

// ➕ Session 設定
app.use(session({
  secret: process.env.SESSION_SECRET || 'supersecretkey',
  resave: false,
  saveUninitialized: false,
  rolling: true, // 每次互動刷新時效
  cookie: {
    httpOnly: true,
    secure: false, // 記得部署到 HTTPS 時要改成 true
    maxAge: 30 * 60 * 1000 // 30分鐘
  }
}));


// ✅ 提供 session 資訊
app.get('/api/session', (req, res) => {
  if (!req.session.user) {
    return res.status(401).json({ error: "Not logged in" });
  }

  res.json({
    username: req.session.user.username,
    role: req.session.user.role,
    mailbox_number: req.session.user.mailbox_number
  });
});


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
const announcementDB = new sqlite3.Database('./announcement.db');
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
  if (req.session.user) {
    next();
  } else {
    res.status(401).send('Unauthorized');
  }
}

function isAdmin(req, res, next) {
  if (req.session.user && req.session.user.role === 'admin') {
    next();
  } else {
    res.status(403).send('Access denied. Admins only.');
  }
}
function isStaff(req, res, next) {
  if (req.session.user && (req.session.user.role === 'staff' || req.session.user.role === 'admin')) {
    next();
  } else {
    res.status(403).send('Access denied. Staff only.');
  }
}



app.use('/clientsinfor.html', isStaff, express.static(path.join(__dirname)));
app.use('/tasks.html', isStaff, express.static(path.join(__dirname)));
app.use('/register.html', isStaff, express.static(path.join(__dirname)));
app.use('/upload-package.html', isStaff, express.static(path.join(__dirname)));

app.use('/client-dashboard.html', isAuthenticated, express.static(path.join(__dirname)));




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

  // 最小可用 mailbox_number（從 1 開始找缺號）
  function findAvailableMailboxNumber(callback) {
    clientsDB.all("SELECT mailbox_number FROM clients ORDER BY mailbox_number ASC", (err, rows) => {
      if (err) return callback(err);

      const used = new Set(rows.map(r => r.mailbox_number));
      let i = 1;
      while (used.has(i)) i++;
      callback(null, i);
    });
  }

  bcrypt.hash(password, 10, (err, hashedPassword) => {
    if (err) return res.status(500).json({ success: false, error: "Error hashing password." });

    findAvailableMailboxNumber((err1, mailbox_number) => {
      if (err1) return res.status(500).json({ success: false, error: "Failed to assign mailbox number." });

      const stmt = clientsDB.prepare(
        `INSERT INTO clients 
        (username, password, contact_name, contact_phone, contact_email, company_name, role, mailbox_number) 
        VALUES (?, ?, ?, ?, ?, ?, 'client', ?)`
      );

      stmt.run(
        username, hashedPassword, contact_name, contact_phone, contact_email, company_name, mailbox_number,
        function (err2) {
          if (err2) {
            if (err2.message.includes('UNIQUE')) {
              return res.status(400).json({ success: false, error: "Username already exists." });
            }
            return res.status(500).json({ success: false, error: "Registration failed." });
          }

          res.json({ success: true, message: `Registration successful. Assigned mailbox #${mailbox_number}` });
        }
      );
    });
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


app.post('/api/package-actions/:id/resolve', isStaff, (req, res) => {
  const id = req.params.id;
  packagesDB.run(
    `UPDATE package_actions SET status = 'done' WHERE id = ?`,
    [id],
    function (err) {
      if (err) {
        console.error("❌ Failed to update package action status:", err);
        return res.status(500).json({ error: "Update failed" });
      }
      res.json({ success: true });
    }
  );
});

// 發布公告
app.post('/api/announcement', isAdmin, (req, res) => {
  const { content } = req.body;
  if (!content || content.trim() === '') {
    return res.status(400).json({ error: 'Content cannot be empty' });
  }

  announcementDB.run(`INSERT INTO announcements (content) VALUES (?)`, [content], function(err) {
    if (err) {
      console.error(err);
      return res.status(500).json({ error: 'Database error' });
    }
    res.json({ success: true, id: this.lastID });
  });
});


// index page 查看公告
app.get('/api/announcement', (req, res) => {
  announcementDB.all(
    `SELECT content, created_at FROM announcements ORDER BY created_at DESC`,
    (err, rows) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: 'Database error' });
      }
      res.json(rows);
    }
  );
});

app.get('/api/announcement/all', isAdmin, (req, res) => {
  announcementDB.all(`SELECT id, content, created_at FROM announcements ORDER BY created_at DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: 'Database error' });
    res.json(rows);
  });
});


app.delete('/api/announcement/:id', isAdmin, (req, res) => {
  const id = req.params.id;
  announcementDB.run(`DELETE FROM announcements WHERE id = ?`, [id], function(err) {
    if (err) return res.status(500).json({ error: 'Database error' });
    if (this.changes === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ success: true });
  });
});


// 管理員讀取所有待處理的包裹動作
	app.get('/api/admin/package-actions', isStaff, (req, res) => {
	  const { username, action, contact } = req.query;

	  // 先決條件：若帶了 contact，先去 clients.db 找符合的 mailbox 列表
	  const fetchMailboxNumbersForContact = (cb) => {
		if (!contact) return cb(null, null); // 不用過濾

		clientsDB.all(
		  `SELECT assign_mailbox_number 
			 FROM clients 
			WHERE contact_name LIKE ? COLLATE NOCASE`,
		  [`%${contact}%`],
		  (err, rows) => {
			if (err) return cb(err);
			const mailboxList = rows.map(r => String(r.assign_mailbox_number));
			// 若找不到任何信箱，後面可直接回空陣列
			cb(null, mailboxList);
		  }
		);
	  };

	  fetchMailboxNumbersForContact((preErr, mailboxFilter) => {
		if (preErr) {
		  console.error("❌ Failed to search contacts:", preErr.message);
		  return res.status(500).json({ error: 'Failed to search contacts' });
		}

		// 若 contact 有帶，但找不到對應信箱，直接回空
		if (contact && (!mailboxFilter || mailboxFilter.length === 0)) {
		  return res.json([]);
		}

		// 1) 在 packages.db 撈動作 + 包裹（可選 username/action；若有 contact → 以 mailbox 過濾）
		let baseQuery = `
		  SELECT 
			pa.*,
			p.mailbox_number,
			p.custom_package_id,
			p.category, p.length_inch, p.width_inch, p.height_inch, p.weight_pound
		  FROM package_actions pa
		  JOIN packages p ON pa.package_id = p.id
		  WHERE pa.status = 'pending'
		`;
		const params = [];

		if (username) { baseQuery += ' AND pa.username = ?'; params.push(username); }
		if (action)   { baseQuery += ' AND pa.action = ?';   params.push(action); }

		if (mailboxFilter && mailboxFilter.length > 0) {
		  const ph = mailboxFilter.map(() => '?').join(',');
		  baseQuery += ` AND CAST(p.mailbox_number AS TEXT) IN (${ph})`;
		  params.push(...mailboxFilter);
		}

		baseQuery += ' ORDER BY pa.created_at DESC';

		packagesDB.all(baseQuery, params, (err, actions) => {
		  if (err) {
			console.error("❌ Failed to fetch actions:", err.message);
			return res.status(500).json({ error: 'Failed to fetch actions' });
		  }
		  if (actions.length === 0) return res.json([]);

		  // 2) 取對應檔案（仍在 packages.db）
		  const packageIds = actions.map(a => a.package_id);
		  const placeholders = packageIds.map(() => '?').join(',');
		  packagesDB.all(
			`SELECT package_id, file_path, file_type 
			   FROM package_files 
			  WHERE package_id IN (${placeholders})`,
			packageIds,
			(err2, files) => {
			  if (err2) {
				console.error("❌ Failed to fetch package files:", err2.message);
				return res.status(500).json({ error: 'Failed to fetch package files' });
			  }

			  const fileMap = {};
			  for (const f of files) {
				if (!fileMap[f.package_id]) fileMap[f.package_id] = [];
				fileMap[f.package_id].push({ file_path: f.file_path, file_type: f.file_type });
			  }

			  // 3) 用 clients.db 依 mailbox_number 取 contact_name（一次批次）
			  const boxNums = [...new Set(actions.map(a => String(a.mailbox_number)))];
			  const boxPH   = boxNums.map(() => '?').join(',');
			  const contactMap = {};

			  const finish = () => {
				const enriched = actions.map(a => ({
				  ...a,
				  files: fileMap[a.package_id] || [],
				  contact_name: contactMap[String(a.mailbox_number)] || null
				}));
				res.json(enriched);
			  };

			  if (boxNums.length === 0) return finish();

			  clientsDB.all(
				`SELECT assign_mailbox_number, contact_name 
				   FROM clients 
				  WHERE assign_mailbox_number IN (${boxPH})`,
				boxNums,
				(err3, rows) => {
				  if (err3) {
					console.error("❌ Failed to fetch contact names:", err3.message);
					// 不擋流程，直接回傳無 contact_name 的資料
					return finish();
				  }
				  rows.forEach(r => { contactMap[String(r.assign_mailbox_number)] = r.contact_name; });
				  finish();
				}
			  );
			}
		  );
		});
	  });
	});




// 管理員更新處理狀態（例如 Mark 為 done）
app.post('/api/admin/package-actions/update', isStaff, (req, res) => {
  const { action_id, new_status } = req.body;

  if (!action_id || !new_status) {
    return res.status(400).json({ error: 'Missing data' });
  }

  packagesDB.run(`
    UPDATE package_actions SET status = ? WHERE id = ?
  `, [new_status, action_id], function(err) {
    if (err) {
      console.error("❌ Failed to update status:", err.message);
      return res.status(500).json({ error: 'Update failed' });
    }
    res.json({ success: true });
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
    const logoUrl = "https://easypostalservices.net/image/logo.jpg";

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

// ✅ 編輯客戶資訊（含 assign_mailbox_number 驗證與唯一性檢查）
app.put('/api/admin/clients/:id', isStaff, (req, res) => {
  const { id } = req.params;
  let { contact_name, contact_phone, contact_email, company_name, assign_mailbox_number } = req.body;

  // 正規化：空字串→NULL，去掉多餘空白
  if (typeof assign_mailbox_number === 'string') {
    assign_mailbox_number = assign_mailbox_number.trim();
    if (assign_mailbox_number === '') assign_mailbox_number = null;
  } else if (assign_mailbox_number == null) {
    assign_mailbox_number = null;
  }

  // 格式檢查（可依需求調整長度）
  if (assign_mailbox_number && !/^\d{1,6}$/.test(assign_mailbox_number)) {
    return res.status(400).json({ success: false, error: 'assign_mailbox_number must be 1–6 digits.' });
  }

  const doUpdate = () => {
    const stmt = clientsDB.prepare(`
      UPDATE clients SET
        assign_mailbox_number = ?,
        contact_name = ?,
        contact_phone = ?,
        contact_email = ?,
        company_name = ?
      WHERE mailbox_number = ?
    `);
    stmt.run(
      assign_mailbox_number,
      contact_name,
      contact_phone,
      contact_email,
      company_name,
      id,
      function (err) {
        if (err) return res.status(500).json({ success: false, error: err.message });
        res.json({ success: true });
      }
    );
  };

  // 為 NULL 就不需要唯一性檢查
  if (assign_mailbox_number === null) return doUpdate();

  // 唯一性檢查（避免指派到別人的號碼）
  clientsDB.get(
    `SELECT mailbox_number FROM clients
     WHERE assign_mailbox_number = ? AND mailbox_number <> ?`,
    [assign_mailbox_number, id],
    (err, row) => {
      if (err) return res.status(500).json({ success: false, error: err.message });
      if (row) return res.status(409).json({ success: false, error: 'assign_mailbox_number already in use.' });
      doUpdate();
    }
  );
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
    SELECT mailbox_number, username, role, mail_count, contact_name, contact_phone, contact_email, company_name, assign_mailbox_number 
    FROM clients
    WHERE role = 'client'
    ORDER BY mailbox_number ASC
  `, (err, rows) => {
    if (err) {
      console.error("DB error:", err);
      return res.status(500).json({ error: "Database error." });
    }
    res.json(rows);
  });
});


// ✅ 依 assign_mailbox_number（或 contact_name）查詢目前未處理的包裹
app.get('/api/admin/client-packages', isStaff, (req, res) => {
  // 支援 ?assign= 或 ?assign_mailbox_number=，取其一；不再接受 mailbox
  const assign = (req.query.assign ?? req.query.assign_mailbox_number ?? '').toString().trim();
  const name = (req.query.name ?? '').toString().trim();

  if (!assign && !name) {
    return res.status(400).json({ error: 'Please provide assign (assign_mailbox_number) or name' });
  }

  let clientQuery = `SELECT * FROM clients WHERE `;
  const params = [];

  if (assign) {
    clientQuery += 'assign_mailbox_number = ?';
    params.push(assign);          // ⚠️ 不要 parseInt，避免去掉前導零
  } else {
    clientQuery += 'contact_name LIKE ?';
    params.push(`%${name}%`);
  }

  clientsDB.get(clientQuery, params, (err, client) => {
    if (err) {
      console.error('clients lookup error:', err);
      return res.status(500).json({ error: 'Failed to load client' });
    }
    if (!client) {
      return res.status(404).json({ error: 'Client not found (by assign or name)' });
    }

    // 取出未處理完成的包裹（沿用 username 關聯）
    const username = client.username;
    const pkgQuery = `
	SELECT 
	  p.*,
	  COALESCE(a.status, 'none') AS action_status
	FROM packages p
	LEFT JOIN (
	  SELECT package_id, status 
	  FROM package_actions 
	  WHERE status = 'pending'
	) a ON a.package_id = p.id
	WHERE p.username = ?
	ORDER BY p.created_at DESC
    `;

    packagesDB.all(pkgQuery, [username], (err2, packages) => {
      if (err2) {
        console.error('packages lookup error:', err2);
        return res.status(500).json({ error: 'Failed to load packages' });
      }

      if (packages.length === 0) {
        return res.json({ client, packages: [] });
      }

      const pkgIds = packages.map(p => p.id);
      const placeholders = pkgIds.map(() => '?').join(',');

      packagesDB.all(
        `SELECT package_id, file_path, file_type FROM package_files WHERE package_id IN (${placeholders})`,
        pkgIds,
        (err3, files) => {
          if (err3) {
            console.error('files lookup error:', err3);
            return res.status(500).json({ error: 'Failed to fetch files' });
          }

          const fileMap = {};
          for (const f of files) {
            if (!fileMap[f.package_id]) fileMap[f.package_id] = [];
            fileMap[f.package_id].push({ path: f.file_path, type: f.file_type });
          }

          const result = packages.map(pkg => ({
            ...pkg,
            files: fileMap[pkg.id] || []
          }));

          res.json({ 
            client: {
              mailbox_number: client.mailbox_number,
              assign_mailbox_number: client.assign_mailbox_number,
              username: client.username,
              contact_name: client.contact_name,
              contact_email: client.contact_email,
              company_name: client.company_name,
            },
            packages: result 
          });
        }
      );
    });
  });
});


// 🔒 刪除指定包裹並更新 mail count
// 🔒 刪除指定包裹（支援 custom_package_id 或數字 id）
app.delete('/api/admin/package/:id', isStaff, (req, res) => {
  const key = req.params.id; // 可能是 custom 或 數字

  // 先用 custom_package_id 找
  packagesDB.get(`SELECT id, username FROM packages WHERE custom_package_id = ?`, [key], (e1, p1) => {
    const proceedWithId = (numericId, username) => {
      // 先拿檔案
      packagesDB.all(`SELECT file_path FROM package_files WHERE package_id = ?`, [numericId], (err2, files) => {
        if (err2) return res.status(500).json({ error: 'Failed to get files' });

        // 刪物理檔
        for (const f of files) {
          const fullPath = path.join(__dirname, 'upload_mail_image', f.file_path);
          fs.unlink(fullPath, (err) => { if (err) console.warn('Failed to delete file:', fullPath); });
        }

        // 刪資料
        packagesDB.run(`DELETE FROM package_files WHERE package_id = ?`, [numericId]);
        packagesDB.run(`DELETE FROM package_actions WHERE package_id = ?`, [numericId]);
        packagesDB.run(`DELETE FROM packages WHERE id = ?`, [numericId], function (err3) {
          if (err3) return res.status(500).json({ error: 'Failed to delete package' });
          clientsDB.run(`UPDATE clients SET mail_count = mail_count - 1 WHERE username = ?`, [username], (err4) => {
            if (err4) return res.status(500).json({ error: 'Failed to update mail count' });
            res.json({ success: true });
          });
        });
      });
    };

    if (p1) {
      // 用 custom 找到 => 轉數字 id 刪除
      return proceedWithId(p1.id, p1.username);
    }

    // 再嘗試當數字 id 查詢（舊前端）
    if (!/^\d+$/.test(key)) return res.status(404).json({ error: 'Package not found' });

    packagesDB.get(`SELECT username FROM packages WHERE id = ?`, [key], (e2, p2) => {
      if (e2 || !p2) return res.status(404).json({ error: 'Package not found' });
      proceedWithId(parseInt(key, 10), p2.username);
    });
  });
});


app.get('/api/mailbox-to-username/:mailbox', isStaff, (req, res) => {
  const mailbox = req.params.mailbox;
  clientsDB.get(
    "SELECT username FROM clients WHERE assign_mailbox_number = ?",
    [mailbox],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!row) return res.status(404).json({ error: "Mailbox Number not found" });
      res.json({ username: row.username });
    }
  );
});



const fs = require('fs');

app.use('/upload_mail_image', express.static(path.join(__dirname, 'upload_mail_image')));


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

	app.post('/api/staff/upload-package', isStaff, upload.fields([
	  { name: 'image' }, { name: 'pdf' }
	]), (req, res) => {
	  const { mailbox_number, length_inch, width_inch, height_inch, weight_pound, username, category } = req.body;

	  const imageFiles = req.files?.image || [];
	  const pdfFiles = req.files?.pdf || [];

	  if (!mailbox_number || !username || (imageFiles.length === 0 && pdfFiles.length === 0)) {
		return res.status(400).json({ success: false, error: "Please upload at least one image or one PDF." });
	  }

	  if (!/^[1-9]\d*$/.test(mailbox_number)) {
		return res.status(400).json({ success: false, error: "Mailbox number must be a positive integer." });
	  }

	  const safeParse = v => v ? parseFloat(v) : null;
	  const length = safeParse(length_inch);
	  const width = safeParse(width_inch);
	  const height = safeParse(height_inch);
	  const weight = safeParse(weight_pound);

	  const subDir = path.join(__dirname, 'upload_mail_image', mailbox_number);
	  if (!fs.existsSync(subDir)) fs.mkdirSync(subDir, { recursive: true });

	  const createdAt = new Date().toISOString();

	  const insertPkg = packagesDB.prepare(`
		INSERT INTO packages 
		  (mailbox_number, length_inch, width_inch, height_inch, weight_pound, category, username, created_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?)
	  `);

	  insertPkg.run(
		parseInt(mailbox_number),
		length, width, height, weight,
		category, username,
		createdAt,
		function (err) {
		  if (err) {
			console.error("\u274C Failed to insert package:", err.message);
			return res.status(500).json({ success: false, error: "Database insert failed." });
		  }

		  const packageId = this.lastID;

		  // ✅ 組 custom_package_id = mailbox + MMDDYY + 5碼id
		  const today = new Date();
		  const mm = (today.getMonth() + 1).toString().padStart(2, '0');
		  const dd = today.getDate().toString().padStart(2, '0');
		  const yy = today.getFullYear().toString().slice(-2);
		  const datePart = `${mm}${dd}${yy}`;
		  const serial = packageId.toString().padStart(5, '0');
		  const customId = `${mailbox_number}${datePart}${serial}`;

		  packagesDB.run(`UPDATE packages SET custom_package_id = ? WHERE id = ?`, [customId, packageId], function (err2) {
			if (err2) {
			  console.error("\u274C Failed to update custom_package_id:", err2.message);
			  return res.status(500).json({ success: false, error: "Failed to update custom_package_id." });
			}

			const insertFile = packagesDB.prepare(`
			  INSERT INTO package_files (package_id, file_path, file_type)
			  VALUES (?, ?, ?)
			`);

			const files = [];
			let counter = 1;

			try {
			  for (const file of [...imageFiles, ...pdfFiles]) {
				const ext = mimeToExt[file.mimetype] || path.extname(file.originalname);
				const type = file.mimetype.includes('pdf') ? 'pdf' : 'image';
				const filename = `${username}_${customId}_${counter++}${ext}`;
				const relativePath = `${mailbox_number}/${filename}`;
				const fullPath = path.join(subDir, filename);

				fs.writeFileSync(fullPath, file.buffer);
				insertFile.run(packageId, relativePath, type);
				files.push({ path: relativePath, type });
			  }

			  clientsDB.run(
				`UPDATE clients SET mail_count = mail_count + 1 WHERE assign_mailbox_number = ?`,
				[mailbox_number],
				(err3) => {
				  if (err3) {
					console.error("\u274C Failed to update mail_count:", err3.message);
					return res.status(500).json({ success: false, error: "Failed to update mail_count" });
				  }

				  clientsDB.get(
					"SELECT contact_email, contact_name FROM clients WHERE assign_mailbox_number = ?",
					[mailbox_number],
					(err4, clientRow) => {
					  if (err4 || !clientRow) {
						console.error("\u274C Failed to fetch client email:", err4?.message || "Not found");
						return res.json({ success: true, package_id: packageId, custom_package_id: customId });
					  }

					  const { contact_email, contact_name } = clientRow;
					  const logoUrl = "https://easypostalservices.net/image/logo.jpg";

					  const notifyMail = {
					  from: `"Easy Postal Services" <${process.env.EMAIL_USER}>`,
					  to: contact_email,
					  // ✅ 主旨帶上 custom_package_id
					  subject: `📦 New Package Notification — ID: ${customId}`,
					  html: `
						<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
						  <img src="${logoUrl}" style="max-width: 180px; margin-bottom: 16px;" alt="Easy Postal Services Logo" />
						  <h2>Hello ${contact_name || username},</h2>
						  <p>We have received a new <strong>${category}</strong> for you on <strong>${new Date(createdAt).toLocaleString()}</strong>.</p>

						  <h3>Package Details:</h3>
						  <ul>
							<!-- ✅ 內文顯示 custom_package_id -->
							<li><strong>Tracking ID:</strong> ${customId}</li>
							<li><strong>Category:</strong> ${category ?? 'N/A'}</li>
							<li><strong>Dimensions:</strong> ${length ?? '—'}" × ${width ?? '—'}" × ${height ?? '—'}"</li>
							<li><strong>Weight:</strong> ${weight ?? '—'} lbs</li>
						  </ul>

						  ${
							files.length > 0 ? `<h3>Attached Files:</h3><ul>` +
							  files.map(f => {
								const fileUrl = `https://easypostalservices.net/upload_mail_image/${f.path}`;
								return f.type === 'image'
								  ? `<li><img src="${fileUrl}" style="max-width: 240px; margin-bottom: 10px;" /></li>`
								  : `<li><a href="${fileUrl}" target="_blank">📄 View PDF</a></li>`;
							  }).join('') + `</ul>` : ''
						  }

						  <p style="margin-top: 20px;">Please log in to your client dashboard to view and choose what to do with this item.</p>
						  <p><a href="https://easypostalservices.net/client.html" target="_blank" style="background-color: #004aad; color: white; padding: 10px 16px; text-decoration: none; border-radius: 4px;">Go to Dashboard</a></p>

						  <p>Thank you,<br/>Easy Postal Services</p>
						</div>
					  `
					};

					  transporter.sendMail(notifyMail, (errMail) => {
						if (errMail) {
						  console.error("\u274C Failed to send email:", errMail.message);
						} else {
						  console.log("\ud83d\udce7 Email sent to client:", contact_email);
						}
					  });

					  return res.json({ success: true, package_id: packageId, custom_package_id: customId });
					}
				  );
				}
			  );
			} catch (fileErr) {
			  console.error("\u274C File write failed:", fileErr.message);
			  return res.status(500).json({ success: false, error: "File save failed." });
			}
		  });
		}
	  );
	});



// ✅ 刪除客戶（連同其所有資料與上傳檔）— 僅 admin/staff 可用
app.post('/api/admin/delete-client', isStaff, (req, res) => {
  const { username } = req.body || {};
  if (!username) return res.status(400).json({ success: false, error: "Missing username." });

  // 1) 先在 clients.db 找出客戶（限制 role=client）
  clientsDB.get(
    `SELECT username, assign_mailbox_number, mailbox_number, role,
		contact_email, contact_phone, contact_name
       FROM clients
      WHERE username = ?`,
    [username],
    (cerr, c) => {
      if (cerr) {
        console.error("❌ clientsDB lookup failed:", cerr.message);
        return res.status(500).json({ success: false, error: "Database error (clients)." });
      }
      if (!c) return res.status(404).json({ success: false, error: "Client not found." });
      if (c.role !== 'client') return res.status(403).json({ success: false, error: "Cannot delete non-client user." });

      const mailbox = String(c.assign_mailbox_number || c.mailbox_number || '');

      // 2) 在 packages.db 找出該客戶所有包裹 id
      packagesDB.all(
        `SELECT id, mailbox_number FROM packages
          WHERE username = ? OR CAST(mailbox_number AS TEXT) = ?`,
        [username, mailbox],
        (perr, pkgs) => {
          if (perr) {
            console.error("❌ packages lookup failed:", perr.message);
            return res.status(500).json({ success: false, error: "Database error (packages)." });
          }

          const packageIds = pkgs.map(p => p.id);
          const mailboxDirs = [...new Set(pkgs.map(p => String(p.mailbox_number)))];

          // 2a) 刪除實體檔案（先抓清單再 unlink）
          const deletePhysicalFiles = (done) => {
            if (packageIds.length === 0) return done(null, 0);
            const ph = packageIds.map(() => '?').join(',');
            packagesDB.all(
              `SELECT file_path FROM package_files WHERE package_id IN (${ph})`,
              packageIds,
              (ferr, files) => {
                if (ferr) return done(ferr, 0);
                let removed = 0;
                for (const f of files) {
                  const full = path.join(__dirname, 'upload_mail_image', f.file_path);
                  try { if (fs.existsSync(full)) { fs.unlinkSync(full); removed++; } }
                  catch (e) { console.warn("⚠️ unlink failed:", full, e.message); }
                }
                done(null, removed);
              }
            );
          };

          // 2b) 刪 DB 中的關聯 rows（package_files → package_actions → packages）
          const deletePackageRows = (done) => {
            if (packageIds.length === 0) return done(null, { files: 0, actions: 0, packages: 0 });
            const ph = packageIds.map(() => '?').join(',');
            packagesDB.run(
              `DELETE FROM package_files WHERE package_id IN (${ph})`,
              packageIds,
              function (e1) {
                if (e1) return done(e1);
                const filesDel = this.changes || 0;
                packagesDB.run(
                  `DELETE FROM package_actions WHERE package_id IN (${ph})`,
                  packageIds,
                  function (e2) {
                    if (e2) return done(e2);
                    const actsDel = this.changes || 0;
                    packagesDB.run(
                      `DELETE FROM packages WHERE id IN (${ph})`,
                      packageIds,
                      function (e3) {
                        if (e3) return done(e3);
                        const pkgsDel = this.changes || 0;
                        done(null, { files: filesDel, actions: actsDel, packages: pkgsDel });
                      }
                    );
                  }
                );
              }
            );
          };

          // 2c) 砍掉 mailbox 資料夾（就算沒檔也可忽略）
          const removeMailboxDirs = () => {
            const targets = mailbox ? [mailbox, ...mailboxDirs] : mailboxDirs;
            for (const d of new Set(targets)) {
              const dir = path.join(__dirname, 'upload_mail_image', d);
              try { if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true }); }
              catch (e) { console.warn("⚠️ rm dir failed:", dir, e.message); }
            }
          };

		// 3) 刪 appointments：依 email/phone/姓名（若有其一即套用）
		const deleteAppointments = (cb) => {
		  if (typeof appointmentsDB?.run !== 'function') return cb(null, 0);

		  // 這三個值都來自上面 clientsDB.get 撈到的 c.*
		  const email = (c.contact_email || '').trim();
		  const phone = (c.contact_phone || '').trim();
		  const fullName = (c.contact_name || '').trim();

		  const clauses = [];
		  const params = [];

		  if (email) { clauses.push('email = ?'); params.push(email); }
		  if (phone) { clauses.push('phone = ?'); params.push(phone); }

		  // 嘗試用姓名對應 first_name + last_name
		  if (fullName) {
			const parts = fullName.split(/\s+/);
			const last = parts.pop();
			const first = parts.join(' ');
			if (first && last) {
			  clauses.push('(first_name = ? AND last_name = ?)');
			  params.push(first, last);
			} else {
			  // 如果只有單一字串，就寧可不用姓名避免誤刪
			}
		  }

		  if (clauses.length === 0) {
			// 沒有任何可比對條件 → 略過刪除 appointments
			return cb(null, 0);
		  }

		  const sql = `DELETE FROM appointments WHERE ${clauses.join(' OR ')}`;
		  appointmentsDB.run(sql, params, function (aerr) {
			if (aerr) return cb(aerr);
			cb(null, this.changes || 0);
		  });
		};

          // 4) 最後刪 client
          const deleteClientRow = (done) => {
            clientsDB.run(
              `DELETE FROM clients WHERE username = ?`,
              [username],
              function (cerr2) { if (cerr2) return done(cerr2, 0); done(null, this.changes || 0); }
            );
          };

          // 串聯執行
          deletePhysicalFiles((fErr, removedFiles) => {
            if (fErr) {
              console.error("❌ files remove failed:", fErr.message);
              return res.status(500).json({ success: false, error: "Failed to remove files." });
            }
            deletePackageRows((rowsErr, delCounts) => {
              if (rowsErr) {
                console.error("❌ delete rows failed:", rowsErr.message);
                return res.status(500).json({ success: false, error: "Failed to delete package rows." });
              }
              removeMailboxDirs();
              deleteAppointments((apErr, apDel) => {
                if (apErr) console.warn("⚠️ appointments delete failed:", apErr.message);
                deleteClientRow((clErr, clDel) => {
                  if (clErr) {
                    console.error("❌ delete client failed:", clErr.message);
                    return res.status(500).json({ success: false, error: "Failed to delete client." });
                  }
                  return res.json({
                    success: true,
                    deleted: {
                      physical_files: removedFiles,
                      package_files: delCounts.files,
                      package_actions: delCounts.actions,
                      packages: delCounts.packages,
                      appointments: apDel || 0,
                      client_rows: clDel
                    }
                  });
                });
              });
            });
          });
        }
      );
    }
  );
});




// ✅ 客戶查詢自己的包裹（含多檔案）
app.get('/api/client/packages', isAuthenticated, (req, res) => {
  const username = req.session.user?.username;

  if (!username) return res.status(403).json({ error: "Unauthorized" });

	const query = `
	  SELECT 
		p.id, p.custom_package_id,             -- 新增
		p.mailbox_number, p.length_inch, p.width_inch, p.height_inch,
		p.weight_pound, p.category, p.username, p.created_at,
		GROUP_CONCAT(f.file_path) AS file_paths,
		GROUP_CONCAT(f.file_type) AS file_types
	  FROM packages p
	  LEFT JOIN package_files f ON p.id = f.package_id
	  WHERE p.username = ?
	  GROUP BY p.id
	  ORDER BY p.id DESC
	`;


  packagesDB.all(query, [username], (err, rows) => {
    if (err) {
      console.error("❌ Failed to fetch client packages:", err.message);
      return res.status(500).json({ error: "Database error" });
    }

    const packages = rows.map(pkg => {
      const paths = pkg.file_paths ? pkg.file_paths.split(',') : [];
      const types = pkg.file_types ? pkg.file_types.split(',') : [];
      const files = paths.map((p, i) => ({ path: p, type: types[i] }));
      return { ...pkg, files };
    });

    res.json(packages);
  });
});


// ✅ 客戶送出包裹處理動作（只接受 custom_package_id；對應動作字串到 DB 規定）
	app.post('/api/package-action', isAuthenticated, (req, res) => {
	  const { custom_package_id, username, action } = req.body;

	  if (!custom_package_id || !username || !action) {
		return res.status(400).json({ success: false, error: "Missing required fields." });
	  }
	  if (!/^\d+$/.test(String(custom_package_id))) {
		return res.status(400).json({ success: false, error: "Invalid custom_package_id format." });
	  }

	  const ACTION_MAP = {
		'discard': 'Discard',
		'trash': 'Discard',
		'forward': 'Forward',
		'ship': 'Forward',
		'collect': 'Pick up',
		'pickup': 'Pick up',
		'pick up': 'Pick up',
		'scan': 'Scan',
		'scanning': 'Scan'
	  };
	  const key = String(action).trim().toLowerCase();
	  const canonicalAction = ACTION_MAP[key];
	  if (!canonicalAction) {
		return res.status(400).json({
		  success: false,
		  error: "Invalid action. Allowed: Discard / Forward / Pick up / Scan"
		});
	  }

	  const now = new Date().toISOString();

	  packagesDB.get(
		`SELECT id FROM packages WHERE custom_package_id = ?`,
		[custom_package_id],
		(err, row) => {
		  if (err) {
			console.error("❌ DB error (lookup package):", err.message);
			return res.status(500).json({ success: false, error: "Database error (lookup)." });
		  }
		  if (!row) {
			return res.status(404).json({ success: false, error: "Package not found." });
		  }

		  const numericId = row.id;

		  packagesDB.get(
			`SELECT id FROM package_actions WHERE package_id = ? AND username = ? AND status = 'pending'`,
			[numericId, username],
			(err2, existing) => {
			  if (err2) {
				console.error("❌ DB error (check duplicate):", err2.message);
				return res.status(500).json({ success: false, error: "Database error (check)." });
			  }

			  if (existing) {
				packagesDB.run(
				  `UPDATE package_actions
					 SET action = ?, created_at = ?, custom_package_id = COALESCE(custom_package_id, ?)
				   WHERE id = ?`,
				  [canonicalAction, now, custom_package_id, existing.id],
				  function (uErr) {
					if (uErr) {
					  console.error("❌ Failed to update action:", uErr.message);
					  return res.status(500).json({ success: false, error: "Failed to update action." });
					}
					return res.json({ success: true, custom_package_id, action: canonicalAction, updated: true });
				  }
				);
				return;
			  }

			  const stmt = packagesDB.prepare(`
				INSERT INTO package_actions (package_id, custom_package_id, username, action, status, created_at)
				VALUES (?, ?, ?, ?, 'pending', ?)
			  `);
			  stmt.run(
				numericId,
				custom_package_id,
				username,
				canonicalAction,
				now,
				function (insErr) {
				  if (insErr) {
					console.error("❌ Failed to insert package action:", insErr.message);
					return res.status(500).json({ success: false, error: `Failed to submit action: ${insErr.message}` });
				  }
				  return res.json({ success: true, custom_package_id, action: canonicalAction });
				}
			  );
			}
		  );
		}
	  );
	});




// 簡單健康檢查，不碰 DB（首頁能回應 OK，Cloud Run 比較好判斷健康）
app.get('/', (req, res) => res.send('OK'));

// 只保留一個 PORT 宣告與一個 listen
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://localhost:${PORT}`);
});