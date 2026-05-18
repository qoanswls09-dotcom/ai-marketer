const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegInstaller = require("@ffmpeg-installer/ffmpeg");
ffmpeg.setFfmpegPath(ffmpegInstaller.path);
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOAD_DIR = process.env.NODE_ENV === "production" ? "/tmp/uploads" : "uploads";
const VIDEO_DIR = process.env.NODE_ENV === "production" ? "/tmp/videos" : "public/videos";

if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(VIDEO_DIR)) fs.mkdirSync(VIDEO_DIR, { recursive: true });
if (!fs.existsSync("public")) fs.mkdirSync("public", { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/[^a-zA-Z0-9.]/g, "_")),
});
const upload = multer({ storage });

app.use(express.static("public"));
app.use(express.json());

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL || "https://hook.eu1.make.com/k11ssrej9q80xb81b2o9r7e1rqu1kq";

app.post("/publish-instagram", async (req, res) => {
  try {
    const { type, url, caption } = req.body;
    if (!url || !caption) return res.status(400).json({ success: false, error: "url과 caption이 필요합니다." });
    const payload = type === "reel" ? { video_url: url, caption } : { image_url: url, caption };
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      res.json({ success: true, message: "Instagram 발행 요청이 완료됐어요!" });
    } else {
      res.status(500).json({ success: false, error: "Make.com 오류: " + await response.text() });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/generate", upload.array("images", 10), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ success: false, error: "사진을 올려주세요." });

    const imageParts = files.map(file => ({
      inline_data: { mime_type: file.mimetype, data: fs.readFileSync(file.path).toString("base64") }
    }));

    const imageCount = files.length;
    const isMultiple = imageCount > 1;

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const prompt = `당신은 SNS 바이럴 마케팅 전문가입니다. 총 ${imageCount}장의 사진을 분석하여 콘텐츠를 작성하세요.
${isMultiple ? `사진 ${imageCount}장이므로 스토리 있는 콘텐츠로 구성하세요.` : ""}

★ 인스타그램 (각 500자 이상): 감성 스토리텔링형, 정보 큐레이션형(저장 유도), 바이럴 참여형. 각각 해시태그 15개.
★ 쓰레드 (각 300자 이상): 공감형, 정보형, 유머형.
★ 페이스북 (각 600자 이상): 감동 스토리형, 실용 정보형, 커뮤니티형.
★ 당근마켓 (각 400자 이상): 동네 친구형, 신뢰 스토리형, 혜택 강조형.
★ 네이버 블로그 (제목+본문 각 1500자 이상): 상세 리뷰형, 추천 가이드형, 스토리 리뷰형.

아래 JSON 형식으로만 응답하세요:
{"instagram":["문구1","문구2","문구3"],"threads":["문구1","문구2","문구3"],"facebook":["문구1","문구2","문구3"],"daangn":["문구1","문구2","문구3"],"naver":[{"title":"제목1","content":"본문1"},{"title":"제목2","content":"본문2"},{"title":"제목3","content":"본문3"}]}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [...imageParts, { text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 8192,
          temperature: 0.9,
          response_mime_type: "application/json"
        }
      }),
    });

    const data = await response.json();
    console.log("Gemini 응답:", JSON.stringify(data).substring(0, 500));

    if (!data.candidates?.[0]?.content?.parts) {
      return res.status(500).json({ success: false, error: "Gemini 응답 오류: " + JSON.stringify(data).substring(0, 300) });
    }

    const text = data.candidates[0].content.parts
      .filter(p => p.text)
      .map(p => p.text)
      .join("");

    console.log("추출 텍스트:", text.substring(0, 300));

    if (!text) return res.status(500).json({ success: false, error: "응답 텍스트 없음" });

    let result;
    try {
      result = JSON.parse(text);
    } catch (e) {
      const cleaned = text.replace(/```json|```/g, "").trim();
      const match = cleaned.match(/\{[\s\S]*\}/);
      if (!match) return res.status(500).json({ success: false, error: "JSON 없음: " + cleaned.substring(0, 200) });
      try {
        result = JSON.parse(match[0]);
      } catch (e2) {
        return res.status(500).json({ success: false, error: "파싱실패: " + e2.message });
      }
    }

    if (!result.instagram || !result.naver) {
      return res.status(500).json({ success: false, error: "응답 구조 오류: " + JSON.stringify(Object.keys(result)) });
    }

    const filePaths = files.map(f => f.path);
    result.imagePaths = filePaths;
    result.imageCount = imageCount;

    res.json({ success: true, content: result, imagePaths: filePaths });
  } catch (error) {
    console.error("에러:", error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/create-reels", async (req, res) => {
  try {
    const { imagePaths } = req.body;
    if (!imagePaths || imagePaths.length === 0) return res.status(400).json({ success: false, error: "사진이 없습니다." });

    const filename = `reels_${Date.now()}.mp4`;
    const outputPath = path.join(VIDEO_DIR, filename);
    const duration = Math.max(3, Math.floor(15 / imagePaths.length));

    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      imagePaths.forEach(imgPath => command.input(imgPath).inputOptions([`-loop 1`, `-t ${duration}`]));
      command
        .complexFilter([
          imagePaths.map((_, i) =>
            `[${i}:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:black,setsar=1[v${i}]`
          ).join(";") + ";" +
          imagePaths.map((_, i) => `[v${i}]`).join("") + `concat=n=${imagePaths.length}:v=1:a=0[outv]`
        ])
        .outputOptions(["-map [outv]", "-c:v libx264", "-pix_fmt yuv420p", "-r 30"])
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    imagePaths.forEach(p => { try { fs.unlinkSync(p); } catch(e) {} });

    const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
    const videoUrl = process.env.NODE_ENV === "production" ? `${BASE_URL}/video/${filename}` : `/videos/${filename}`;
    res.json({ success: true, videoUrl });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/video/:filename", (req, res) => {
  const filePath = path.join(VIDEO_DIR, req.params.filename);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).json({ error: "파일 없음" });
});

app.listen(PORT, () => console.log("서버 실행 중: http://localhost:" + PORT));
