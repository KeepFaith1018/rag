---
title: 测试文档
author: 测试作者
tags: test, markdown
---

# 第一章 概述

这是第一章的正文内容。它包含多个句子，用于测试基本的 Markdown 解析能力。

## 1.1 背景

这是背景部分的正文。这里有一些**粗体**和*斜体*的格式标记。

### 1.1.1 技术架构

系统采用微服务架构。分为接入层、业务层和数据层三层。

# 第二章 功能详解

第二章的正文内容。

## 2.1 核心功能

核心功能模块包括：

- 用户管理
- 权限控制
- 数据统计

## 2.2 数据表格

| 指标 | Q1 | Q2 | Q3 | Q4 |
|------|-----|-----|-----|-----|
| 营收 | 100 | 120 | 140 | 160 |
| 成本 | 60  | 70  | 80  | 90  |

## 2.3 示例代码

```typescript
import { Injectable } from '@nestjs/common';

@Injectable()
export class ExampleService {
  async doSomething(): Promise<string> {
    return 'Hello World';
  }
}
```
