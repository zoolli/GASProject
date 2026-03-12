var LINE_CHANNEL_ACCESS_TOKEN = '';
var GEMINI_API_KEY = '';
var OPENAI_API_KEY = ``;
var LINE_USER_ID = '';
var CALENDAR_ID = "@group.calendar.google.com";
var USER_ID_STORE = 'userId';

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return ContentService.createTextOutput('OK');
    }
    
    var contents = JSON.parse(e.postData.contents);
    var events = contents.events;
    
    if (!events || events.length === 0) {
      return ContentService.createTextOutput('OK');
    }
    
    events.forEach(function(event) {
      handleEvent(event);
    });
    
    return ContentService.createTextOutput('OK');
  } catch (err) {
    Logger.log('doPost error: ' + err.message);
    return ContentService.createTextOutput('OK');
  }
}

function doGet(e) {
  var action = e.parameter.action;
  
  if (action === 'today') {
    sendTodayEvents();
    return ContentService.createTextOutput('今日行程已發送');
  }
  
  return ContentService.createTextOutput('LINE Bot is running. POST only.');
}

function handleEvent(event) {
  var replyToken = event.replyToken;
  var userId = event.source.userId;
  
  // 紀錄使用者 ID 以便推播
  PropertiesService.getScriptProperties().setProperty(USER_ID_STORE, userId);
  
  if (event.type === 'message' && event.message.type === 'text') {
    var userMessage = event.message.text.trim();
    
    // 全智慧解析模式：所有文字訊息交給 AI 處理
    processWithAI(userMessage, replyToken);
    
  } else if (event.type === 'follow') {
    replyLine(replyToken, '您好！歡迎使用 AI 課程助手。\n\n您可以直接跟我說：\n「幫我新增明天下午兩點的鋼琴課」\n「這週有什麼行程？」\n「取消下週三的數學課」\n「後天的課改成早上十點」');
  }
}

function processWithAI(text, replyToken) {
  if (!GEMINI_API_KEY) {
    replyLine(replyToken, "⚠️ 系統未設定 AI 金鑰，請聯繫管理員。");
    return;
  }

  var aiResponse = callGeminiAPI(text);
  if (!aiResponse) {
    aiResponse = callOpenAIAPI(text); // Fallback to OpenAI if Gemini fails
  }
  Logger.log('AI Response: ' + JSON.stringify(aiResponse));
  
  if (!aiResponse || aiResponse.length === 0) {
    replyLine(replyToken, "🤖 抱歉，我聽不懂您的意思。請嘗試更具體的說法，例如：『幫我新增...』或『查詢...』。");
    return;
  }

  var finalMsg = "";
  var calendar = CalendarApp.getCalendarById(CALENDAR_ID);

  aiResponse.forEach(function(item) {
    try {
      switch (item.action) {
        case 'ADD':
          var start = new Date(item.start);
          var end = new Date(item.end);
          calendar.createEvent(item.title, start, end);
          finalMsg += "✅ 已新增：" + item.title + "\n📅 " + formatDate(start) + " " + formatTime(start) + "\n\n";
          break;
          
        case 'QUERY':
          var qStart = new Date(item.start);
          var qEnd = new Date(item.end);
          var events = calendar.getEvents(qStart, qEnd);
          finalMsg += "📅 查詢結果 (" + item.title + ")：\n";
          if (events.length === 0) {
            finalMsg += "尚無行程。\n\n";
          } else {
            events.forEach(function(e) {
              finalMsg += "• " + formatDate(e.getStartTime()) + " " + formatTime(e.getStartTime()) + " " + e.getTitle() + "\n";
            });
            finalMsg += "\n";
          }
          break;

        case 'UPDATE':
          // 智慧修改：先根據舊日期或今天/明天/後天的範圍找行程
          var targetDate = new Date(item.old_start || item.start);
          var searchStart = new Date(targetDate);
          searchStart.setHours(0,0,0);
          var searchEnd = new Date(targetDate);
          searchEnd.setHours(23,59,59);
          
          var foundEvents = calendar.getEvents(searchStart, searchEnd);
          var updated = false;
          
          // 如果有給關鍵字就過濾關鍵字，否則取該日第一筆
          foundEvents.forEach(function(e) {
            if (!updated && (!item.old_title || e.getTitle().indexOf(item.old_title) !== -1)) {
              var oldTitle = e.getTitle();
              e.setTime(new Date(item.start), new Date(item.end));
              if (item.new_title) e.setTitle(item.new_title);
              finalMsg += "✏️ 已修改：" + oldTitle + " -> " + formatDate(new Date(item.start)) + " " + formatTime(new Date(item.start)) + "\n\n";
              updated = true;
            }
          });
          if (!updated) finalMsg += "⚠️ 找不到要修改的行程（" + formatDate(targetDate) + "）。\n\n";
          break;

        case 'DELETE':
          var dDate = new Date(item.start);
          var dSearchStart = new Date(dDate);
          dSearchStart.setHours(0,0,0);
          var dSearchEnd = new Date(dDate);
          dSearchEnd.setHours(23,59,59);
          
          var dEvents = calendar.getEvents(dSearchStart, dSearchEnd);
          var deleted = false;
          dEvents.forEach(function(e) {
            if (!deleted && (!item.title || e.getTitle().indexOf(item.title) !== -1)) {
              var dTitle = e.getTitle();
              e.deleteEvent();
              finalMsg += "🗑 已取消：" + dTitle + "\n\n";
              deleted = true;
            }
          });
          if (!deleted) finalMsg += "⚠️ 找不到要取消的行程（" + formatDate(dDate) + "）。\n\n";
          break;

        default:
          finalMsg += "🤖 收到指令：" + item.action + "，但目前尚不支援此操作。\n\n";
      }
    } catch (e) {
      finalMsg += "❌ 執行失敗：" + (item.title || item.action) + " (" + e.toString() + ")\n\n";
      Logger.log('Action Error: ' + e.toString());
    }
  });

  if (finalMsg) {
    replyLine(replyToken, finalMsg.trim());
  }
}

function callOpenAIAPI(text) {
  var now = new Date();
  var todayStr = formatDate(now);
  var dayOfWeek = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  
  var prompt = "你是一個專業的行程秘書。請解析使用者輸入並判斷意圖。使用者訊息可能包含多行，代表多個動作，請全部解析。\n\n" +
    "目前的今天是 " + todayStr + " (星期" + dayOfWeek + ")。\n" +
    "請精確換算日期：明天是 " + formatDate(new Date(now.getTime() + 86400000)) + "，後天是 " + formatDate(new Date(now.getTime() + 86400000 * 2)) + "。\n\n" +
    "請嚴格回傳一個 JSON 陣列，每個元素代表一個動作：\n" +
    "- 新增 (ADD)：需包含 title, start, end (ISO格式)。例：{ \"action\": \"ADD\", \"title\": \"標題\", \"start\": \"...\", \"end\": \"...\" }\n" +
    "- 查詢 (QUERY)：需包含 title (範圍描述), start, end (範圍ISO)。\n" +
    "- 修改 (UPDATE)：需包含 old_title (關鍵字,可空), old_start (原本日期ISO), start (新開始ISO), end (新結束ISO), new_title (可選)。\n" +
    "- 刪除 (DELETE)：需包含 title (關鍵字,可空), start (目標日期ISO以利搜尋)。\n\n" +
    "注意：\n" +
    "1. 預設上課時間為 1 小時。\n" +
    "2. 使用者說「後天的課改成...」代表 old_start 是後天，start 是新時間。\n" +
    "3. 確保回傳結果是一個合法的 JSON 陣列，不要有額外文字。\n\n" +
    "內容：\"" + text + "\"";

  var url = 'https://api.openai.com/v1/chat/completions';
  var payload = {
    'model': 'gpt-4o',
    'messages': [
      { 'role': 'system', 'content': '你是一個行程助手，只會回傳 JSON 陣列格式。' },
      { 'role': 'user', 'content': prompt }
    ],
    'temperature': 0.1
  };
  
  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'headers': { 'Authorization': 'Bearer ' + OPENAI_API_KEY },
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseText = response.getContentText();
    Logger.log('OpenAI API Response: ' + responseText);
    
    var json = JSON.parse(responseText);
    if (json.error) {
      Logger.log('OpenAI Error: ' + json.error.message);
      return null;
    }

    var aiText = json.choices[0].message.content;
    var jsonMatch = aiText.match(/\[[\s\S]*\]/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch (e) {
    Logger.log('OpenAI fetch Error: ' + e.toString());
  }
  return null;
}

function callGeminiAPI(text) {
  var now = new Date();
  var todayStr = formatDate(now);
  var dayOfWeek = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  
  var prompt = "你是一個專業的行程秘書。請解析使用者輸入並判斷意圖。使用者訊息可能包含多行，代表多個動作，請全部解析。\n\n" +
    "目前的今天是 " + todayStr + " (星期" + dayOfWeek + ")。\n" +
    "請精確換算日期：明天是 " + formatDate(new Date(now.getTime() + 86400000)) + "，後天是 " + formatDate(new Date(now.getTime() + 86400000 * 2)) + "。\n\n" +
    "請嚴格回傳一個 JSON 陣列，每個元素代表一個動作：\n" +
    "- 新增 (ADD)：需包含 title, start, end (ISO格式)。例：{ \"action\": \"ADD\", \"title\": \"標題\", \"start\": \"...\", \"end\": \"...\" }\n" +
    "- 查詢 (QUERY)：需包含 title (範圍描述), start, end (範圍ISO)。\n" +
    "- 修改 (UPDATE)：需包含 old_title (關鍵字,可空), old_start (原本日期ISO), start (新開始ISO), end (新結束ISO), new_title (可選)。\n" +
    "- 刪除 (DELETE)：需包含 title (關鍵字,可空), start (目標日期ISO以利搜尋)。\n\n" +
    "注意：\n" +
    "1. 預設上課時間為 1 小時。\n" +
    "2. 使用者說「後天的課改成...」代表 old_start 是後天，start 是新時間。\n" +
    "3. 確保回傳結果是一個合法的 JSON 陣列，不要有額外文字內容。\n\n" +
    "內容：\"" + text + "\"";

  // 使用 gemma-2-9b-it 模型
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-2-9b-it:generateContent?key=' + GEMINI_API_KEY;
  
  var payload = {
    "contents": [{
      "parts": [{ "text": prompt }]
    }],
    "generationConfig": {
      "temperature": 0.1,
      "maxOutputTokens": 1024,
      "responseMimeType": "application/json"
    }
  };

  var options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseText = response.getContentText();
    Logger.log('Gemini API Response: ' + responseText);
    
    var json = JSON.parse(responseText);
    if (json.error) {
      Logger.log('Gemini Error: ' + json.error.message);
      return null;
    }

    if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts) {
      var aiText = json.candidates[0].content.parts[0].text;
      var jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) return JSON.parse(jsonMatch[0]);
    }
  } catch (e) {
    Logger.log('Gemini fetch Error: ' + e.toString());
  }
  return null;
}

function replyLine(replyToken, text) {
  if (!replyToken) return;
  var url = 'https://api.line.me/v2/bot/message/reply';
  try {
    UrlFetchApp.fetch(url, {
      'headers': {
        'Content-Type': 'application/json; charset=UTF-8',
        'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN,
      },
      'method': 'post',
      'payload': JSON.stringify({
        'replyToken': replyToken,
        'messages': [{ 'type': 'text', 'text': text }]
      }),
      'muteHttpExceptions': true
    });
  } catch (e) {
    Logger.log('Reply error: ' + e.message);
  }
}

function formatDate(date) {
  return Utilities.formatDate(date, "GMT+8", "yyyy/MM/dd");
}

function formatTime(date) {
  return Utilities.formatDate(date, "GMT+8", "HH:mm");
}

function sendTodayEvents() {
  var start = new Date();
  start.setHours(0,0,0,0);
  var end = new Date();
  end.setHours(23,59,59,999);
  var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  var events = calendar.getEvents(start, end);
  
  var msg = "📅 今日行程 (" + formatDate(start) + ")：\n";
  if (events.length === 0) {
    msg += "尚無行程";
  } else {
    events.forEach(function(e) {
      msg += "• " + formatTime(e.getStartTime()) + " " + e.getTitle() + "\n";
    });
  }
  
  var userId = PropertiesService.getScriptProperties().getProperty(USER_ID_STORE);
  if (userId) pushMessage(userId, msg);
}

function pushMessage(userId, text) {
  var url = 'https://api.line.me/v2/bot/message/push';
  UrlFetchApp.fetch(url, {
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + LINE_CHANNEL_ACCESS_TOKEN
    },
    'method': 'post',
    'payload': JSON.stringify({ 'to': userId, 'messages': [{ 'type': 'text', 'text': text }] }),
    'muteHttpExceptions': true
  });
}