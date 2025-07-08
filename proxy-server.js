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

// --- СИСТЕМНЫЙ ПРОМПТ ДЛЯ АНАЛИЗА САЙТОВ (Универсальный) ---
// Этот промпт будет использоваться для обоих типов запросов,
// поэтому он должен быть достаточно общим.
const systemPrompt = `
Ты — AI-аналитик, специализирующийся на бизнес-анализе.
Твоя задача — обрабатывать запросы, связанные с анализом веб-сайтов и генерацией информации.
В зависимости от типа запроса, ты должен:
1.  **Для генерации словарей (type: 'dictionaries'):**
    На основе предоставленных URL-адресов компании и конкурентов, проведи глубокий анализ сайтов, чтобы создать набор словарей для системы речевой аналитики.
    Сгенерируй ТОЛЬКО один валидный JSON-объект со следующей структурой. Не добавляй никаких комментариев, объяснений или обрамления \`\`\`json.
    {
      "dictionaries": [
        { "title": "Наши Услуги", "description": "Все услуги, которые предлагает компания.", "terms": ["Список услуг"] },
        { "title": "Конкуренты", "description": "Названия компаний-конкурентов.", "terms": ["список названий"] },
        { "title": "Технические Термины", "description": "Специфическая отраслевая лексика и термины.", "terms": ["список терминов"] },
        { "title": "Причины Обращения (Проблемы)", "description": "Фразы, описывающие, зачем клиенты могут звонить.", "terms": ["список фраз"] }
      ]
    }
    Включи в словари только самые важные и часто встречающиеся термины.

2.  **Для генерации контекста бизнеса (type: 'business_context'):**
    На основе предоставленного URL-адреса сайта компании, составь краткое описание сути её бизнеса.
    Описание должно быть в пределах 5-10 предложений. Оно должно быть информативным, но лаконичным, фокусируясь на ключевых аспектах и УСЛУГАХ деятельности компании.
    Ответь ТОЛЬКО текстом описания, без каких-либо дополнительных комментариев, объяснений или форматирования (например, без Markdown-блоков).
`;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const generationConfig = {
    temperature: 0.1,
};

// ИНИЦИАЛИЗАЦИЯ ОДНОЙ МОДЕЛИ С ИНСТРУМЕНТАМИ
const model = genAI.getGenerativeModel({
    model: "gemini-1.5-pro-latest",
    systemInstruction: systemPrompt, // Используем универсальный промпт
    generationConfig: generationConfig,
    tools: [{ "google_search_retrieval": {} }],
});


app.post('/generate-dictionaries', async (req, res) => { // Теперь этот эндпоинт обрабатывает оба типа запросов
    try {
        const { type, my_site_url, competitor_urls, site_url, sessionId } = req.body;

        let userPrompt = '';
        let responseContentType = 'application/json'; // По умолчанию для словарей
        let botResponseText;

        if (type === 'business_context') {
            if (!site_url) {
                return res.status(400).json({ error: 'URL сайта обязателен для генерации контекста бизнеса' });
            }
            userPrompt = `Сгенерируй краткое описание сути бизнеса на основе информации с сайта: ${site_url}. Ответь ТОЛЬКО текстом описания, как указано в системной инструкции.`;
            responseContentType = 'text/plain';

            const result = await model.generateContent(userPrompt);
            const response = await result.response;
            botResponseText = response.text();

            // Удаляем Markdown обёртку (на всякий случай, хотя промпт просит чистый текст)
            if (typeof botResponseText === 'string') {
                botResponseText = botResponseText.trim();
            }

        } else { // type === 'dictionaries' или не указан (по умолчанию)
            if (!my_site_url || !sessionId) {
                return res.status(400).json({ error: 'URL сайта компании и Session ID обязательны для генерации словарей' });
            }
            userPrompt = `
                Проанализируй следующие сайты и создай для них словари.
                - Сайт моей компании: ${my_site_url}
                - Сайты конкурентов: ${(competitor_urls || []).join(', ')}
                Ответь ТОЛЬКО JSON-объектом, как указано в системной инструкции.
            `;

            const result = await model.generateContent(userPrompt);
            const response = await result.response;
            botResponseText = response.text();

            // Удаляем Markdown обёртку (на всякий случай)
            if (typeof botResponseText === 'string') {
                botResponseText = botResponseText
                    .replace(/^```(?:json)?\s*/i, '')
                    .replace(/\s*```$/i, '')
                    .trim();
            }

            // Пишем в Google Sheets (только для словарей)
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
        }

        res.setHeader('Content-Type', responseContentType);
        res.send(botResponseText);

    } catch (error) {
        console.error("Error in /generate-dictionaries endpoint:", error);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Internal Server Error' });
        }
    }
});

// Старый эндпоинт, который возвращал ошибку - теперь удален или перенаправлен
app.post('/generate', async (req, res) => {
    res.status(501).json({ error: 'This endpoint is deprecated. Please use /generate-dictionaries' });
});


module.exports = app;

