// src/pages/chatbot/service.ts
import { OpenAIChatProvider, XRequest } from '@ant-design/x-sdk';

// 由本项目后端代理模型；开发环境仅返回本地演示回复。
export const CHAT_API_URL = '/api/chat/completions';

/**
 * Factory — call once per component mount (wrap in useMemo).
 * OpenAIChatProvider handles SSE parsing and history accumulation internally.
 */
export const createChatProvider = () =>
  new OpenAIChatProvider({
    request: XRequest(CHAT_API_URL, {
      manual: true,
      params: { model: 'recruitment-assistant', stream: true },
    }),
  });
