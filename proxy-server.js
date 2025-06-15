// Устанавливаем необходимые пакеты: npm install express @google/generative-ai cors
const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3000;

// ВАЖНО: Храните ваш API ключ в переменных окружения, а не в коде!
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.use(cors()); // Разрешаем запросы с других доменов (с вашего сайта на Tilda)
app.use(express.json());

// Создаем эндпоинт, на который будет обращаться наш чат на Tilda
app.post('/generate', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' }); // Используем быструю модель

    // Добавляем системный промпт, чтобы бот помнил свою роль
    const fullPrompt = `Ты — эксперт по проектной документации и проектированию. Отвечай на вопросы пользователя в этой области. Вопрос пользователя: "${prompt}"`;

    const result = await model.generateContent(fullPrompt);
    const response = await result.response;
    const text = response.text();

    res.json({ text });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Failed to generate content' });
  }
});

app.listen(port, () => {
  console.log(`Proxy server listening on port ${port}`);
});
