# 3d-agents

浏览器里的实时 3D 数字人 —— **Stage 4：开口就能聊**。

用 Three.js 实时渲染的 VRM 数字人，会看着你、眨眼呼吸，说话时口型跟着音频走。
现在链路是完整的语音对话：

```
麦克风 → Silero 式本地 VAD → Fun-ASR 实时识别 → DeepSeek → 百炼 TTS → 口型
```

![预览](docs/preview.png)

## 快速开始

```bash
cp .env.example .env      # 填两把 Key：百炼（TTS/ASR）+ DeepSeek（对话）
npm install
npm run dev               # http://127.0.0.1:5288
```

`.env` 最小配置：

```bash
DASHSCOPE_API_KEY=sk-...                 # 百炼：语音合成 + 语音识别
OPENAI_API_KEY=sk-...                    # DeepSeek：对话
OPENAI_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-flash
```

用麦克风之前记得给浏览器**授权**；任何一边 Key 缺失都会自动降级（缺 ASR 就只能打字，
缺 TTS 用浏览器合成，缺 LLM 用本地关键词回复），页面右下角会显示当前实际链路。

```bash
npm run build     # tsc 类型检查 + 生产构建
npm run preview   # 预览构建产物（没有代理，会自动回落本地模式）
```

## 架构

```
浏览器
 ├─ three.js / three-vrm        渲染、骨骼、表情
 ├─ MicAsr                      getUserMedia → 降采样 16k → RMS VAD → PCM
 ├─ CloudTts                    WebAudio 播放 + 口型时钟（TTS 时间戳）
 └─ ws /api/asr · ws /api/tts · fetch /api/chat
        ↕
Vite 插件（本地代理，Key 只在这里）
 ├─ server/asrPlugin.ts         → 百炼 Fun-ASR 实时识别
 ├─ server/ttsPlugin.ts         → 百炼 Qwen-Audio-TTS（PCM + 字级时间戳）
 └─ server/llmPlugin.ts         → api.deepseek.com（SSE 透传）
```

## 关键实现（也是踩过的坑）

**1. 口型认音频时钟，不认字符数。**
`AudioContext.currentTime - anchor` 是唯一时间源，口型事件和音频共用它。

**2. `begin_time` 是相对整个任务的，不是相对句子的。**
按「句子起点 + begin_time」算，第二句口型会晚好几秒。

**3. `sentence-begin` 的 words 是残缺的，`sentence-end` 才是全量。**
两个都转发（`phase` 区分），前端用 `Map<index, events>` 覆盖。

**4. 关掉 DeepSeek 的 thinking，首字快 600ms。**
`deepseek-flash` 默认先吐 `reasoning_content`；请求里加 `thinking: { type: 'disabled' }`
后首字从 ~1.05s 降到 ~0.45s。

**5. 回合判定放在本地，不交给服务端。**
ASR 自带的 VAD 只负责断句；「你有没有说完」由浏览器按 `VAD_SILENCE_MS` 判断，
这样才能控制打断、也方便调手感。

**6. 保留 400ms 预滚，别吞第一个字。**
检测到说话时，把说话前缓存的音频一起发过去；注意别把当前块再发一遍（会变成「你好好」）。

**7. 打断要防回声。**
TTS 播放时把 VAD 门限抬高 2.5 倍、要求持续 4 帧才触发，否则她会把自己的声音当成你在说话。

**8. ASR 词表提升专有名词。**
`ASR_CONTEXT=小岚` 会作为领域词表传给 Fun-ASR，实测能把「小兰/小蓝」纠正成「小岚」。

## 可调参数（都在 .env）

| 变量 | 默认 | 说明 |
|---|---|---|
| `ASR_MODEL` | `fun-asr-realtime` | 实时识别模型 |
| `ASR_SAMPLE_RATE` | `16000` | 送进 ASR 的采样率 |
| `ASR_CONTEXT` | `小岚` | 领域词表，帮专有名词识别 |
| `VAD_THRESHOLD` | `0.02` | RMS 门限。安静房间 0.02；吵就调高 |
| `VAD_SILENCE_MS` | `700` | 静音多久算说完。400 灵敏，800 从容 |
| `DASHSCOPE_TTS_MODEL` | `qwen-audio-3.1-tts-flash` | 语音合成模型 |
| `DASHSCOPE_TTS_VOICE` | `longanhuan_v3.1` | 音色 |

## 目录

```
src/
  avatar/            # 渲染、骨骼、每帧动作
  speech/
    MicAsr.ts        # 麦克风 + VAD + ASR 会话
    CloudTts.ts      # TTS：PCM 排队 + 口型时钟
    SpeechController.ts  # 本地回落
    visemes.ts       # 韵母/时间戳 → 口型
  chat/
    llm.ts           # SSE 解析 + 文本清洗
    mockBrain.ts     # 无 LLM 时兜底
  components/ChatPanel.tsx
server/
  asrPlugin.ts · ttsPlugin.ts · llmPlugin.ts
public/models/sample.vrm
```

## 成本

| 项目 | 单价 | 说明 |
|---|---|---|
| ASR `fun-asr-realtime` | 0.00033 元/秒 ≈ **1.2 元/小时** | 按音频时长，静音段不送就不计费 |
| TTS `qwen-audio-3.1-tts-flash` | 约 1 元/万字符 | 一条 50 字回复约 0.005 元 |
| LLM `deepseek-flash` | 按 token | 一条回复不到 0.001 元 |

每天聊 10 分钟，一个月 10 块钱上下。

## 排错

| 现象 | 原因 |
|---|---|
| 点了麦克风没反应 | 浏览器没授权 / 非 localhost 或 https（getUserMedia 限制） |
| 一直「聆听中」不出字 | `VAD_THRESHOLD` 太高，或麦克风增益太低 |
| 她说话时老是自我打断 | 外放回声，戴耳机；或把 `VAD_THRESHOLD` 调高 |
| 识别把名字听错 | 改 `ASR_CONTEXT` 里的词表 |
| `模型没接上` | DeepSeek Key/模型名/Base URL（要带 `/v1`） |
| `语音服务：上游连接失败` | 百炼 Key、是否开通语音合成、地域是否匹配 |

## 已知限制

- 外放时回声仍然会影响打断，**建议戴耳机**演示。
- 每句话单独开一个 ASR 任务，句间有 ~100ms 的连接开销。
- 麦克风采集用了 `ScriptProcessorNode`（已废弃但兼容性最好），生产建议换 AudioWorklet。
- 口型是 5 个元音的近似；写实资产需要 ARKit 52 形状。
- 没有后处理、次表面散射、毛发物理 —— 真实感受资产与光照上限。

## 下一步

- 表情/手势：LLM 输出情绪标签 → 映射 expression + 预置动作
- 写实资产（MetaHuman / CC4）+ TSL 皮肤 + 后处理
- 多轮打断优化：VAD + 语义端点（semantic endpointing）

## 模型授权

`public/models/sample.vrm` 来自 [pixiv/three-vrm](https://github.com/pixiv/three-vrm) 官方示例，
版权 (c) 2022 pixiv Inc.，VRM 1.0 元数据允许再分发与商用。换模型前请先读该模型的 VRM 许可证。
