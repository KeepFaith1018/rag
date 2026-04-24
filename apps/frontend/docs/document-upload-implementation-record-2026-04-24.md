# 前端文档上传增强实现记录

## 1. 文档说明

本文档用于记录前端“分片上传、断点续传、秒传与 Worker 多线程”方案的实现进度。

当前聚焦目录：

- `apps/frontend/src/modules/document-upload`
- `apps/frontend/src/views/kb/KbDetailView.vue`

## 2. 当前目标

当前前端的首轮目标是：

- 建立上传模块目录结构
- 建立上传 API 封装
- 建立文件切片工具
- 建立哈希 Worker
- 建立上传状态模型
- 建立分片上传 composable
- 将基础上传入口接入知识库详情页

## 3. 当前状态

当前前端现状：

- 已新增独立的文档上传模块目录
- 已新增上传 API 封装
- 已新增文件切片工具
- 已新增哈希 Worker
- 已新增分片上传 composable
- 已将基础上传入口接入知识库详情页

## 4. 任务清单

### 第一轮任务

- [x] 新增 `modules/document-upload/api/upload.api.ts`
- [x] 新增 `modules/document-upload/types/upload.ts`
- [x] 新增 `modules/document-upload/utils/fileChunk.ts`
- [x] 新增 `modules/document-upload/workers/file-hash.worker.ts`
- [x] 新增 `modules/document-upload/composables/useChunkUpload.ts`
- [x] 在 `KbDetailView.vue` 接入上传入口
- [x] 在页面中展示基础上传状态
- [x] 补充必要中文注释

## 5. 当前已完成内容

- [x] 新增上传模块目录 `modules/document-upload/`
- [x] 新增初始化上传、上传分片、完成上传、取消上传 API 封装
- [x] 新增 5MB 分片工具
- [x] 新增基于 `Web Worker` 的 SHA-256 文件哈希计算
- [x] 新增带固定并发控制的分片上传 composable
- [x] 在知识库详情页接入浏览文件、上传进度、取消上传入口
- [x] 已为关键逻辑补充中文注释
- [x] 第二轮补充上传任务快照持久化能力
- [x] 第二轮补充服务端状态同步能力
- [x] 第二轮补充分片失败有限重试能力
- [x] 第二轮补充暂停接口与成功/失败回调扩展
- [x] 第二轮补充 `resumeUpload()` 恢复上传接口

## 6. 当前边界

当前前端实现仍属于第一轮骨架：

- 尚未接入真实文档列表刷新
- 尚未在页面层接入基于重新选择文件的完整恢复入口
- 尚未实现真正的暂停后继续上传调度
- 尚未实现分片级哈希计算
- 尚未实现拖拽上传
- 尚未实现多文件并行上传

## 7. 下一步建议

建议优先完成：

1. 在页面层接入 `resumeUpload()` 触发入口
2. 上传完成后自动刷新文档列表
3. 将暂停接口扩展为真正可继续的任务控制
4. 优化秒传命中提示
5. 增强拖拽上传体验

原因：

- 第一轮基础链路已经打通
- 下一轮重点应转向体验完善和断点续传细化

## 8. 本轮校验

- [x] 已检查前端新增文件诊断
- [x] 已执行 `pnpm --filter frontend build`
- [x] 前端构建通过
- [x] 第二轮逻辑增强后再次通过前端构建
