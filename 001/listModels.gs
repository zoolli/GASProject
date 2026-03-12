/**
 * 列出所有可用的 Gemini 模型
 * 執行此函式前，請確保 GEMINI_API_KEY 已正確設定（可在 lineNotify.gs 中設定或手動填入）
 */
function listGeminiModels() {
  // 優先從 lineNotify.gs 的全域變數取得，如果沒有則需手動填入
  var apiKey = typeof GEMINI_API_KEY !== 'undefined' ? GEMINI_API_KEY : '';
  
  if (!apiKey) {
    Logger.log('❌ 錯誤：找不到 GEMINI_API_KEY。請在 lineNotify.gs 中設定或手動填入此處。');
    return;
  }

  var url = 'https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey;
  
  try {
    var response = UrlFetchApp.fetch(url, { 'muteHttpExceptions': true });
    var responseCode = response.getResponseCode();
    var responseText = response.getContentText();
    var json = JSON.parse(responseText);

    if (responseCode !== 200) {
      Logger.log('❌ API 請求失敗 (Code: ' + responseCode + '): ' + (json.error ? json.error.message : responseText));
      return;
    }

    if (json.models) {
      Logger.log('✅ 找到以下 Gemini 模型：');
      json.models.forEach(function(model) {
        Logger.log('-----------------------------------');
        Logger.log('名稱: ' + model.name);
        Logger.log('顯示名稱: ' + model.displayName);
        Logger.log('版本: ' + model.version);
        Logger.log('描述: ' + model.description);
        Logger.log('支援的功能: ' + model.supportedGenerationMethods.join(', '));
      });
    } else {
      Logger.log('ℹ️ 未找到任何模型。');
    }
  } catch (e) {
    Logger.log('❌ 發生錯誤: ' + e.toString());
  }
}
