// ###### MAIN SECTION ######
// ===== CONFIG =====
const SHEET_DATA = 'data';
const SHEET_LINK = 'link';
const SHEET_TOKEN = 'tokens';
const SHEET_REGIST = 'regist';
const QR_EXPIRE_SECONDS = 10;

// ===== MAIN LINE HANDLER =====
function doPost(e) {
  const event = JSON.parse(e.postData.contents).events[0];
  const replyToken = event.replyToken;
  const userId = event.source.userId;
  const msg = event.message?.text?.trim() || '';

  if (event.type === 'message') {
    if (msg === 'ยืนยัน') confirmRegistration(userId, replyToken);
    else if (msg === 'แสดงลำดับการลงทะเบียน') handleShowRegistNumber(userId, event.replyToken);
    else if (/^\d+$/.test(msg)) handleLineMessage(userId, msg, replyToken);
    else replyMessage(replyToken, '⚠️ กรุณากรอกเลขประจำตัวข้าราชการ 10 หลัก');
  }

  return ContentService.createTextOutput(JSON.stringify({ status: 'ok' })).setMimeType(ContentService.MimeType.JSON);
}

// ===== MAIN ENTRY POINT =====
function doGet(e) {
  const p = e.parameter;
  const userId = p.userId;
  const callback = p.callback || 'callback';

  // ✅ ตรวจสอบสิทธิ์แบบแยกออกมาก่อน
  if (p.checkAdmin && userId) return ContentService.createTextOutput(String(isAdminUser(userId)));
  if (p.checkSuperAdmin && userId) return ContentService.createTextOutput(String(isSuperAdminUser(userId)));

  // ✅ JSONP API
  if (p.getUnitList) return getUnitList();
  if (p.getRankList) return getRankList();
  if (p.getPersonnel) return handleGetPersonnel();
  if (p.getAdminList) return getAdminList();
  if (p.summary) {
    const data = getData();
    const regist = getRegist();
    const output = { data, regist };
    return ContentService.createTextOutput(`${callback}(${JSON.stringify(output)})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  // ✅ แก้ไขข้อมูลกำลังพล
  if (p.addPersonnel && p.rtafId && p.rank && p.name && p.position && p.unit) {
    const result = addPersonnel(p).getContent();
    return ContentService.createTextOutput(`${callback}(${JSON.stringify(result)})`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  if (p.updatePersonnel && p.rtafId && p.rank && p.name && p.position && p.unit) return updatePersonnel(p);
  if (p.deletePersonnel && p.rtafId) return deletePersonnel(p);

  // ✅ แก้ไขสิทธิ์/ล้างข้อมูล
  if (p.resetSheet) return resetSheet(p.resetSheet, callback);
  if (p.resetDrawers) return resetDrawers(callback);
  if (p.resetRoles) return resetRoles();
  if (p.updateRole && p.rtafId && p.role && p.value !== undefined) {
    const role = p.role.toLowerCase();
    if (role === 'admin' || role === 'superadmin') return updateRole(p.rtafId, p.role, p.value);
    if (role === 'list' || role === 'drawer') return handleUpdateRole(p.rtafId, p.role, p.value);
  }

  // ✅ ลำดับยศ/หน่วย (drag-drop)
  if (p.updateList && p.data) return handleUpdateList(p, callback);
  if (p.updateItem) return handleUpdateItem(p, callback);

  // ✅ ระบบสแกน Admin
  if (p.generateQRAdmin) return generateQRAdmin();
  if (p.markAuthorized && userId) return markAuthorizedHandler(userId);
  if (p.checkAuthorized && userId) return checkAuthorizedHandler(userId); 
  if (p.verifyToken && p.data && p.scanner) return verifyTokenHandler(p.data, p.scanner);

  // ✅ ระบบแสดง QR (QR.html)
  if (!userId) return renderErrorPage('❌ ไม่พบ userId');

  const rtafId = getRtafId(userId);
  if (!rtafId) return renderErrorPage('❌ คุณยังไม่ได้ผูกเลขประจำตัวข้าราชการกับบัญชีไลน์');

  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DATA);
  const values = sheet.getDataRange().getValues();
  const row = values.find(r => String(r[0]).trim() === String(rtafId));
  const listStatus = row ? row[5] : '';
  if (!listStatus || listStatus.toString().trim() === '') {
    return renderErrorPage('❌ หน่วยไม่ได้ส่งชื่อคุณเข้าร่วมงาน\nกรณีมาแทน กรุณาแจ้งเจ้าหน้าที่ลงทะเบียนหน้างาน');
  }

  if (hasAlreadyRegistered(rtafId)) return renderQRDone();

  const { token, expireTime } = createToken(userId, rtafId);
  return renderQRPage(token, expireTime, rtafId);
}

// ====== ตรวจสอบ admin ======
function isAdminUser(userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const linkSheet = ss.getSheetByName(SHEET_LINK);
  const dataSheet = ss.getSheetByName(SHEET_DATA);
  const link = linkSheet.getDataRange().getValues();
  const row = link.find(r => r[0] === userId);

  Logger.log("userId:", userId);
  Logger.log("Found in link row:", row);

  if (!row) return false;

  const rtafId = row[1];
  const data = dataSheet.getDataRange().getValues();
  const profile = data.find(r => r[0] == rtafId);

  Logger.log("rtafId:", rtafId);
  Logger.log("Found in data:", profile);
  Logger.log("Admin raw value:", profile ? profile[6] : null);
  Logger.log("Admin check result:", profile ? profile[6] === true : false);

  return profile ? profile[6] === true : false;
}

// ====== ตรวจสอบ super admin ======
function isSuperAdminUser(userId) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const linkSheet = ss.getSheetByName(SHEET_LINK);
  const dataSheet = ss.getSheetByName(SHEET_DATA);
  const link = linkSheet.getDataRange().getValues();

  const row = link.find(r => r[0] === userId); // 🟢 เพิ่มบรรทัดนี้ก่อนใช้ row

  Logger.log("userId:", userId);
  Logger.log("Found in link row:", row);

  if (!row) return false;

  const rtafId = row[1];
  const data = dataSheet.getDataRange().getValues();
  const profile = data.find(r => r[0] == rtafId);

  Logger.log("rtafId:", rtafId);
  Logger.log("Found in data:", profile);
  Logger.log("Admin raw value:", profile ? profile[7] : null);
  Logger.log("Admin check result:", profile ? profile[7] === true : false);

  return profile ? profile[7] === true : false;
}

// ====== ส่งตอบกลับกลับเป็นข้อความ ======
function replyMessage(replyToken, text) {
  const token = 'bDbFxGSsWN8GdUKY3k2gRkAWFGi8K7IyybYjlIjr7SFxWh3RiuL1RMisjHLxw6K3jMVl0Dqkhv+EAfEGWZ1puA1TTzQNITkSBrrthTFzzmRrZ0+e1M2NZBwkSBpoqXd5izW+9OGYxmJ7VIiPqOuGpQdB04t89/1O/w1cDnyilFU=';
  const url = 'https://api.line.me/v2/bot/message/reply';

  const payload = {
    replyToken,
    messages: [{ type: 'text', text }],
  };

  const options = {
    method: 'post',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify(payload),
  };

  UrlFetchApp.fetch(url, options);
}

// ====== ส่งตอบกลับเป็น flex ======
function replyFlex(replyToken, flex) {
  const url = 'https://api.line.me/v2/bot/message/reply';
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + 'bDbFxGSsWN8GdUKY3k2gRkAWFGi8K7IyybYjlIjr7SFxWh3RiuL1RMisjHLxw6K3jMVl0Dqkhv+EAfEGWZ1puA1TTzQNITkSBrrthTFzzmRrZ0+e1M2NZBwkSBpoqXd5izW+9OGYxmJ7VIiPqOuGpQdB04t89/1O/w1cDnyilFU='
  };

  const payload = JSON.stringify({
    replyToken: replyToken,
    messages: [flex]
  });

  UrlFetchApp.fetch(url, {
    method: 'post',
    headers: headers,
    payload: payload
  });
}

// ====== ส่งตอบกลับเป็น HTML ======
function renderErrorPage(message) {
  return HtmlService.createHtmlOutput(`
    <!DOCTYPE html>
    <html lang="th">
    <head>
      <meta charset="UTF-8">
      <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai&display=swap" rel="stylesheet">
      <style>
        body {
          font-family: 'Noto Sans Thai', sans-serif;
        }
      </style>
    </head>
    <body>
      <br><br><br><center><h1 style="font-size:4em;">${message}</h1></center>
    </body>
    </html>
  `)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ✅ ดึงข้อมูลลำดับหน่วยจาก sheet 'unit'
function getUnitList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('unit');
  const values = sheet.getDataRange().getValues().slice(1); // ข้าม header
  return ContentService.createTextOutput(JSON.stringify(values))
    .setMimeType(ContentService.MimeType.JSON);
}

function getRankList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('rank');
  const values = sheet.getDataRange().getValues().slice(1); // ข้าม header
  return ContentService.createTextOutput(JSON.stringify(values))
    .setMimeType(ContentService.MimeType.JSON);
}

// ###### MAIN SECTION ######

// ###### LINK ACCOUNT SECTION ######
// ===== LINE MESSAGE: ผูกบัญชี =====
function handleLineMessage(userId, rtafId, replyToken) {
  if (rtafId.length !== 10) {
    return replyMessage(replyToken, '⚠️ กรุณากรอกเลขประจำตัวข้าราชการ 10 หลัก');
  }

  const fixedRtafId = rtafId.padStart(10, '0');
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(SHEET_DATA);
  const linkSheet = ss.getSheetByName(SHEET_LINK);
  const data = dataSheet.getDataRange().getValues();
  const link = linkSheet.getDataRange().getValues();

  const record = data.find(row => row[0].toString().padStart(10, '0') === fixedRtafId);
  if (!record) {
    return replyMessage(replyToken, '❌ ไม่พบเลขประจำตัวข้าราชการนี้ กรุณาตรวจสอบ');
  }

  const [__, newRank, newName] = record;

  const linkByUser = link.find(row => row[0] === userId);
  const linkById = link.find(row => row[1].toString().padStart(10, '0') === fixedRtafId);

  // ✅ กรณีเคยผูกกับเลขนี้ไปแล้ว (ไม่ต้องทำซ้ำ)
  if (linkByUser && linkByUser[1].toString().padStart(10, '0') === fixedRtafId) {
    return replyMessage(replyToken, `📌 บัญชีไลน์นี้ได้ผูกบัญชีไว้กับ ${newRank} ${newName} แล้ว`);
  }

  // ✅ เคยผูก ID นี้กับไลน์อื่น
  if (linkById && linkById[0] !== userId) {
    PropertiesService.getUserProperties().setProperty(`pendingRTAF_${userId}`, fixedRtafId);
    return replyMessage(replyToken, `⚠️ คุณได้ผูกเลขประจำตัวข้าราชการกับบัญชีไลน์อื่นแล้ว\nหากต้องการเปลี่ยนมาผูกกับบัญชีนี้ กรุณาพิมพ์ว่า "ยืนยัน"`);
  }

  // ✅ เคยผูก userId กับ RTAF_ID อื่น
  if (linkByUser && linkByUser[1].toString().padStart(10, '0') !== fixedRtafId) {
    const existingId = linkByUser[1].toString().padStart(10, '0');
    const oldRecord = data.find(row => row[0].toString().padStart(10, '0') === existingId);
    if (oldRecord) {
      const [__, oldRank, oldName] = oldRecord;
      return replyMessage(replyToken, `📌 บัญชีไลน์นี้ได้ผูกบัญชีไว้กับ ${oldRank} ${oldName} แล้ว`);
    } else {
      return replyMessage(replyToken, `📌 บัญชีไลน์นี้ได้ผูกไว้กับเลข ${existingId} แล้ว แต่ไม่พบชื่อในระบบ`);
    }
  }

  // ✅ ยังไม่เคยผูกใด ๆ -> ผูกใหม่
  linkSheet.appendRow([userId, fixedRtafId, new Date()]);
  return replyMessage(replyToken, `✅ ${newRank} ${newName} ได้ผูกบัญชีเรียบร้อยแล้ว`);
}

// ===== ยืนยันการเปลี่ยนบัญชี LINE =====
function confirmRegistration(userId, replyToken) {
  const rtafId = PropertiesService.getUserProperties().getProperty(`pendingRTAF_${userId}`);
  if (!rtafId) {
    return replyMessage(replyToken, '⚠️ ไม่มีข้อมูลที่รอยืนยัน กรุณาส่งเลขประจำตัวข้าราชการมาก่อน');
  }

  // ล้าง pending flag
  PropertiesService.getUserProperties().deleteProperty(`pendingRTAF_${userId}`);

  // ดำเนินการผูกบัญชีใหม่ (จะ update userId แทนที่จะลบ)
  return attemptRegistration(userId, rtafId, replyToken);
}

// ===== ดำเนินการผูกบัญชีใหม่ =====
function attemptRegistration(userId, rtafId, replyToken) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName(SHEET_DATA);
  const linkSheet = ss.getSheetByName(SHEET_LINK);
  const data = dataSheet.getDataRange().getValues();
  const link = linkSheet.getDataRange().getValues();

  const record = data.find(row => row[0].toString().padStart(10, '0') === rtafId.toString().padStart(10, '0'));
  if (!record) return replyMessage(replyToken, '❌ ไม่พบข้อมูลในระบบ กรุณาตรวจสอบเลขประจำตัวข้าราชการ');

  const [_, rank, name] = record;
  const normalizedRtafId = rtafId.toString().padStart(10, '0');

  const rowIndex = link.findIndex(row => row[1].toString().padStart(10, '0') === normalizedRtafId);
  if (rowIndex !== -1) {
    linkSheet.getRange(rowIndex + 1, 1).setValue(userId);       // update LINE userId
    linkSheet.getRange(rowIndex + 1, 3).setValue(new Date());   // update timestamp
  } else {
    linkSheet.appendRow([userId, rtafId, new Date()]);
  }

  return replyMessage(replyToken, `✅ ${rank} ${name} ได้ผูกบัญชีใหม่เรียบร้อยแล้ว`);
}

// ###### LINK ACCOUNT SECTION ######

// ###### SHOW QR SECTION ######
// get RTAF_ID by userId
function getRtafId(userId) {
  const linkSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_LINK);
  const row = linkSheet.getDataRange().getValues().find(r => r[0] === userId);
  return row ? String(row[1]) : null;
}

// Check if already registered
function hasAlreadyRegistered(rtafId) {
  const registSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_REGIST);
  const registData = registSheet.getDataRange().getValues();
  return registData.some(r => String(r[2]) === String(rtafId));
}

// Create new token
function createToken(userId, rtafId) {
  const token = Utilities.getUuid();
  const expire = Date.now() + QR_EXPIRE_SECONDS * 1000;
  const tokenSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_TOKEN);
  tokenSheet.appendRow([token, rtafId, userId, expire, false]);
  return { token, expireTime: expire };
}

// ไว้ใช้ดึงชื่อจาก sheet "data"
function getDisplayName(rtafId) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("data");
  const data = sheet.getDataRange().getValues();
  const found = data.find(r => String(r[0]) === String(rtafId));
  if (!found) return { fullName: '', position: '' };
  const [ , rank, name, position ] = found;
  return { fullName: `${rank} ${name}`, position: position || '' };
}

// Render QR HTML (no reload here)
function renderQRPage(token, expireTime, rtafId) {
  const dataSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_DATA);
  const row = dataSheet.getDataRange().getValues().find(r => String(r[0]) === String(rtafId));
  const [_, rank, name, position] = row || ['-', '-', '-', '-'];
  const fullName = `${rank} ${name}`;
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?data=${token}`;
  const seconds = Math.floor((expireTime - Date.now()) / 1000);

  const html = `
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai&display=swap" rel="stylesheet">
    <style>
      body {
        font-family: 'Noto Sans Thai', sans-serif;
        margin: 0;
        background: #f0f4f8;
        padding: 24px 16px;
        font-size: 24px;
      }
      .qr-box {
        background: #fff;
        border-radius: 20px;
        padding: 36px 20px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.1);
        text-align: center;
        max-width: 95vw;
        margin: 0 auto;
      }
      .logo {
        width: 100px;
        margin-bottom: 15px;
      }
      .name {
        font-size: 1.8em;
        font-weight: bold;
        color: #222;
        margin-bottom: 8px;
      }
      .position {
        font-size: 1.4em;
        color: #555;
        margin-bottom: 25px;
      }
      .qr-box h2 {
        margin: 0 0 25px;
        font-size: 2em;
        color: #333;
      }
      .qr-box img.qr {
        width: 100%;
        max-width: 600px;
        height: auto;
        margin-bottom: 25px;
      }
      .countdown {
        font-size: 1.6em;
        color: #d00;
        font-weight: bold;
      }
    </style>
  </head>
  <body>
    <div class="qr-box" data-status="active">
      <img class="logo" src="https://img2.pic.in.th/pic/1ce957ef03dff0be3.png" alt="Logo" />
      <div class="name">${fullName}</div>
      <div class="position">${position}</div>
      <h2>📷 กรุณาแสดง QR นี้ให้เจ้าหน้าที่</h2>
      <img class="qr" src="${qrUrl}" alt="QR Code" />
      <div class="countdown" id="countdown">หมดอายุใน ${seconds} วินาที</div>
    </div>
    <script>
      let seconds = ${seconds};
      const el = document.getElementById("countdown");
      const interval = setInterval(() => {
        seconds--;
        if (seconds <= 0) {
          clearInterval(interval);
          el.innerText = "⏳ โปรดรอสักครู่...";
        } else {
          el.innerText = "หมดอายุใน " + seconds + " วินาที";
        }
      }, 1000);
    </script>
  </body>
  </html>
  `;

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function renderQRDone() {
  const html = `
  <html>
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Thai&display=swap" rel="stylesheet">
    <style>
      body {
        font-family: 'Noto Sans Thai', sans-serif;
        margin: 0;
        background: #f0f4f8;
        padding: 24px 16px;
        font-size: 24px;
        text-align: center;
      }
      .done-box {
        background: #fff;
        border-radius: 20px;
        padding: 40px 20px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.1);
        max-width: 90vw;
        margin: 0 auto;
      }
      .logo {
        width: 100px;
        margin-bottom: 15px;
      }
      .msg {
        font-size: 2em;
        color: #2b8a3e;
        font-weight: bold;
      }
    </style>
  </head>
  <body>
    <div class="done-box" data-status="done">
      <img class="logo" src="https://img2.pic.in.th/pic/1ce957ef03dff0be3.png" alt="Logo" />
      <div class="msg">✅ คุณได้ลงทะเบียนเรียบร้อยแล้ว</div>
    </div>
  </body>
  </html>
  `;

  return HtmlService.createHtmlOutput(html)
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// Helper: render any plain HTML
function renderHTML(text) {
  return HtmlService.createHtmlOutput(`<div style="font-family:'Noto Sans Thai';padding:40px;text-align:center;">${text}</div>`) 
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ###### SHOW QR SECTION ######

// ###### SCAN SECTION ######
function generateQRAdmin() {
  return ContentService.createTextOutput(JSON.stringify({ userId: '' }))
    .setMimeType(ContentService.MimeType.JSON);
}

function markAuthorizedHandler(userId) {
  const cache = CacheService.getScriptCache();
  cache.put(`auth_${userId}`, 'true', 300); // 5 นาที
  return ContentService.createTextOutput('OK');
}

function checkAuthorizedHandler(userId) {
  const cache = CacheService.getScriptCache();
  const status = cache.get(`auth_${userId}`);
  if (status === 'true') {
    cache.remove(`auth_${userId}`);
    return ContentService.createTextOutput('true');
  }
  return ContentService.createTextOutput('false');
}

function verifyTokenHandler(token, scannerId) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const tokenSheet = ss.getSheetByName("tokens");
    const registSheet = ss.getSheetByName("regist");
    const dataSheet = ss.getSheetByName("data");
    const linkSheet = ss.getSheetByName("link");
    const now = Date.now();

    const tokens = tokenSheet.getDataRange().getValues();
    const idx = tokens.findIndex(row => row[0] === token);
    if (idx === -1) return json({ message: "<div style='text-align:center;'>❌ Token ไม่ถูกต้อง</div>", sound: "error.mp3" });

    const [tk, rtafId, userId, expire, used] = tokens[idx];
    const data = dataSheet.getDataRange().getValues();
    const profile = data.find(row => String(row[0]) === String(rtafId));

    if (!profile) return json({ message: "<div style='text-align:center;'>❌ ไม่พบข้อมูล</div>", sound: "error.mp3" });

    // ✅ ตรวจสิทธิ์ Admin
    const link = linkSheet.getDataRange().getValues();
    const linkRow = link.find(r => r[0] === scannerId);
    if (!linkRow) return json({ message: "<div style='text-align:center;'>❌ ไม่พบข้อมูลผู้สแกน</div>", sound: "error.mp3" });

    const scannerRtafId = linkRow[1];
    const scannerProfile = data.find(row => String(row[0]) === String(scannerRtafId));
    const isAdmin = scannerProfile && (scannerProfile[6] === true || String(scannerProfile[6]).toLowerCase() === 'true');
    if (!isAdmin) return json({ message: "<div style='text-align:center;'>❌ คุณไม่มีสิทธิ์ Admin</div>", sound: "error.mp3" });

    const fullName = `${profile[1]} ${profile[2]}`;

    if (used) {
      const regist = registSheet.getDataRange().getValues();
      const already = regist.some(row => String(row[2]) === String(rtafId));
      if (already) {
        return json({ message: `<div style='text-align:center;'>⚠️ ${fullName}<br>ได้ลงทะเบียนไปแล้ว</div>`, sound: "error.mp3" });
      } else {
        return json({ message: `<div style='text-align:center;'>❌ QR ถูกใช้แล้ว แต่ไม่พบข้อมูลลงทะเบียน<br>กรุณาติดต่อเจ้าหน้าที่</div>`, sound: "error.mp3" });
      }
    }

    if (now > expire) {
      return json({ message: "<div style='text-align:center;'>⚠️ QR Code หมดอายุ</div>", sound: "error.mp3" });
    }

    // ✅ บันทึกการลงทะเบียน
    tokenSheet.getRange(idx + 1, 5).setValue(true);
    const regNo = registSheet.getLastRow();
    const time = new Date();
    const row = [time, regNo, ...profile.slice(0, 5)];
    registSheet.appendRow(row);

    return json({ message: `<div style='text-align:center;'>✅ ${fullName}<br>ลงทะเบียนสำเร็จ</div>`, sound: "success.mp3" });
  } catch (err) {
    return json({ message: `<div style='text-align:center;'>❌ ERROR: ${err}</div>`, sound: "error.mp3" });
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ###### SCAN SECTION ######

// ###### SHOW REGISTER NUMBER SECTION ######
function handleShowRegistNumber(userId, replyToken) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const linkSheet = ss.getSheetByName(SHEET_LINK);
  const registSheet = ss.getSheetByName(SHEET_REGIST);
  const dataSheet = ss.getSheetByName(SHEET_DATA);

  const linkData = linkSheet.getDataRange().getValues();
  const registData = registSheet.getDataRange().getValues();
  const data = dataSheet.getDataRange().getValues();

  const linkRow = linkData.find(row => row[0] === userId);
  if (!linkRow) return replyMessage(replyToken, '❌ คุณยังไม่ได้ผูกเลขประจำตัวข้าราชการกับบัญชีไลน์');

  const rtafId = linkRow[1];
  const registRow = registData.find(row => String(row[2]) === String(rtafId));
  if (!registRow) return replyMessage(replyToken, '⚠️ คุณยังไม่ได้ลงทะเบียน กรุณาแสดง QR Code กับเจ้าหน้าที่');

  const registNo = registRow[1];
  const profile = data.find(row => String(row[0]) === String(rtafId));
  const fullName = profile ? `${profile[1]} ${profile[2]}` : 'ไม่ทราบชื่อ';

  const flex = {
    type: "flex",
    altText: "ลำดับการลงทะเบียนของคุณ",
    contents: {
      type: "bubble",
      body: {
        type: "box",
        layout: "vertical",
        contents: [
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "ลำดับการลงทะเบียนของ",
                size: "sm",
                align: "center",
                color: "#000429",
                wrap: true
              },
              {
                type: "text",
                text: fullName,
                weight: "bold",
                size: "md",
                align: "center",
                color: "#000429",
                wrap: true
              }
            ],
            paddingBottom: "10px"
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: "หมายเลข",
                weight: "bold",
                size: "xxl",
                align: "center",
                color: "#000429"
              }
            ],
            backgroundColor: "#ffdc00",
            cornerRadius: "10px"
          },
          {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "text",
                text: String(registNo),
                weight: "bold",
                size: "5xl",
                align: "center",
                color: "#00a2ff"
              }
            ]
          }
        ],
        borderWidth: "20px",
        borderColor: "#00a2ff"
      }
    }
  };

  replyFlex(replyToken, flex);

}

// ###### SHOW REGISTER NUMBER SECTION ######

// ###### SUPERADMIN SECTION ######
function getAdminList() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('data');
  const values = sheet.getDataRange().getValues();
  const data = values.slice(1).map(row => ({
    rtafId: row[0],
    rank: row[1],
    name: row[2],
    position: row[3], // ยังไม่ใช้ก็ไม่เป็นไร
    unit: row[4],
    admin: row[6] === true,
    superadmin: row[7] === true
  }));
  return ContentService.createTextOutput(JSON.stringify(data))
    .setMimeType(ContentService.MimeType.JSON);
}

function updateRole(rtafId, role, value) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('data');
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r => String(r[0]) === String(rtafId));
  if (rowIndex === -1) return ContentService.createTextOutput("not found");

  const lowerRole = role.toLowerCase();
  const colIndex = lowerRole === "admin" ? 6 : lowerRole === "superadmin" ? 7 : -1;
  if (colIndex === -1) return ContentService.createTextOutput("invalid role");

  const boolValue = (value === true || value === 'true');
  sheet.getRange(rowIndex + 1, colIndex + 1).setValue(boolValue);
  return ContentService.createTextOutput("updated");
}

function resetRoles() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('data');
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return ContentService.createTextOutput("no data");

  sheet.getRange(2, 7, lastRow - 1).clearContent(); // ล้างเฉพาะ column 7 (Admin)
  SpreadsheetApp.flush();  // 🔁 เพิ่มบรรทัดนี้
  return ContentService.createTextOutput("roles reset");
}

// ###### SUPERADMIN SECTION ######

// ###### SUMMARY SECTION ######
function getData() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("data");
  const values = sheet.getDataRange().getValues();
  return values.slice(1).map(r => ({
    RTAF_ID: r[0],
    Rank: r[1],
    Name: r[2],
    Position: r[3],
    Unit: r[4],
    List: r[5]
  }));
}

function getRegist() {
  const sheet = SpreadsheetApp.getActive().getSheetByName("regist");
  const values = sheet.getDataRange().getValues();
  return values.slice(1).map(r => ({
    RTAF_ID: String(r[2])  // แปลงเป็น string ให้ match กับ data
  }));
}

// ###### SUMMARY SECTION ######

// ###### ADMIN SECTION ######
function handleGetPersonnel() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName('data');
  const linkSheet = ss.getSheetByName('link');
  const data = sheet.getDataRange().getValues().slice(1);
  const links = linkSheet.getDataRange().getValues().map(row => String(row[1]));
  const result = data.map(r => ({
    rtafId: String(r[0]),
    rank: r[1],
    name: r[2],
    position: r[3],
    unit: r[4],
    list: r[5] === true || r[5] === "TRUE",
    drawer: r[8] === true || r[8] === "TRUE",
    linked: links.includes(String(r[0]))
  }));
  return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
}

function handleUpdateRole(rtafId, field, value) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('data');
  const values = sheet.getDataRange().getValues();
  const rowIndex = values.findIndex(r => String(r[0]) === String(rtafId));

  if (rowIndex === -1) return ContentService.createTextOutput("not found");

  let colIndex = -1;
  if (field === "list") colIndex = 5;
  else if (field === "drawer") colIndex = 8;

  if (colIndex === -1) return ContentService.createTextOutput("invalid field");

  sheet.getRange(rowIndex + 1, colIndex + 1).setValue(value === 'true');
  SpreadsheetApp.flush();  // ✅ flush ให้แน่ใจว่าเขียนจริง
  return ContentService.createTextOutput("updated");
}

function addPersonnel(data) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('data');
  const lastRow = sheet.getLastRow();

  const existingIds = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat().map(String);
  const newId = String(data.rtafId);

  if (existingIds.includes(newId)) {
    return ContentService.createTextOutput("duplicate").setMimeType(ContentService.MimeType.TEXT);
  }

  sheet.appendRow([
    newId,
    data.rank,
    data.name,
    data.position,
    data.unit,
    false, // list
    false, // admin
    false, // superadmin
    false  // drawer
  ]);

  return ContentService.createTextOutput("success").setMimeType(ContentService.MimeType.TEXT);
}

function updatePersonnel(p) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('data'); // ✅ ไม่ต้องใช้ SPREADSHEET_ID
  const values = sheet.getDataRange().getValues();
  const rtafId = String(p.rtafId);
  const callback = p.callback || "callback";

  const rowIndex = values.findIndex(row => String(row[0]) === rtafId);
  if (rowIndex === -1) {
    return ContentService.createTextOutput(`${callback}("notfound")`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  const newData = [p.rank, p.name, p.position, p.unit];
  sheet.getRange(rowIndex + 1, 2, 1, 4).setValues([newData]);

  return ContentService.createTextOutput(`${callback}("success")`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function deletePersonnel(p) {
  const rtafId = String(p.rtafId).trim();
  const callback = p.callback || 'callback';

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const dataSheet = ss.getSheetByName('data');
  const linkSheet = ss.getSheetByName('link');

  // ✅ ลบจาก sheet 'data'
  const dataValues = dataSheet.getDataRange().getValues();
  const dataIndex = dataValues.findIndex(row => String(row[0]).trim() === rtafId);
  if (dataIndex >= 0) dataSheet.deleteRow(dataIndex + 1);

  // ✅ ลบจาก sheet 'link' ถ้ามี
  const linkValues = linkSheet.getDataRange().getValues();
  const linkIndex = linkValues.findIndex(row => String(row[1]).trim() === rtafId);
  if (linkIndex >= 0) linkSheet.deleteRow(linkIndex + 1);

  return ContentService.createTextOutput(`${callback}("success")`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function resetSheet(sheetName, callback = 'callback') {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    return ContentService.createTextOutput(`${callback}("notfound")`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.deleteRows(2, lastRow - 1); // ลบตั้งแต่แถว 2 ถึงท้าย
  }

  return ContentService.createTextOutput(`${callback}("success")`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function resetDrawers(callback = 'callback') {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('data');
  const values = sheet.getDataRange().getValues();
  const header = values[0];
  const drawerCol = header.findIndex(col => col.toString().toLowerCase().includes('drawer'));

  if (drawerCol === -1) {
    return ContentService.createTextOutput(`${callback}("missing_drawer_column")`)
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const range = sheet.getRange(2, drawerCol + 1, lastRow - 1);
    range.clearContent();
  }

  return ContentService.createTextOutput(`${callback}("success")`)
    .setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function handleUpdateList(p, callback) {
  try {
    const list = JSON.parse(p.data);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(p.updateList);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) sheet.getRange(2, 1, lastRow - 1, 2).clearContent();
    const values = list.map((v, i) => [i + 1, v]);
    if (values.length) sheet.getRange(2, 1, values.length, 2).setValues(values);
    return ContentService.createTextOutput(`${callback}("success")`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (e) {
    return ContentService.createTextOutput(`${callback}("error")`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

function handleUpdateItem(p, callback) {
  try {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(p.updateItem);
    const index = +p.index + 1;
    if (p.action === 'add') {
      const last = sheet.getLastRow();
      sheet.appendRow([last, p.value]);
    } else if (p.action === 'edit' && index > 1) {
      sheet.getRange(index + 1, 2).setValue(p.value);
    } else if (p.action === 'delete' && index > 1) {
      sheet.deleteRow(index + 1);
    }
    return ContentService.createTextOutput(`${callback}("success")`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  } catch (e) {
    return ContentService.createTextOutput(`${callback}("error")`).setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
}

// ###### ADMIN SECTION ######