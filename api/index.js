import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import OpenAI from "openai";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST,
  port: parseInt(process.env.PGPORT || '5432'),
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: { rejectUnauthorized: false },
});

dotenv.config();

const app = express();

// =========================
// 中间件
// =========================

app.use(cors());

app.use(express.json());

// =========================
// 限流
// =========================

const limiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: {
    error: "请求太频繁啦，休息一下再试试 ✨",
  },
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
// 测试数据库连接
// =========================

async function testDatabase() {
  try {
    const result = await pool.query("SELECT NOW()");
    console.log("✅ 数据库连接成功");
    console.log(result.rows[0]);
  } catch (err) {
    console.error("❌ 数据库连接失败");
    console.error(err);
  }
}

testDatabase();

// =========================
// AI 决策接口
// =========================

app.post("/api/decision", async (req, res) => {
  try {
    const { question, mode } = req.body;

    if (!question) {
      return res.status(400).json({
        error: "question required",
      });
    }

    const prompts = {
  quick: `
- 直接给答案，30字以内。
- 语气轻松短促，如“选左边！今天就要开心～”
- 不要分析利弊。
`,
  deep: `
- 先一句话列出两个选择的利弊（各一条），然后明确推荐一个。
- 语气温柔但坚定，如“我懂你纠结，但选这个会更好哦”。
`,
  creative: `
- 用一个小比喻、场景或浪漫的脑洞来推动决策。
- 如“像选冰淇淋口味，你心里早就知道想要巧克力啦”。
`,
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

用户会说一句正在纠结的话，或是问一个开放性问题。

你要直接站在其中一个选择上，
轻轻推用户一把，
给用户一个方向。

不要中立。
不要“两边都可以”。
不要“看你自己”。

你像一个温柔、懂情绪的朋友。

${modePrompt}

要求：

1. 回答自然
2. 有情绪价值
3. 不机械
4. 不说教
5. 不要太长
6. 一定返回 JSON
7. 不要 markdown

你必须返回纯 JSON 对象，不要有任何额外文字、注释或 markdown 格式（不要 \`\`\`json 包裹）。JSON 结构如下：

{
  "title": "一句简短有力的标题，概括推荐方向（10字以内）",
  "text": "详细建议（60字以内，有情绪价值，直接说选哪个）",
  "tags": ["关键词1", "关键词2"]   // 从用户问题中提取2个相关标签，如 #纠结 #爱情
}

示例：
用户：要不要辞职去旅行？
输出：{"title":"出发吧！","text":"人生苦短，先去看世界。工作可以再找，青春不会重来。","tags":["旅行","勇气"]}
`,
        },

        {
          role: "user",
          content: question,
        },
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
        tags: ["AI建议", "温柔决策"],
      };
    }

    res.json(result);

  } catch (err) {
    console.error("❌ AI 接口错误");
    console.error(err);

    res.status(500).json({
      error: err.message || "AI failed",
    });
  }
});

// =========================
// 获取匿名墙
// =========================

app.get("/api/wall/posts", async (req, res) => {
  try {

    console.log("📦 开始获取匿名墙");

    const result = await pool.query(`
      SELECT *
      FROM wall_posts
      ORDER BY created_at DESC
    `);

    console.log("✅ 获取成功");

    const formatted = result.rows.map((post) => ({
      id: post.id,
      text: post.content,
      reply: post.reply,
      likes: post.likes,
      createdAt: post.created_at,
    }));

    res.json(formatted);

  } catch (err) {

    console.error("❌ 获取匿名墙失败");
    console.error(err);

    res.status(500).json({
      error: err.message,
      detail: err.detail,
    });
  }
});

// =========================
// 发布匿名墙
// =========================

app.post("/api/wall/posts", async (req, res) => {
  try {

    const { content } = req.body;

    if (!content) {
      return res.status(400).json({
        error: "content required",
      });
    }

    if (content.length > 200) {
      return res.status(400).json({
        error: "内容太长啦",
      });
    }

    // =========================
    // AI 回复
    // =========================

    const completion = await client.chat.completions.create({
      model: "qwen-turbo",

      messages: [
        {
          role: "system",

content: `
你是“择光 AI”。用户写下一句纠结的话，你需要用一句话替用户做决定。

规则：
- 只输出一句话，20~30字，不超过40字。
- 语气温暖、坚定，不要模棱两可。
- 不要说“看你自己”、“两种都可以”。
- 直接给出选择，例如：“去吧，别让犹豫挡住风景。”或“拒绝吧，你的时间值得更好。”

示例：
用户：要不要约他吃饭？
AI：约！主动一点，故事就可能开始。

用户：该不该辞职？
AI：辞。身心健康比任何工作都重要。

用户：周末去爬山还是看电影？
AI：爬山，呼吸新鲜空气对心情更好。

现在请根据用户的问题直接回复。
`,
        },

        {
          role: "user",
          content,
        },
      ],

      temperature: 0.9,
    });

    const aiReply =
      completion.choices[0].message.content ||
      "别急呀，也许答案会慢慢浮现。";

    const newPost = {
      id: crypto.randomUUID(),
      content,
      reply: aiReply,
      likes: 0,
      createdAt: Date.now(),
    };

    console.log("📦 开始写入数据库");

    await pool.query(
      `
      INSERT INTO wall_posts
      (id, content, reply, likes, created_at)
      VALUES ($1, $2, $3, $4, $5)
      `,
      [
        newPost.id,
        newPost.content,
        newPost.reply,
        newPost.likes,
        newPost.createdAt,
      ]
    );

    console.log("✅ 发布成功");

    res.json({
      id: newPost.id,
      text: newPost.content,
      reply: newPost.reply,
      likes: newPost.likes,
      createdAt: newPost.createdAt,
    });

  } catch (err) {

    console.error("❌ 发布失败");
    console.error(err);

    res.status(500).json({
      error: err.message,
      detail: err.detail,
    });
  }
});

// =========================
// 点赞
// =========================

app.post("/api/wall/posts/:id/like", async (req, res) => {
  try {

    const result = await pool.query(
      `
      UPDATE wall_posts
      SET likes = likes + 1
      WHERE id = $1
      RETURNING *
      `,
      [req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: "post not found",
      });
    }

    const post = result.rows[0];

    res.json({
      id: post.id,
      text: post.content,
      reply: post.reply,
      likes: post.likes,
      createdAt: post.created_at,
    });

  } catch (err) {

    console.error("❌ 点赞失败");
    console.error(err);

    res.status(500).json({
      error: err.message,
      detail: err.detail,
    });
  }
});

// =========================
// 健康检查
// =========================

app.get("/", (req, res) => {
  res.json({
    ok: true,
    message: "择光 AI server running ✨",
  });
});

// =========================
// 本地开发启动
// =========================

if (process.env.NODE_ENV !== "production") {

  const PORT = process.env.PORT || 3000;

  app.listen(PORT, () => {
    console.log(`🚀 Server running at http://localhost:${PORT}`);
  });
}

// =========================
// 导出给 Vercel
// =========================

export default app;