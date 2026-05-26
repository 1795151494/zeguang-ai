import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";
import rateLimit from "express-rate-limit"; // ⚠️ 别忘了安装这个依赖

dotenv.config();

const app = express();

// 允许跨域
app.use(cors());
app.use(express.json());

// 限流中间件（仅作用于 /api/decision）
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: "请求太频繁啦，休息一下再试试 ✨"
  }
});
app.use("/api/decision", limiter);

// 初始化 OpenAI 客户端（DashScope 兼容模式）
const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  timeout: 60000,
});

// ---------- 数据存储（⚠️ 临时内存存储，重启/冷启动会丢失） ----------
// 由于 Vercel Serverless 函数无法持久写入本地文件，
// 这里改用内存数组存储「告白墙」数据。
// 若需要永久存储，请改用 Supabase / MongoDB Atlas / Upstash Redis 等免费云数据库。
let wallPosts = [];

// 辅助函数：读取所有帖子
function readWall() {
  return wallPosts;
}

// 辅助函数：保存帖子（直接修改内存数组）
function saveWall(posts) {
  wallPosts = posts;
}

// ---------- API 路由 ----------
app.post("/api/decision", async (req, res) => {
  try {
    const { question, mode } = req.body;
    if (!question) {
      return res.status(400).json({ error: "question required" });
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
          content: `模式：${mode}\n用户问题：\n${question}`
        }
      ],
      temperature: 0.8
    });

    const text = response.choices?.[0]?.message?.content || "{}";
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
    console.error("AI 接口错误:", err);
    res.status(500).json({ error: err.message || "AI failed" });
  }
});

app.get("/api/wall/posts", (req, res) => {
  const posts = readWall();
  // 按时间倒序
  posts.sort((a, b) => b.createdAt - a.createdAt);
  res.json(posts);
});

app.post("/api/wall/posts", (req, res) => {
  const { content, mode } = req.body;
  if (!content) {
    return res.status(400).json({ error: "content required" });
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
  const target = posts.find(p => p.id === req.params.id);
  if (!target) {
    return res.status(404).json({ error: "post not found" });
  }
  target.likes++;
  saveWall(posts);
  res.json(target);
});

// 注意：不再提供静态文件服务（express.static），
// 因为 Vercel 会通过 vercel.json 中的配置托管 public 目录。

// 导出 Express app 供 Vercel 作为 Serverless Function 使用
export default app;