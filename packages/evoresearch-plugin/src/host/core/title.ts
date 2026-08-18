/**
 * 自动命名用的低信息输入判定。
 *
 * 问候、确认、以及「询问助手能做什么」这类提问，不足以作为研究项目/子对话
 * 的命名依据；调用方应继续收集后续输入，而不是立刻让模型凭空命名。
 * 客户端（packages/evoresearch-app/src/client/index.ts 的 lowInformationTitleInput）
 * 需与此处保持同一套规则。
 */
const LOW_INFORMATION_PATTERN =
  /^(你好|您好|嗨|哈喽|hello|hi|hey|谢谢|感谢|好的|好|嗯|嗯嗯|ok|okay|继续|收到|明白|在吗|(你|您)(可以|能|会)?(做|干|有|提供|帮忙)?(什么|啥|哪些|嘛)(事情|工作|功能)?|(你|您)(是|叫)什么|(你|您)是谁|介绍(一下)?(你|这个)?(自己)?|这(是|有)什么(用|意思|功能)?|(你|这)能帮我吗|what can you do|who are you|can you help me|how do you work)[!！?？。,.，、\s]*$/i

/** 输入是否信息量不足（不足以自动命名研究项目/子对话）。 */
export function isLowInformationInput(text: string): boolean {
  return LOW_INFORMATION_PATTERN.test(text.trim())
}
