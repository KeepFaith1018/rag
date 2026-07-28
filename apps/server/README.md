# Linsor AI Server

Linsor AI 的后端服务，基于 NestJS、TypeScript 和 Prisma 构建，为多知识库智能问答系统提供统一 API 与核心业务能力。

后端负责用户认证、知识库协作与权限控制、文档上传及异步处理、混合检索、Agentic RAG 对话、后台管理和系统健康检查。文档经过解析、分块和向量化后写入 Qdrant 与 Elasticsearch；在线问答通过 LangChain、LangGraph 编排检索、生成和质量评估流程，并使用 AG-UI SSE 协议向前端传输流式结果。

主要技术包括 NestJS 11、Prisma 7、MySQL 8、LangChain、LangGraph、Qdrant、Elasticsearch、BullMQ 和 Redis。
