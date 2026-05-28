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

// ✅ 핵심 수정: 훨씬 강력한 JSON 파서
function robustParseJSON(text) {
  // 1단계: 마크다운 코드블록 제거
  let cleaned = text.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();

  // 2단계: JSON 시작/끝 찾기
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) {
    console.error("❌ JSON 괄호 없음. 텍스트 앞부분:", cleaned.substring(0, 200));
    return null;
  }
  let jsonStr = cleaned.slice(start, end + 1);

  // 3단계: 직접 파싱 시도
  try {
    const parsed = JSON.parse(jsonStr);
    console.log("✅ JSON 직접 파싱 성공");
    return parsed;
  } catch (e) {
    console.log("⚠️ 직접 파싱 실패, 수동 추출 시도:", e.message);
  }

  // 4단계: 키별 수동 추출
  try {
    const result = {
      instagram: extractArray(jsonStr, "instagram"),
      threads: extractArray(jsonStr, "threads"),
      facebook: extractArray(jsonStr, "facebook"),
      daangn: extractArray(jsonStr, "daangn"),
      naver: extractNaverArray(jsonStr),
    };

    // 부분적으로라도 성공하면 반환 (null인 키는 기본값으로)
    const keys = ["instagram", "threads", "facebook", "daangn", "naver"];
    let successCount = 0;
    for (const key of keys) {
      if (result[key] && result[key].length > 0) {
        successCount++;
      } else {
        // null 대신 기본값 설정
        result[key] = key === "naver"
          ? [{ title: "콘텐츠 생성 중 오류", content: "다시 시도해주세요." }]
          : ["콘텐츠 생성 중 오류가 발생했습니다. 다시 시도해주세요."];
        console.warn(`⚠️ ${key} 추출 실패, 기본값 사용`);
      }
    }
    console.log(`✅ 수동 추출 완료: ${successCount}/${keys.length}개 성공`);
    return result;
  } catch (e) {
    console.error("❌ 수동 추출도 실패:", e.message);
    return null;
  }
}

function extractArray(jsonStr, key) {
  try {
    const keyPattern = new RegExp(`"${key}"\\s*:\\s*\\[`, "g");
    const match = keyPattern.exec(jsonStr);
    if (!match) return null;
    const arrayStart = match.index + match[0].length;
    let depth = 1, i = arrayStart;
    while (i < jsonStr.length && depth > 0) {
      if (jsonStr[i] === "[") depth++;
      else if (jsonStr[i] === "]") depth--;
      i++;
    }
    return extractStrings(jsonStr.slice(arrayStart, i - 1));
  } catch (e) {
    console.error(`extractArray(${key}) 오류:`, e.message);
    return null;
  }
}

function extractStrings(content) {
  const items = [];
  let i = 0;
  while (i < content.length) {
    if (content[i] === '"') {
      i++;
      let str = "";
      while (i < content.length) {
        if (content[i] === "\\" && i + 1 < content.length) {
          str += content[i] + content[i + 1];
          i += 2;
        } else if (content[i] === "\n") {
          str += "\\n";
          i++;
        } else if (content[i] === "\r") {
          i++;
        } else if (content[i] === '"') {
          let j = i + 1;
          while (j < content.length && (content[j] === " " || content[j] === "\n" || content[j] === "\r")) j++;
          if (j >= content.length || content[j] === "," || content[j] === "]" || content[j] === "}") {
            i++;
            break;
          } else {
            str += '\\"';
            i++;
          }
        } else {
          str += content[i];
          i++;
        }
      }
      if (str.length > 0) items.push(str);
    } else {
      i++;
    }
  }
  return items.length > 0 ? items : null;
}

function extractNaverArray(jsonStr) {
  try {
    const keyPattern = /"naver"\s*:\s*\[/g;
    const match = keyPattern.exec(jsonStr);
    if (!match) return null;
    const arrayStart = match.index + match[0].length;
    let depth = 1, i = arrayStart;
    while (i < jsonStr.length && depth > 0) {
      if (jsonStr[i] === "[") depth++;
      else if (jsonStr[i] === "]") depth--;
      i++;
    }
    const arrayContent = jsonStr.slice(arrayStart, i - 1);
    const items = [];
    let objStart = -1, objDepth = 0;
    for (let j = 0; j < arrayContent.length; j++) {
      if (arrayContent[j] === "{") {
        if (objDepth === 0) objStart = j;
        objDepth++;
      } else if (arrayContent[j] === "}") {
        objDepth--;
        if (objDepth === 0 && objStart !== -1) {
          const objStr = arrayContent.slice(objStart, j + 1);
          const title = extractStringValue(objStr, "title");
          const content = extractStringValue(objStr, "content");
          if (title && content) items.push({ title, content });
          objStart = -1;
        }
      }
    }
    return items.length > 0 ? items : null;
  } catch (e) {
    console.error("extractNaverArray 오류:", e.message);
    return null;
  }
}

function extractStringValue(objStr, key) {
  try {
    const keyPattern = new RegExp(`"${key}"\\s*:\\s*"`);
    const match = keyPattern.exec(objStr);
    if (!match) return null;
    let str = "", i = match.index + match[0].length;
    while (i < objStr.length) {
      if (objStr[i] === "\\" && i + 1 < objStr.length) {
        str += objStr[i] + objStr[i + 1];
        i += 2;
      } else if (objStr[i] === "\n") {
        str += "\\n";
        i++;
      } else if (objStr[i] === "\r") {
        i++;
      } else if (objStr[i] === '"') {
        let j = i + 1;
        while (j < objStr.length && (objStr[j] === " " || objStr[j] === "\n" || objStr[j] === "\r")) j++;
        if (j >= objStr.length || objStr[j] === "," || objStr[j] === "}") break;
        else { str += '\\"'; i++; }
      } else {
        str += objStr[i];
        i++;
      }
    }
    return str.length > 0 ? str : null;
  } catch (e) {
    return null;
  }
}

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
    if (response.ok) res.json({ success: true, message: "Instagram 발행 요청이 완료됐어요!" });
    else res.status(500).json({ success: false, error: "Make.com 오류: " + await response.text() });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.post("/generate", upload.array("images", 10), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) return res.status(400).json({ success: false, error: "사진을 올려주세요." });

    // ✅ API 키 확인
    if (!process.env.GEMINI_API_KEY) {
      console.error("❌ GEMINI_API_KEY가 설정되지 않았습니다!");
      return res.status(500).json({ success: false, error: "서버 설정 오류: API 키 없음" });
    }

    const imageParts = files.map((file) => ({
      inline_data: {
        mime_type: file.mimetype,
        data: fs.readFileSync(file.path).toString("base64"),
      },
    }));

    const imageCount = files.length;
    const isMultiple = imageCount > 1;

    const storeName = req.body.storeName || "";
    const storeType = req.body.storeType || "";
    const storeLocation = req.body.storeLocation || "";
    const storePrice = req.body.storePrice || "";
    const storeFeature = req.body.storeFeature || "";
    const context = req.body.context || "";
    const tone = req.body.tone || "활기차고 에너제틱하게";

    const profileSection =
      storeName || storeType || storeLocation || storeFeature
        ? `[매장 정보]\n${storeName ? `- 매장명: ${storeName}\n` : ""}${storeType ? `- 업종/메뉴: ${storeType}\n` : ""}${storeLocation ? `- 위치: ${storeLocation}\n` : ""}${storePrice ? `- 가격대: ${storePrice}\n` : ""}${storeFeature ? `- 우리 매장 특징/강점: ${storeFeature}\n` : ""}`
        : "";

    const contextSection = context ? `[오늘의 포인트 - 반드시 반영하세요]\n${context}` : "";

    // ✅ 핵심 수정: 모델명 명시 + thinking 비활성화로 JSON 안정성 향상
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const prompt = `당신은 SNS 바이럴 마케팅 전문가입니다. 총 ${imageCount}장의 사진을 분석하여 자영업자의 매장 홍보 콘텐츠를 작성하세요.
${isMultiple ? `사진 ${imageCount}장이므로 스토리 있는 콘텐츠로 구성하세요.` : ""}

[톤/분위기]
${tone}으로 작성해주세요.

${profileSection}
${contextSection}

★ 인스타그램 (각 500자 이상): 감성 스토리텔링형, 정보 큐레이션형(저장 유도), 바이럴 참여형. 각각 해시태그 15개.
★ 쓰레드 (각 300자 이상): 공감형, 정보형, 유머형.
★ 페이스북 (각 600자 이상): 감동 스토리형, 실용 정보형, 커뮤니티형.
★ 당근마켓 (각 400자 이상): 동네 친구형, 신뢰 스토리형, 혜택 강조형.
★ 네이버 블로그 (제목+본문 각 1500자 이상): 상세 리뷰형, 추천 가이드형, 스토리 리뷰형.

[중요 규칙]
- 문구 안에 큰따옴표(") 절대 사용 금지. 인용은 작은따옴표(')만 사용.
- 백슬래시(\) 사용 금지.
- 반드시 아래 JSON 형식으로만 응답. 앞뒤 설명 없이 JSON만 출력.

{"instagram":["문구1","문구2","문구3"],"threads":["문구1","문구2","문구3"],"facebook":["문구1","문구2","문구3"],"daangn":["문구1","문구2","문구3"],"naver":[{"title":"제목1","content":"본문1"},{"title":"제목2","content":"본문2"},{"title":"제목3","content":"본문3"}]}`;

    console.log("🚀 Gemini API 호출 시작...");

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [...imageParts, { text: prompt }] }],
        generationConfig: {
          maxOutputTokens: 16384,
          temperature: 0.9,
          // ✅ thinking 비활성화 → JSON 파싱 안정성 대폭 향상
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("❌ Gemini API HTTP 오류:", response.status, errText);
      return res.status(500).json({ success: false, error: `Gemini API 오류 (${response.status}): ${errText.substring(0, 200)}` });
    }

    const data = await response.json();
    console.log("📦 Gemini 응답 구조:", JSON.stringify(data).substring(0, 300));

    // ✅ 안전한 응답 확인
    if (data.error) {
      console.error("❌ Gemini 에러 응답:", data.error);
      return res.status(500).json({ success: false, error: "Gemini 오류: " + JSON.stringify(data.error) });
    }

    if (!data.candidates || data.candidates.length === 0) {
      console.error("❌ candidates 없음:", JSON.stringify(data).substring(0, 300));
      return res.status(500).json({ success: false, error: "Gemini 응답 없음 (candidates 비어있음)" });
    }

    if (!data.candidates[0]?.content?.parts) {
      console.error("❌ content.parts 없음. finishReason:", data.candidates[0]?.finishReason);
      return res.status(500).json({
        success: false,
        error: `Gemini 응답 구조 오류. finishReason: ${data.candidates[0]?.finishReason || "unknown"}`,
      });
    }

    const text = data.candidates[0].content.parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("");

    console.log("📝 추출 텍스트 길이:", text.length, "| 앞부분:", text.substring(0, 150));

    if (!text || text.trim().length === 0) {
      return res.status(500).json({ success: false, error: "Gemini 응답 텍스트가 비어있습니다." });
    }

    const result = robustParseJSON(text);
    if (!result) {
      console.error("❌ 파싱 완전 실패. 원본:", text.substring(0, 500));
      return res.status(500).json({ success: false, error: "JSON 파싱 실패. 원본: " + text.substring(0, 300) });
    }

    const filePaths = files.map((f) => f.path);
    result.imagePaths = filePaths;
    result.imageCount = imageCount;

    console.log("✅ 콘텐츠 생성 완료!");
    res.json({ success: true, content: result, imagePaths: filePaths });
  } catch (error) {
    console.error("❌ /generate 처리 중 예외 발생:", error);
    res.status(500).json({ success: false, error: error.message || String(error) });
  }
});

app.post("/create-reels", async (req, res) => {
  const tempFiles = [];
  try {
    let { imagePaths } = req.body;
    if (!imagePaths || imagePaths.length === 0)
      return res.status(400).json({ success: false, error: "사진이 없습니다." });

    // ✅ 최대 6장으로 제한 (Railway 메모리 안전선)
    const MAX_PHOTOS = 6;
    if (imagePaths.length > MAX_PHOTOS) {
      console.log(`⚠️ 사진 ${imagePaths.length}장 → ${MAX_PHOTOS}장으로 제한`);
      imagePaths = imagePaths.slice(0, MAX_PHOTOS);
    }

    const filename = `reels_${Date.now()}.mp4`;
    const outputPath = path.join(VIDEO_DIR, filename);
    // 총 15초 분배, 장당 최소 2초 최대 5초
    const duration = Math.min(5, Math.max(2, Math.floor(15 / imagePaths.length)));

    console.log(`🎬 릴스 생성 시작: ${imagePaths.length}장 × ${duration}초`);

    // 1단계: 사진 1장씩 순차적으로 480x854 클립 변환 (메모리 최소화)
    const clipPaths = [];
    for (let i = 0; i < imagePaths.length; i++) {
      const clipPath = path.join(VIDEO_DIR, `clip_${Date.now()}_${i}.mp4`);
      tempFiles.push(clipPath);
      clipPaths.push(clipPath);

      await new Promise((resolve, reject) => {
        ffmpeg(imagePaths[i])
          .inputOptions(["-loop 1", `-t ${duration}`])
          .videoFilters([
            // ✅ 480x854 (9:16) - 720p 대비 메모리 절반
            "scale=480:854:force_original_aspect_ratio=decrease",
            "pad=480:854:(ow-iw)/2:(oh-ih)/2:black",
            "setsar=1",
          ])
          .outputOptions([
            "-c:v libx264",
            "-preset ultrafast",  // 인코딩 속도 최우선
            "-crf 30",            // 압축률 높임 (용량↓ 메모리↓)
            "-pix_fmt yuv420p",
            "-r 20",              // 20fps (메모리↓)
            "-threads 1",         // 단일 스레드
            "-an",
          ])
          .output(clipPath)
          .on("end", resolve)
          .on("error", reject)
          .run();
      });
      console.log(`  ✅ 클립 ${i + 1}/${imagePaths.length} 완료`);
    }

    // 2단계: concat demuxer로 이어붙이기 (재인코딩 없음 → 메모리 거의 0)
    const concatListPath = path.join(VIDEO_DIR, `concat_${Date.now()}.txt`);
    tempFiles.push(concatListPath);
    fs.writeFileSync(concatListPath, clipPaths.map((p) => `file '${p}'`).join("\n"));

    await new Promise((resolve, reject) => {
      ffmpeg()
        .input(concatListPath)
        .inputOptions(["-f concat", "-safe 0"])
        .outputOptions(["-c copy", "-threads 1"])
        .output(outputPath)
        .on("end", resolve)
        .on("error", reject)
        .run();
    });

    console.log("✅ 릴스 영상 완성!");

    // 임시 파일 정리
    tempFiles.forEach((p) => { try { fs.unlinkSync(p); } catch (e) {} });
    imagePaths.forEach((p) => { try { fs.unlinkSync(p); } catch (e) {} });

    const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;
    const videoUrl = process.env.NODE_ENV === "production"
      ? `${BASE_URL}/video/${filename}`
      : `/videos/${filename}`;

    res.json({
      success: true,
      videoUrl,
      // 장수 제한 시 프론트에 알림
      message: imagePaths.length < req.body.imagePaths?.length
        ? `앞 ${MAX_PHOTOS}장으로 영상을 만들었어요 (서버 제한)`
        : null,
    });
  } catch (error) {
    tempFiles.forEach((p) => { try { fs.unlinkSync(p); } catch (e) {} });
    console.error("❌ 릴스 생성 오류:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get("/image/:filename", (req, res) => {
  const filePath = path.join(UPLOAD_DIR, req.params.filename);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).json({ error: "파일 없음" });
});

app.get("/video/:filename", (req, res) => {
  const filePath = path.join(VIDEO_DIR, req.params.filename);
  if (fs.existsSync(filePath)) res.sendFile(filePath);
  else res.status(404).json({ error: "파일 없음" });
});

app.listen(PORT, () => console.log("✅ 서버 실행 중: http://localhost:" + PORT));
