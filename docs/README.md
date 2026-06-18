# Linsor AI 项目文档索引

## 01-requirements — 需求分析

- [需求分析报告](01-requirements/需求分析报告.md)

## 02-architecture — 架构设计

- [可行性分析](02-architecture/可行性分析.md)
- [后端基础设施](02-architecture/后端基础设施.md)
- [数据库设计](02-architecture/数据库设计.md)

## 03-design — 详细设计

### RAG 模块

- [RAG 模块详细设计](03-design/rag/RAG模块详细设计.md)
- [Elasticsearch 混合检索设计](03-design/rag/Elasticsearch混合检索设计.md)
- [传统 RAG 痛点与本项目优化演进](03-design/rag/传统RAG痛点与本项目优化演进.md)
- [文档处理架构设计](03-design/rag/RAG文档处理架构设计.md)
- [文档处理详细设计](03-design/rag/RAG文档处理详细设计.md)

### 对话模块

- [对话模块详细设计](03-design/chat/对话模块详细设计.md)
- [AgenticRAG 详细设计](03-design/chat/AgenticRAG详细设计.md)
- [多智能体编排逻辑优化设计](03-design/chat/多智能体编排逻辑优化设计.md)

### 上传模块

- [分片上传断点续传方案](03-design/upload/分片上传断点续传方案.md)
- [上传跟进待办](03-design/upload/上传跟进待办.md)

### 实施总结

- [AgenticRAG 实施总结](03-design/AgenticRAG实施总结.md)

## 04-changes — 变更与优化记录

### RAG 全链路优化

- [优化概览](04-changes/rag-pipeline-optimization/README.md)
- [阶段一：修复 + 性能](04-changes/rag-pipeline-optimization/phase-1-fixes.md)
- [阶段二：自校正闭环](04-changes/rag-pipeline-optimization/phase-2-self-correction.md)
- [阶段三：代码质量](04-changes/rag-pipeline-optimization/phase-3-quality.md)
- [阶段四：验收测试](04-changes/rag-pipeline-optimization/phase-4-verification.md)
- [RAGAS 评估方案](04-changes/rag-pipeline-optimization/RAGAS评估方案.md)
- [提示词优化方案](04-changes/rag-pipeline-optimization/提示词优化方案.md)

### 前端优化

- [优化概览](04-changes/frontend-optimization/README.md)
- [技术栈与文件结构分析](04-changes/frontend-optimization/技术栈与文件结构分析.md)
- [优化建议与方案](04-changes/frontend-optimization/优化建议与方案.md)
- [流式渲染技术选型](04-changes/frontend-optimization/流式渲染技术选型.md)
- [Shiki 迁移实施记录](04-changes/frontend-optimization/Shiki迁移实施记录.md)
- [流式渲染业界调研](04-changes/frontend-optimization/流式渲染业界调研.md)

### 测试数据

- [测试数据集](04-changes/测试数据/)

## 05-assets — 设计资产

- [Kinetic Blueprint 设计规范](05-assets/DESIGN.md)
- [UI 界面设计计划](05-assets/UI界面设计计划.md)
- [页面 Mockups](05-assets/) — HTML 静态稿 + 截图

## 06-reference — 参考资料

- [大语言模型概述](06-reference/01-大语言模型概述.md)
- [RAG 技术原理与架构](06-reference/02-RAG技术原理与架构.md)
- [向量数据库与检索技术](06-reference/03-向量数据库与检索技术.md)
- [RAG 优化实践与调优](06-reference/04-RAG优化实践与调优.md)
- [RAG 与 LangGraph 最佳实践分析](06-reference/RAG与LangGraph最佳实践分析.md)
- [RAG 自校正闭环评估报告](06-reference/RAG自校正闭环评估报告.md)
- [对话数据流全链路分析](06-reference/对话数据流全链路分析.md)

## 应用文档

- [前端文档](../apps/web/docs/)
- [后端文档](../apps/server/docs/)
