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
  else {
    replyLine(replyToken, `event.message.type: ${JSON.stringify(event.message.type)}`)
  }
}

function processWithAI(text, replyToken) {
  if (!GEMINI_API_KEY) {
    replyLine(replyToken, "⚠️ 系統未設定 AI 金鑰，請聯繫管理員。");
    return;
  }

  var aiResponse = callGeminiAPI(replyToken, text);
  Logger.log('AI Response: ' + JSON.stringify(aiResponse));
  
  if (!aiResponse || aiResponse.length === 0) {
    // 如果 AI 完全沒回傳或格式錯誤
    return; 
  }

  var finalMsg = "";
  var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  var needsMonthlySummary = false;

  aiResponse.forEach(function(item) {
    try {
      switch (item.action) {
        case 'ADD':
          var start = new Date(item.start);
          var end = new Date(item.end);
          calendar.createEvent(item.title, start, end);
          finalMsg += "✅ 已新增：" + item.title + "\n📅 " + formatDate(start) + " " + formatTime(start) + "\n\n";
          needsMonthlySummary = true;
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
          var targetDate = new Date(item.old_start || item.start);
          var searchStart = new Date(targetDate);
          searchStart.setHours(0,0,0);
          var searchEnd = new Date(targetDate);
          searchEnd.setHours(23,59,59);
          
          var foundEvents = calendar.getEvents(searchStart, searchEnd);
          var updated = false;
          
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

        case 'HINT':
          finalMsg += "💡 格式提示：" + item.reason + "\n正確格式為：[人名] [日期時間] [課程內容]\n例如：小明 2026/03/15 14:00 鋼琴課\n\n";
          break;

        case 'IGNORE':
          // 與報名無關，不予回應
          break;

        default:
          Logger.log('未知行動：' + item.action);
      }
    } catch (e) {
      finalMsg += "❌ 執行失敗：" + (item.title || item.action) + " (" + e.toString() + ")\n\n";
      Logger.log('Action Error: ' + e.toString());
    }
  });

  if (needsMonthlySummary) {
    finalMsg += getMonthlySummary();
  }

  if (finalMsg.trim()) {
    replyLine(replyToken, finalMsg.trim());
  }
}

/**
 * 取得當月報名總覽
 */
function getMonthlySummary() {
  var now = new Date();
  var startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  var endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59);
  
  var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  var events = calendar.getEvents(startOfMonth, endOfMonth);
  
  var summary = "📊 " + (now.getMonth() + 1) + " 月報名總覽：\n";
  if (events.length === 0) {
    summary += "目前尚無報名紀錄。";
  } else {
    // 依時間排序
    events.sort(function(a, b) {
      return a.getStartTime() - b.getStartTime();
    });
    events.forEach(function(e) {
      summary += "• " + formatDate(e.getStartTime()) + " " + formatTime(e.getStartTime()) + " " + e.getTitle() + "\n";
    });
  }
  return summary;
}

function callGeminiAPI(replyToken, text) {
  var now = new Date();
  var todayStr = formatDate(now);
  var dayOfWeek = ["日", "一", "二", "三", "四", "五", "六"][now.getDay()];
  
  var prompt = "你是一個專業的課程報名秘書。請解析使用者輸入並判斷其意圖。\n\n" +
    "目前的今天是 " + todayStr + " (星期" + dayOfWeek + ")。\n\n" +
    "【規則】\n" +
    "1. 如果使用者想要「報名課程」或「新增行程」，其輸入必須符合格式：『[人名] [日期時間] [課程內容]』。\n" +
    "   - 範例：『小明 2026/03/15 14:00 鋼琴課』。\n" +
    "   - 報名時的 title 請統一格式為『[人名][課程]』(例如：小明鋼琴課)。\n" +
    "2. 如果要「刪除/取消」報名，必須包含『人名』與『課程』(例如：取消小明的鋼琴課)。\n" +
    "   - 刪除時的 title 必須與報名時的『[人名][課程]』一致。\n" +
    "3. 「查詢」功能必須列出所選期間內「所有學生」的報名課程，而不僅限於某一人。\n" +
    "4. 如果使用者的訊息跟報名、查詢、修改、刪除完全無關，請回傳 ACTION: 'IGNORE'。\n" +
    "5. 若報名格式不正確，請回傳 ACTION: 'HINT' 並說明缺少的資訊。\n\n" +
    "【輸出格式】\n" +
    "請嚴格回傳一個 JSON 陣列，每個元素代表一個動作：\n" +
    "- ADD (新增)：需包含 title (人名課程), start, end (ISO格式)。\n" +
    "- QUERY (查詢)：需包含 title (範圍描述), start, end (範圍ISO)。\n" +
    "- UPDATE (修改)：需包含 old_title, old_start, start, end, new_title。\n" +
    "- DELETE (刪除)：需包含 title (必須是[人名][課程]), start (目標日期)。\n" +
    "- HINT (提示)：格式錯誤時使用。需包含 reason (字串)。\n" +
    "- IGNORE (忽略)：無關對話時使用。\n\n" +
    "確保回傳結果是一個合法的 JSON 陣列，不要有任何額外文字敘述。\n\n" +
    "使用者內容：\"" + text + "\"";

  // 使用 gemini-1.5-flash 模型
  // var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + GEMINI_API_KEY;
  // 使用 gemma-2-9b-it 模型
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemma-3n-e2b-it:generateContent?key=' + GEMINI_API_KEY;
  var payload = { 'contents': [{ 'parts': [{ 'text': prompt }] }] };
  var options = { 'method': 'post', 'contentType': 'application/json', 'payload': JSON.stringify(payload), 'muteHttpExceptions': true };
  
  try {
    var response = UrlFetchApp.fetch(url, options);
    var responseText = response.getContentText();
    Logger.log('Gemini API Response: ' + responseText);
    
    var json = JSON.parse(responseText);
    
    if (json.error) {
      Logger.log('Gemini API Error details: ' + JSON.stringify(json.error));
      // 若有必要可取消註解下面這行進行除錯
      // replyLine(replyToken, 'Gemini API Error details:' + JSON.stringify(json.error));
      return null;
    }

    if (json.candidates && json.candidates[0].content && json.candidates[0].content.parts[0].text) {
      var aiText = json.candidates[0].content.parts[0].text;
      var jsonMatch = aiText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        return JSON.parse(jsonMatch[0]);
      } else {
        Logger.log('AI text does not contain JSON array: ' + aiText);
      }
    } else {
      Logger.log('Unexpected Gemini API structure: ' + JSON.stringify(json));
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

function listModels() {
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=' + GEMINI_API_KEY;
  var response = UrlFetchApp.fetch(url, { 'muteHttpExceptions': true });
  Logger.log('Available Models: ' + response.getContentText());
}