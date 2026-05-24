# Apache Doris 列式存储引擎与数据压缩

## 架构概述

Apache Doris 是一个基于 MPP（大规模并行处理）架构的高性能实时分析数据库。其核心设计采用列式存储模型，每列独立存储，这使得数据压缩极为高效。

## 列式存储模型

### 为什么列存更利于压缩

- **相同数据类型** → 相似的数据分布模式 → 更好的压缩率
- **数据局部性** → 列内值范围相近
- **独立列访问** → 查询只读相关列，减少 I/O

### 存储格式演进

| 版本 | 特性 |
|------|------|
| Segment V2 | 列元数据打包在 Segment Footer 中，成百上千列时成为瓶颈 |
| Storage Format V3 | 列元数据移到独立区域，Footer 轻量化，按需加载元数据 |

V3 性能提升：
- Segment 打开时间：65s → 4s（16 倍加速）
- 内存使用：60 GB → <1 GB（60 倍降低）

## 双层压缩架构

Doris 采用 Encoding + Compression 双层策略：

```
第一层：Encoding（数据转换）
  - Dictionary Encoding（低基数列）
  - BitShuffle / RLE（游程编码）
  - Prefix Encoding（字符串列）
  - Plain Encoding（V3 数值默认）

第二层：Compression（通用压缩）
  - LZ4 / LZ4F / LZ4HC
  - ZSTD（Zstandard）
  - Snappy
  - Zlib / GZIP
```

Encoding 先将数据转换为更易压缩的形式，再由通用压缩算法处理。

## 压缩算法对比

| 算法 | 压缩速度 | 解压速度 | 压缩率 | 适用场景 |
|------|---------|---------|--------|---------|
| **LZ4**（默认） | 极快 | 极快 | 中等 | 实时查询、高并发 OLAP |
| **ZSTD** | 中 | 快（高压缩率下仍快） | 高（日志数据可达 10×） | 存储成本敏感、批量分析 |
| **LZ4HC** | 较慢 | 快 | 高于 LZ4 | 高压缩率 + 快速读取 |
| **Snappy** | 快 | 极快 | 中等 | 低 CPU 开销 |
| **Zlib/GZIP** | 慢 | 慢 | 最高 | 归档/冷数据 |

## 压缩配置

### 表级压缩

```sql
CREATE TABLE sales_data (
    sale_id    BIGINT,
    sale_date  DATE,
    product    VARCHAR(200),
    amount     DECIMAL(20,2)
)
DUPLICATE KEY(sale_id, sale_date)
DISTRIBUTED BY HASH(sale_id) BUCKETS 32
PROPERTIES ("compression" = "zstd");
```

### 高级配置

```sql
PROPERTIES (
    "compression" = "zstd",
    "storage_page_size" = "1048576"  -- 1 MB 页面
);
```

## 存储引擎内部机制

Doris 使用类 LSM-Tree 存储引擎：
- **数据写入**逐条追加到新的 Rowset 文件中
- **Compaction** 后台合并小文件：
  - Cumulative Compaction：合并增量 Rowset
  - Base Compaction：合并大版本数据
  - Full Compaction：全量合并（手动触发）
- Compaction 过程中重新压缩数据、清理删除记录

## 选型决策

- 实时高并发 → LZ4（默认）
- 存储成本敏感 / 日志数据 → ZSTD（可达 10× 压缩）
- 批量分析 → ZSTD + 1MB 页面大小
- 归档冷数据 → Zlib 或 LZ4HC
