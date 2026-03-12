# LINE x Google Calendar 課程排程系統教學

本文件介紹如何建立一個整合 LINE 機器人與 Google 日曆的課程排程系統。老師或學生可以透過 LINE 輸入課程資訊，系統會自動在 Google 日曆建立行程並回傳通知。

## 系統架構
- **介面**：LINE Messaging API
- **後端**：Google Apps Script (GAS)
- **資料儲存**：Google Calendar

## 設定步驟

### 1. 建立 LINE 機器人
1. 登入 [LINE Developers Console](https://developers.line.biz/)。
2. 建立一個 **Provider** 並在下方建立一個 **Messaging API Channel**。
3. 在 Channel settings 中找到以下資訊：
   - **Channel Secret**
   - **Messaging API** 標籤下的 **Channel access token (long-lived)**（需點擊 Issue 產生）。

### 2. 設定 Google Apps Script (GAS)
1. 開啟 [Google Apps Script](https://script.google.com/) 並建立新專案。
2. 貼入下方的 [GAS 原始碼](#gas-原始碼)。
3. 在程式碼中填入你的 `CHANNEL_ACCESS_TOKEN`。
4. 點擊「部署」 > 「新部署」。
   - 種類：Web App
   - 執行身份：Me
   - 誰可以存取：Anyone
5. 複製產生的 **Web App URL**。

### 3. 設定 LINE Webhook
1. 回到 LINE Developers Console 的 **Messaging API** 標籤。
2. 在 **Webhook URL** 貼上剛才複製的 GAS URL。
3. 開啟 **Use webhook** 開關。
4. 點擊 **Verify** 測試連線。

## GAS 原始碼

```javascript
var CHANNEL_ACCESS_TOKEN = '你的_CHANNEL_ACCESS_TOKEN';
var CALENDAR_ID = 'primary'; // 使用預設日曆，或填入特定的日曆 ID

function doPost(e) {
  var contents = JSON.parse(e.postData.contents);
  var event = contents.events[0];
  
  if (event.type !== 'message' || event.message.type !== 'text') return;
  
  var userMessage = event.message.text;
  var replyToken = event.replyToken;
  
  // 簡易解析邏輯：[時間] [內容]
  // 例如：2026/03/15 14:00-15:00 鋼琴課-學生A
  var parsed = parseMessage(userMessage);
  
  if (parsed) {
    createCalendarEvent(parsed);
    replyMessage(replyToken, "✅ 已成功記錄行程：\n" + parsed.title + "\n時間：" + parsed.startTime + " ~ " + parsed.endTime);
  } else {
    // 如果格式不符，可以回傳提示
    // replyMessage(replyToken, "格式不符。請輸入：YYYY/MM/DD HH:mm-HH:mm 內容");
  }
}

function parseMessage(text) {
  // 正則表達式匹配範例：2026/03/15 14:00-15:00 課程內容
  var regex = /(\d{4}\/\d{1,2}\/\d{1,2})\s+(\d{1,2}:\d{2})-(\d{1,2}:\d{2})\s+(.+)/;
  var match = text.match(regex);
  
  if (match) {
    var dateStr = match[1];
    var startT = match[2];
    var endT = match[3];
    var title = match[4];
    
    return {
      startTime: new Date(dateStr + ' ' + startT),
      endTime: new Date(dateStr + ' ' + endT),
      title: title
    };
  }
  return null;
}

function createCalendarEvent(data) {
  var calendar = CalendarApp.getCalendarById(CALENDAR_ID);
  calendar.createEvent(data.title, data.startTime, data.endTime);
}

function replyMessage(token, text) {
  var url = 'https://api.line.me/v2/bot/message/reply';
  UrlFetchApp.fetch(url, {
    'headers': {
      'Content-Type': 'application/json; charset=UTF-8',
      'Authorization': 'Bearer ' + CHANNEL_ACCESS_TOKEN,
    },
    'method': 'post',
    'payload': JSON.stringify({
      'replyToken': token,
      'messages': [{ 'type': 'text', 'text': text }]
    }),
  });
}
```

## 進階設定：控制共享日曆
如果您想控制的不是自己的「主日曆」，而是某個特定的「共享日曆」或「小組日曆」，請依照以下步驟操作：

### 1. 取得共享日曆 ID
1. 在電腦上開啟 [Google 日曆](https://calendar.google.com/)。
2. 在左側「我的日曆」下找到該日曆，點擊「設定與共用」。
3. 向下捲動到「整合日曆」區塊，複製 **「日曆 ID」**（通常長得像 `xxxx@group.calendar.google.com`）。

### 2. 更新 GAS 程式碼
1. 開啟您的 GAS 專案。
2. 將第一行（或對應行數）的 `CALENDAR_ID` 改為您剛才複製的 ID：
   ```javascript
   var CALENDAR_ID = 'xxxx@group.calendar.google.com';
   ```
3. 重新部署您的 Web App。

### 3. 確認權限
確保執行該 GAS 程式碼的 Google 帳號擁有該日曆的「進行更動及管理共用權限」或「進行更動」權限。


## 使用說明
### 全智慧解析模式 (無需固定指令)
本系統已全面改為 AI 智慧解析模式。您不需要記住任何複雜的指令格式，直接像面對真人秘書一樣對話即可。AI 會自動判斷您的意圖（新增、查詢、修改、刪除）。

**範例：**
- **新增課程**：
  - `明天下午兩點到三點小明要上鋼琴課`
  - `幫我登記下週三早上十點林老師的課`
- **查詢行程**：
  - `這週有什麼課？`
  - `明天的行程有哪些？`
  - `三月十二號有課嗎？`
- **修改行程**：
  - `剛剛小明的課改成下週三同一時間`
  - `把後天的英文課從兩點改到三點`
- **取消行程**：
  - `取消明天下午兩點的鋼琴課`
  - `下週三小明的課不上了`

### 進階功能：一次處理多個指令
您可以一次在一則訊息中說出多個排程需求：
- `幫我新增明天下午兩點的鋼琴課，另外查詢週五有哪些課？`
