import { ErrorCode } from "./errorCodeMap";

export const ErrorMessageMap: Record<ErrorCode, string> = {
  [ErrorCode.SUCCESS]: '成功',

  // 通用
  [ErrorCode.PARAM_ERROR]: '参数错误',
  [ErrorCode.UNAUTHORIZED]: '未登录',
  [ErrorCode.UNAUTHORIZED_EXPIRED]: '登录已过期',
  [ErrorCode.FORBIDDEN]: '无权限访问',
  [ErrorCode.NOT_FOUND]: '资源不存在',

  [ErrorCode.INTERNAL_ERROR]: '服务器内部错误',
  [ErrorCode.SERVICE_UNAVAILABLE]: '服务暂不可用，请稍后重试',

  // 知识库
  [ErrorCode.KNOWLEDGE_NOT_FOUND]: '知识库不存在',
  [ErrorCode.KNOWLEDGE_UNAUTHORIZED]: '无权限访问该知识库',
  [ErrorCode.KNOWLEDGE_NOT_SHARED]: '该知识库未对你共享',
  [ErrorCode.KNOWLEDGE_HAS_JOINED]: '你已加入该知识库',
  [ErrorCode.KNOWLEDGE_HAS_OWNED]: '你已拥有该知识库',
  [ErrorCode.KNOWLEDGE_NOT_JOINED]: '你尚未加入该知识库',

  // 文件
  [ErrorCode.FILE_NOT_FOUND]: '文件不存在',
  [ErrorCode.FILE_UPLOAD_FAILED]: '文件上传失败',
  [ErrorCode.FILE_TYPE_UNSUPPORTED]: '不支持的文件类型',
  [ErrorCode.FILE_TOO_LARGE]: '文件大小超出限制',

  // 会话
  [ErrorCode.CONVERSATION_NOT_FOUND]: '会话不存在',
  [ErrorCode.CONVERSATION_UNAUTHORIZED]: '无权限访问该会话',
  [ErrorCode.CONVERSATION_CLOSED]: '会话已关闭',

  // 消息
  [ErrorCode.MESSAGE_NOT_FOUND]: '消息不存在',
  [ErrorCode.MESSAGE_UNAUTHORIZED]: '无权限访问该消息',

  // 向量 / RAG
  [ErrorCode.VECTOR_FILE_FAILED]: '向量文件处理失败',
  [ErrorCode.VECTOR_FILE_UNSUPPORTED]: '向量文件类型不支持',
  [ErrorCode.VECTOR_FILE_IMG_EMPTY]: '图片内容为空，无法向量化',
  [ErrorCode.VECTOR_INDEX_FAILED]: '向量索引构建失败',
  [ErrorCode.VECTOR_SEARCH_FAILED]: '向量检索失败',

  [ErrorCode.EMAIL_CODE_PROCESS_FAILED]: '验证码处理失败',
  [ErrorCode.EMAIL_SEND_FAILED]: '验证码邮件发送失败',
  [ErrorCode.EMAIL_CODE_INVALID]: '验证码错误或已失效',
  [ErrorCode.EMAIL_CONFIG_INVALID]: '邮件服务配置错误',
  [ErrorCode.EMAIL_RATE_LIMIT]: '请求过于频繁，请稍后再试',

  // 认证
  [ErrorCode.AUTH_INVALID_CREDENTIALS]: '账号或密码错误',
  [ErrorCode.AUTH_USER_EXISTS]: '用户已存在',
  [ErrorCode.AUTH_USER_NOT_FOUND]: '用户不存在',
  [ErrorCode.AUTH_INVALID_REFRESH_TOKEN]: '刷新令牌无效',
}
