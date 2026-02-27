import OpenAI from "openai";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `You are a brutally honest, funny Gen-Z dating advisor. You will receive two photos: the first is "You" and the second is "Them".

CRITICAL — FACE DETECTION:
- FIRST check if BOTH images contain a clearly visible human face.
- If EITHER image does NOT contain a real human face (e.g. document, animal, object, meme, cartoon, blurry, no person visible), you MUST respond with:
  {"no_face": true, "message": "Upload a real photo of a person, not a [what you see instead]"}
- Only proceed to rating if BOTH images show a real human face.

If both faces are detected, rate each person's attractiveness from 1 to 10 and give a short, savage Gen-Z verdict.

Rules:
- Be funny, use Gen-Z slang (fr, no cap, cooked, rizz, etc.)
- Be honest but not mean-spirited
- Keep verdict under 20 words
- Keep subtitle under 15 words
- Respond ONLY with valid JSON, no markdown, no extra text

Output format when both faces detected:
{"you_score": <number 1-10>, "them_score": <number 1-10>, "verdict": "<max 20 words>", "subtitle": "<max 15 words>"}

Output format when face NOT detected:
{"no_face": true, "message": "<short explanation>"}`;


async function callOpenAI(imageYou, imageThem) {
  const response = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    max_tokens: 120,
    temperature: 0,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          { type: "text", text: "Rate both people and give your verdict." },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageYou}`, detail: "low" },
          },
          {
            type: "image_url",
            image_url: { url: `data:image/jpeg;base64,${imageThem}`, detail: "low" },
          },
        ],
      },
    ],
  });

  const raw = response.choices[0].message.content.trim();
  const parsed = JSON.parse(raw);

  if (parsed.no_face) {
    return { no_face: true, message: parsed.message || "Please upload a real photo of a person" };
  }

  if (
    typeof parsed.you_score !== "number" ||
    typeof parsed.them_score !== "number" ||
    !parsed.verdict
  ) {
    throw new Error("Invalid response shape");
  }

  parsed.you_score = Math.max(1, Math.min(10, Math.round(parsed.you_score)));
  parsed.them_score = Math.max(1, Math.min(10, Math.round(parsed.them_score)));

  return parsed;
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  if (!process.env.OPENAI_API_KEY) {
    return res.status(500).json({ error: "API key not configured" });
  }

  const contentLength = parseInt(req.headers["content-length"] || "0", 10);
  if (contentLength > 2 * 1024 * 1024) {
    return res.status(413).json({ error: "Payload too large" });
  }

  const { imageYou, imageThem } = req.body || {};

  if (!imageYou || !imageThem) {
    return res.status(400).json({ error: "Both images are required" });
  }

  let result;
  let retried = false;

  while (true) {
    try {
      result = await callOpenAI(imageYou, imageThem);
      break;
    } catch (err) {
      if (!retried) {
        retried = true;
        continue;
      }
      console.error("OpenAI call failed after retry:", err.message);
      return res.status(500).json({ error: "Analysis failed, please try again" });
    }
  }

  return res.status(200).json(result);
}
