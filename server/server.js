import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";

dotenv.config();

const app = express();

const PORT = process.env.PORT || 3000;

app.use(cors());

app.use(express.json());

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: "请求太频繁啦，休息一下再试试 ✨"
  }
});

app.use("/api/decision", limiter);

const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,

  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",

  timeout: 60000,
});

const __filename = fileURLToPath(import.meta.url);

const __dirname = path.dirname(__filename);

const wallPath = path.join(__dirname, "data", "wall.json");

function readWall() {
  if (!fs.existsSync(wallPath)) {
    const dataDir = path.join(__dirname, "data");

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir);
}
    fs.writeFileSync(wallPath, "[]");
  }

  return JSON.parse(fs.readFileSync(wallPath, "utf-8"));
}

function saveWall(data) {
  fs.writeFileSync(wallPath, JSON.stringify(data, null, 2));
}

app.post("/api/decision", async (req, res) => {
  try {
    const { question, mode } = req.body;

    if (!question) {
      return res.status(400).json({
        error: "question required",
      });
    }

    const response = await client.chat.completions.create({

  model: "qwen-turbo",

  messages: [

    {
      role: "system",
      content: `
你是“择光 AI”。

你是一个温柔、有陪伴感、不说教的 AI 决策助手，做出决策，不给折中答案。

要求：

1. 回答自然
2. 不机械
3. 有情绪价值
4. 不要太长
5. 输出 JSON

格式：

{
  "title": "一句标题",
  "text": "详细建议",
  "tags": ["标签1", "标签2", "标签3"]
}
      `
    },

    {
      role: "user",
      content: `
模式：${mode}

用户问题：
${question}
      `
    }

  ],

  temperature: 0.8

});

    console.log(response);

const text =
  response.choices?.[0]?.message?.content || "{}";

let result;

try {
  result = JSON.parse(text);
} catch {
  result = {
    title: "我觉得你已经有答案了 ✨",
    text: text,
    tags: ["温柔建议"]
  };
}

    res.json(result);

  } catch (err) {

  console.error("========= OPENAI ERROR =========");

  console.error(err);

  console.error("message:", err.message);

  console.error("status:", err.status);

  console.error("response:", err.response?.data);

  console.error("================================");

  res.status(500).json({
    error: err.message || "AI failed",
  });
  }
});

app.get("/api/wall/posts", (req, res) => {
  const posts = readWall();

  posts.sort((a, b) => b.createdAt - a.createdAt);

  res.json(posts);
});

app.post("/api/wall/posts", (req, res) => {
  const { content, mode } = req.body;

  if (!content) {
    return res.status(400).json({
      error: "content required",
    });
  }

  const posts = readWall();

  const newPost = {
    id: crypto.randomUUID(),
    content,
    mode,
    likes: 0,
    createdAt: Date.now(),
  };

  posts.unshift(newPost);

  saveWall(posts);

  res.json(newPost);
});

app.post("/api/wall/posts/:id/like", (req, res) => {
  const posts = readWall();

  const target = posts.find((p) => p.id === req.params.id);

  if (!target) {
    return res.status(404).json({
      error: "post not found",
    });
  }

  target.likes++;

  saveWall(posts);

  res.json(target);
});

app.use(express.static(path.join(__dirname, "../public")));

app.listen(PORT, () => {
  console.log(`server running: http://localhost:${PORT}`);
});

process.on("uncaughtException", (err) => {
  console.error("未捕获错误:", err);
});

process.on("unhandledRejection", (err) => {
  console.error("Promise错误:", err);
});