import type { Request, Response } from 'express';

// 仅由开发服务器加载；不调用外部模型，不保留消息。
export default {
  'POST /api/chat/completions': (_req: Request, res: Response) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.write(
      `data: ${JSON.stringify({
        id: 'local-demo',
        object: 'chat.completion.chunk',
        choices: [{
          index: 0,
          delta: {
            role: 'assistant',
            content: '这是本地演示回复，用于验证 AI 对话组件。尚未连接模型，也未执行任何招聘操作。',
          },
          finish_reason: null,
        }],
      })}\n\n`,
    );
    res.end('data: [DONE]\n\n');
  },
};
