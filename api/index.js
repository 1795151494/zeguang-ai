import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();

// =========================
// 中间件
// =========================
app.use(cors());
app.use(express.json());

// 限流
const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: "请求太频繁啦，休息一下再试试 ✨"
  }
});

app.use("/api/decision", limiter);

app.use("/api/wall", limiter);

// =========================
// OpenAI / 通义千问
// =========================
const client = new OpenAI({
  apiKey: process.env.DASHSCOPE_API_KEY,
  baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  timeout: 60000,
});

// =========================
// 临时内存数据库
// =========================
let wallPosts = [
  {
    id: "1",
    content: "我该不该辞职",
    reply: "别熬了，先离开再说。",
    likes: 56,
    createdAt: Date.now()
  },

  {
    id: "2",
    content: "今天该不该去见他",
    reply: "去吧，你已经想见很久了。",
    likes: 88,
    createdAt: Date.now()
  },

  {
    id: "3",
    content: "我是不是该早点睡",
    reply: "先睡觉，明天会轻一点。",
    likes: 102,
    createdAt: Date.now()
  }
];

// =========================
// 工具函数
// =========================
function readWall() {
  return wallPosts;
}

function saveWall(posts) {
  wallPosts = posts;
}

app.get("/api/health", (req, res) => {
  res.json({
    ok: true
  });
});

// =========================
// AI 决策接口
// =========================
app.post("/api/decision", async (req, res) => {
  try {
    const { question, mode } = req.body;

    if (!question) {
      return res.status(400).json({
        error: "question required"
      });
    }

   const prompts = {
  quick: `
你要快速帮用户做决定。
直接给答案。
不要分析太多。
语气轻松温柔。
`,

  deep: `
你要更认真分析。
帮助用户权衡利弊。
但仍然保持温柔陪伴感。
`,

  creative: `
你要更有创意。
回答可以有灵感感、浪漫感、脑洞感、尽量给出让人很惊讶的答案
`
};

const modePrompt = prompts[mode] || "";

    const completion = await client.chat.completions.create({
      model: "qwen-turbo",

      messages: [
        {
          role: "system",
          content: `
你是“择光 AI”。

你是一个温柔、有陪伴感、不说教的 AI 决策助手。

你必须真正帮用户做决定。

不要总说：
“你已经有答案了”
“其实你心里知道”

不要敷衍。

不要给模棱两可答案。

${modePrompt}

要求：

1. 回答自然
2. 有情绪价值
3. 不机械
4. 不说教
5. 不要太长
6. 标题有吸引力
7. 一定返回 JSON
8. 不要输出 markdown
9. 不要输出代码块

JSON 格式：

{
  "title": "标题",
  "text": "详细建议",
  "tags": ["标签1","标签2","标签3"]
}
`
        },
        {
          role: "user",
          content: `
用户问题：
${question}
`
        }
      ],

      temperature: 0.9,
    });

    const raw = completion.choices[0].message.content;

    let result;

    try {
      result = JSON.parse(raw);
    } catch {
      result = {
        title: "我替你选好了 ✨",
        text: raw,
        tags: ["AI建议", "温柔决策", "陪伴感"]
      };
    }

    res.json(result);

  } catch (err) {
    console.error("AI 接口错误:", err);

    res.status(500).json({
      error: err.message || "AI failed"
    });
  }
});

// =========================
// 获取告白墙
// =========================
app.get("/api/wall/posts", (req, res) => {

  const posts = readWall();

  posts.sort((a, b) => b.createdAt - a.createdAt);

  // ⚠️ 这里必须转换格式
  // 因为前端 renderWallPosts 用的是:
  // post.text
  // post.reply

  const formatted = posts.map(post => ({
    id: post.id,
    text: post.content,
    reply: post.reply,
    likes: post.likes,
    createdAt: post.createdAt
  }));

  res.json(formatted);
});

// =========================
// 发布告白墙
// =========================
app.post("/api/wall/posts", async (req, res) => {

  try {

    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        error: "content required"
      });
    }

    if (content.length > 200) {
  return res.status(400).json({
    error: "内容太长啦"
  });
}

    // AI 回复
    const completion = await client.chat.completions.create({
      model: "qwen-turbo",

      messages: [
        {
          role: "system",
          content: `
你是“择光 AI”。

用户会说一句正在纠结的话。

你要直接站在其中一个选择上，
轻轻推用户一把。

不要中立。
不要“两边都可以”。
不要“看你自己”。

你像一个温柔、懂情绪的朋友，
会给用户一种：
“她已经帮我做了决定”的感觉。

要求：

1. 必须明确偏向一个答案
2. 不允许折中
3. 不允许分析利弊
4. 不允许说教
5. 不允许鸡汤
6. 不超过40字
7. 语气自然，像真实朋友
8. 有陪伴感和情绪价值

正确示例：

- “今天更适合火锅，热一点会舒服很多。”
- “去见他吧，你其实已经想好了。”
- “先睡觉，明天的你会感谢现在。”
- “别忍了，辞职吧。”

错误示例：

- “看你更在意什么”
- “两个都不错”
- “建议综合考虑”
- “最终还是取决于你”
`
        },
        {
          role: "user",
          content
        }
      ],

      temperature: 0.9,
    });

    const aiReply =
      completion.choices[0].message.content ||
      "别急呀，也许答案会慢慢浮现。";

    const posts = readWall();

    const newPost = {
      id: crypto.randomUUID(),
      content,
      reply: aiReply,
      likes: 0,
      createdAt: Date.now(),
    };

    posts.unshift(newPost);

    saveWall(posts);

    res.json(newPost);

  } catch (err) {

    console.error(err);

    res.status(500).json({
      error: "post failed"
    });
  }
});

// =========================
// 点赞
// =========================
app.post("/api/wall/posts/:id/like", (req, res) => {

  const posts = readWall();

  const target = posts.find(
    p => p.id === req.params.id
  );

  if (!target) {
    return res.status(404).json({
      error: "post not found"
    });
  }

  target.likes++;

  saveWall(posts);

  res.json(target);
});

// =========================
// 导出
// =========================
export default app;