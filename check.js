require("dotenv").config();
fetch("https://generativelanguage.googleapis.com/v1beta/models?key=" + process.env.GEMINI_API_KEY)
  .then(r => r.json())
  .then(d => d.models.filter(m => m.supportedGenerationMethods.includes("generateContent")).forEach(m => console.log(m.name)));