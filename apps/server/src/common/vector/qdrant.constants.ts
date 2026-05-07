/**
 * RAG 文档分片统一写入的 Qdrant collection 名称。
 */
export const QDRANT_DOCUMENT_COLLECTION_NAME = 'kb_document_chunks';

/** HNSW 图连接数，越大召回越好但内存开销越大。 */
export const QDRANT_HNSW_M = 32;
/** HNSW 图构建时的搜索宽度。 */
export const QDRANT_HNSW_EF_CONSTRUCT = 256;
/** 查询时的搜索宽度，影响召回率与延迟。 */
export const QDRANT_EF_SEARCH = 128;
