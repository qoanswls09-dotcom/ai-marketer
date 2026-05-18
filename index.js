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

// =============================================
// Instagram 자동 발행
// =============================================
app.post("/publish-instagram", async (req, res) => {
  try {
    const { type, url, caption } = req.body;
    if (!url || !caption) {
      return res.status(400).json({ success: false, error: "url과 caption이 필요합니다." });
    }
    const payload = type === "reel" ? { video_url: url, caption } : { image_url: url, caption };
    const response = await fetch(MAKE_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (response.ok) {
      res.json({ success: true, message: "Instagram 발행 요청이 완료됐어요!" });
    } else {
      const errText = await response.text();
      res.status(500).json({ success: false, error: "Make.com 오류: " + errText });
    }
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// 여러 사진 → AI 콘텐츠 생성
// =============================================
app.post("/generate", upload.array("images", 10), async (req, res) => {
  try {
    const files = req.files;
    if (!files || files.length === 0) {
      return res.status(400).json({ success: false, error: "사진을 올려주세요." });
    }

    const imageParts = files.map(file => ({
      inline_data: {
        mime_type: file.mimetype,
        data: fs.readFileSync(file.path).toString("base64")
      }
    }));

    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;

    const imageCount = files.length;
    const isMultiple = imageCount > 1;

    const prompt = `당신은 SNS 바이럴 마케팅 전문가입니다. 총 ${imageCount}장의 사진을 순서대로 분석하여 각 플랫폼에서 실제 조회수와 저장수가 높은 게시물 패턴을 벤치마킹해서 콘텐츠를 작성해주세요.

${isMultiple ? `사진이 ${imageCount}장이므로 스토리가 있는 콘텐츠로 구성하세요. 블로그는 사진 순서대로 [사진1], [사진2] 등으로 삽입 위치를 표시해주세요.` : ""}

[플랫폼별 고조회수 벤치마킹 가이드]

★ 인스타그램 (각 문구 최소 500자 이상):
- 1번: 감성 스토리텔링형
  * 첫 줄: 강렬한 감성 후킹 문장 (ex: "이걸 보고 눈물이 날 뻔했어요 😢")
  * 2~3줄: 상황/분위기 생생하게 묘사
  * 중간: 개인적인 감정/경험 공유
  * 마지막: 팔로워에게 공감 질문
  * 줄바꿈 많이 사용, 이모지 풍부하게
  * 해시태그 15개 (인기태그+틈새태그 혼합)

- 2번: 정보 큐레이션형 (저장율 높은 패턴)
  * 첫 줄: "저장 필수🔖" "나중에 보려고 저장함" 유도
  * 번호 매긴 꿀팁 5가지 이상
  * 각 팁마다 이모지로 시각적 구분
  * 마지막: "저장하고 친구한테 공유해요"
  * 해시태그 15개

- 3번: 바이럴 참여형
  * 첫 줄: "이 맛 아는 사람 🙋" "공감하면 좋아요"
  * 짧은 문장 반복으로 리듬감
  * 태그 유도 ("이거 같이 오고 싶은 사람 태그!")
  * 해시태그 15개

★ 쓰레드 (각 문구 최소 300자 이상):
- 1번: 진솔한 공감형
  * "솔직히 말하면..." 으로 시작
  * 자영업자/직장인 공감 스토리
  * 댓글 달고 싶게 만드는 마지막 질문
  * 트위터 말투, 줄바꿈 활용

- 2번: 정보 폭탄형
  * "아무도 안 알려주는 꿀팁" 식 제목
  * 핵심 정보를 짧게 나열
  * "이거 진짜임" "실화임" 등 신뢰감 어투
  * 리포스트하고 싶은 내용

- 3번: 유머/밈형
  * 트렌디한 밈이나 유행어 활용
  * 공감되는 상황 유머러스하게 묘사
  * 답글 달고 싶은 열린 질문으로 마무리

★ 페이스북 (각 문구 최소 600자 이상):
- 1번: 감동 스토리텔링형
  * 기승전결 있는 미니 스토리
  * 감동/공감 포인트 중간에 배치
  * "공유하고 싶었어요" 느낌의 따뜻한 마무리
  * 댓글로 경험 나눠달라는 요청

- 2번: 실용 정보형
  * "알고 계셨나요?" 로 시작
  * 번호 매긴 실용 정보 7가지 이상
  * 각 항목 2~3줄 상세 설명
  * "저장해두시면 좋아요" 문구

- 3번: 커뮤니티 참여형
  * 의견 묻는 질문으로 시작
  * 찬반 나뉘는 주제로 댓글 유도
  * 좋아요/공유 자연스럽게 유도
  * 이벤트나 혜택 언급

★ 당근마켓 (각 문구 최소 400자 이상):
- 1번: 동네 친구형
  * "우리 동네 분들께만 알려드려요 🥕"
  * 구체적인 위치/특징 언급
  * 단골 되면 좋은 점 어필
  * 직접 방문 유도

- 2번: 신뢰 스토리형
  * 가게/상품의 진심 스토리
  * 재료/과정에 대한 진정성
  * 후기나 단골 언급
  * 부담없이 연락해달라는 마무리

- 3번: 혜택 강조형
  * 오늘의 특별 혜택이나 이벤트
  * 구체적인 가격/수량 언급
  * 긴급성 부여 ("오늘만!", "선착순!")
  * 댓글/채팅 문의 유도

★ 네이버 블로그 (각 문구 제목+본문 최소 1500자 이상):
${isMultiple ? "사진 삽입 위치를 [사진1], [사진2] 등으로 표시하고 각 사진 전후에 관련 설명을 충분히 작성하세요." : ""}

- 1번: 상세 리뷰형
  * 제목: "직접 먹어본 솔직 후기 + 재방문 의사" 식 SEO 제목
  * 도입: 방문 계기와 첫인상 (200자)
  * 메뉴/상품 상세 설명 (400자)
  * 맛/품질/분위기 세부 묘사 (400자)
  * 가격 대비 만족도 (200자)
  * 재방문 의사와 추천 대상 (200자)
  * SEO 키워드 자연스럽게 10개 이상 삽입
  * 마무리 방문 정보 안내

- 2번: 추천 가이드형
  * 제목: "OO동 데이트/혼밥/가족모임 추천 맛집" 식 제목
  * 도입: 어떤 상황에 어울리는지 (150자)
  * 추천 이유 5가지 상세히 (600자)
  * 메뉴 추천과 주문 팁 (300자)
  * 실용 정보: 위치/주차/영업시간 안내 (200자)
  * 방문 전 알아두면 좋은 점 (200자)

- 3번: 스토리 리뷰형
  * 제목: "우연히 발견한 숨은 맛집" 식 스토리 제목
  * 발견 스토리와 첫인상 (300자)
  * 주문 과정과 기대감 묘사 (200자)
  * 먹는 순간 감동 묘사 (400자)
  * 함께한 사람과의 추억 (200자)
  * 다음에 꼭 다시 오고 싶은 이유 (200자)

반드시 아래 JSON 형식으로만 응답하세요. 마크다운 코드블록 없이 순수 JSON만 출력하세요. 줄바꿈은 \\n으로 표현하세요:
{"instagram":["문구1","문구2","문구3"],"threads":["문구1","문구2","문구3"],"facebook":["문구1","문구2","문구3"],"daangn":["문구1","문구2","문구3"],"naver":[{"title":"제목1","content":"본문1"},{"title":"제목2","content":"본문2"},{"title":"제목3","content":"본문3"}]}`;

    const response = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [...imageParts, { text: prompt }] }],
        generationConfig: { maxOutputTokens: 8192, temperature: 0.9 }
      }),
    });

    const data = await response.json();
    console.log("API 응답:", JSON.stringify(data).substring(0, 300));

    if (!data.candidates || !data.candidates[0]) {
      return res.status(500).json({ success: false, error: JSON.stringify(data) });
    }

    // thinking 모드 대응: text가 있는 parts만 합치기
    const text = data.candidates[0].content.parts
      .filter(p => p.text)
      .map(p => p.text)
      .join("");

    // 코드블록 제거
    const cleaned = text.replace(/```json|```/g, "").trim();

    // JSON 시작 위치 찾기
    const jsonStart = cleaned.indexOf('{"instagram"');
    const jsonStr = jsonStart >= 0 ? cleaned.slice(jsonStart) : cleaned;

    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(500).json({ success: false, error: "JSON 파싱 실패: " + cleaned.substring(0, 200) });
    }

    const result = JSON.parse(jsonMatch[0]);
    const filePaths = files.map(f => f.path);
    result.imagePaths = filePaths;
    result.imageCount = imageCount;

    res.json({ success: true, content: result, imagePaths: filePaths });
  } catch (error) {
    console.error("에러:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// =============================================
// 릴스 영상 생성
// =============================================
app.post("/create-reels", async (req, res) => {
  try {
    const { imagePaths, caption } = req.body;
    if (!imagePaths || imagePaths.length === 0) {
      return res.status(400).json({ success: false, error: "사진이 없습니다." });
    }

    const filename = `reels_${Date.now()}.mp4`;
    const outputPath = path.join(VIDEO_DIR, filename);
    const duration = Math.max(3, Math.floor(15 / imagePaths.length));

    await new Promise((resolve, reject) => {
      const command = ffmpeg();
      imagePaths.forEach(imgPath => {
        command.input(imgPath).inputOptions([`-loop 1`, `-t ${duration}`]);
      });
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
    const videoUrl = process.env.NODE_ENV === "production"
      ? `${BASE_URL}/video/${filename}`
      : `/videos/${filename}`;

    res.json({ success: true, videoUrl });
  } catch (error) {
    console.error("릴스 오류:", error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 배포 환경에서 /tmp/videos 파일 서빙
app.get("/video/:filename", (req, res) => {
  const filePath = path.join(VIDEO_DIR, req.params.filename);
  if (fs.existsSync(filePath)) {
    res.sendFile(filePath);
  } else {
    res.status(404).json({ error: "파일을 찾을 수 없습니다." });
  }
});

app.listen(PORT, () => {
  console.log("서버 실행 중: http://localhost:" + PORT);
});
