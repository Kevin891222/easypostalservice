// --- 放入 server.js 中 ---
// sqlite3 與 express 等前置程式碼照舊

// 新增資料表擴充欄位（若尚未建立）
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

// 客戶註冊處理 POST 路由
app.post('/register', (req, res) => {
  const {
    username, password, repeat_password,
    contact_name, contact_phone, contact_email,
    company_name, company_address
  } = req.body;

  // 驗證欄位
  if (!contact_name || !username || !password || !repeat_password) {
    return res.send("<p style='color:red'>請填寫所有必填欄位</p><a href='/register.html'>返回</a>");
  }
  if (password !== repeat_password) {
    return res.send("<p style='color:red'>Password you enter is not the same</p><a href='/register.html'>返回</a>");
  }

  // 寫入資料庫
  const stmt = db.prepare(`
    INSERT INTO clients (username, password, contact_name, contact_phone, contact_email, company_name, company_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    username, password, contact_name, contact_phone, contact_email, company_name, company_address,
    function (err) {
      if (err) {
        if (err.message.includes("UNIQUE constraint failed")) {
          res.send("<p style='color:red'>帳號已存在，請更換</p><a href='/register.html'>返回</a>");
        } else {
          console.error("註冊錯誤:", err);
          res.send("<p style='color:red'>註冊失敗，請稍後再試</p><a href='/register.html'>返回</a>");
        }
      } else {
        res.send(`<h2>註冊成功，歡迎您 ${contact_name}！</h2><a href='/client.html'>前往登入</a>`);
      }
    }
  );
});