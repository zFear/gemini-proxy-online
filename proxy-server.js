const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
app.use(cors());
app.use(express.json());

// --- БЛОК АУТЕНТИФИКАЦИИ GOOGLE ДЛЯ ТАБЛИЦ (без изменений) ---
const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  },
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

const sheets = google.sheets({ version: 'v4', auth });
const spreadsheetId = process.env.GOOGLE_SHEETS_ID;
// ------------------------------------

// --- СИСТЕМНЫЙ ПРОМПТ ДЛЯ АНАЛИЗА САЙТОВ (без изменений) ---
const systemPrompt = `
Ты — AI-аналитик, специализирующийся на бизнес-анализе и семантическом ядре для строительной отрасли.
Твоя задача — на основе предоставленных URL-адресов провести глубокий анализ сайтов компании и ее конкурентов, чтобы создать набор словарей для системы речевой аналитики.

**Твой алгоритм действий:**
1.  **Изучи сайт компании:** Перейди по URL сайта компании, проанализируй его контент, чтобы точно определить основные услуги, специфическую терминологию и целевую аудиторию.
2.  **Изучи сайты конкурентов:** Перейди по URL сайтов конкурентов, чтобы определить их названия и сравнить их услуги с услугами основной компании.
3.  **Сгенерируй словари:** На основе всего комплексного анализа, сгенерируй **ТОЛЬКО один валидный JSON-объект** со следующей структурой. Не добавляй никаких комментариев, объяснений или обрамления \`\`\`json.

**Структура JSON:**
{
  "dictionaries": [
    {
      "title": "Наши Услуги",
      "description": "Ключевые услуги, которые предлагает компания.",
      "terms": ["список из 5-10 ключевых услуг, найденных на сайте компании"]
    },
    {
      "title": "Конкуренты",
      "description": "Названия компаний-конкурентов, найденные на сайтах.",
      "terms": ["список названий конкурентов"]
    },
    {
      "title": "Технические Термины",
      "description": "Специфическая отраслевая лексика и термины.",
      "terms": ["список из 10-15 важных технических терминов, найденных на всех сайтах"]
    },
    {
      "title": "Причины Обращения (Проблемы)",
      "description": "Фразы, описывающие, зачем клиенты могут звонить.",
      "terms": ["список фраз, например 'рассчитать стоимость', 'получить консультацию', 'снять замечания'"]
    }
  ]
}

**Инструкции по заполнению:**
- Внимательно проанализируй все предоставленные сайты.
- Извлеки из них информацию для заполнения словарей "Наши Услуги", "Конкуренты", "Технические Термины".
- На основе общего понимания тематики бизнеса и анализа контента, предположи, с какими проблемами и вопросами могут обращаться клиенты, и заполни словарь "Причины Обращения".
- Включи в словари только самые важные и часто встречающиеся термины. Ответ должен быть строго в формате JSON.
`;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generationConfig = {
    temperature: 0.1,
};

// --- ИНИЦИАЛИЗАЦИЯ МОДЕЛИ С ИНСТРУМЕНТАМИ ---
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro-latest",
    systemInstruction: systemPrompt,
    generationConfig: generationConfig,
    // ИСПРАВЛЕНО: googleSearch заменен на google_search_retrieval согласно сообщению об ошибке.
    tools: [{ "google_search_retrieval": {} }], 
});


app.post('/generate-dictionaries', async (req, res) => {
  try {
    const { my_site_url, competitor_urls, sessionId } = req.body;
    
    if (!my_site_url || !sessionId) {
      return res.status(400).json({ error: 'URL сайта компании и Session ID обязательны' });
    }

    const userPrompt = `
      Проанализируй следующие сайты и создай для них словари.
      - Сайт моей компании: ${my_site_url}
      - Сайты конкурентов: ${(competitor_urls || []).join(', ')}
    `;

    const result = await model.generateContent(userPrompt);
    const response = await result.response;
    let botResponseText = response.text();

    // 🧼 Удаляем Markdown-обрамление
    botResponseText = botResponseText
      .replace(/^```json\s*/i, '')
      .replace(/```$/, '')
      .trim();

    try {
        await sheets.spreadsheets.values.append({
            spreadsheetId,
            range: 'A1',
            valueInputOption: 'USER_ENTERED',
            resource: {
                values: [[sessionId, userPrompt, botResponseText]],
            },
        });
    } catch (err) {
        console.error('Error writing to Google Sheets:', err.message);
    }
    
    try {
        const parsedResponse = JSON.parse(botResponseText);
        res.json(parsedResponse);
    } catch (parseError) {
        console.error("Failed to parse Gemini response as JSON:", botResponseText);
        res.status(500).json({ error: 'AI response was not valid JSON', raw_response: botResponseText });
    }

  } catch (error) {
    console.error("Error in /generate-dictionaries endpoint:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: 'Internal Server Error' });
    }
  }
});

// Старый эндпоинт, который возвращал ошибку
app.post('/generate', async (req, res) => {
    res.status(501).json({ error: 'This endpoint is deprecated. Please use /generate-dictionaries' });
});


module.exports = app;
