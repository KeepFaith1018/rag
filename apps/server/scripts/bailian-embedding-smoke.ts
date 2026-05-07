import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { TokenService } from '../src/common/utils/token.service';
import { EmbeddingService } from '../src/modules/rag/ai/embedding.service';

/**
 * 本地百炼 Embedding 联调脚本。
 */
async function main() {
  const configService = new ConfigService(process.env);
  const tokenService = new TokenService();
  const embeddingService = new EmbeddingService(configService, tokenService);
  const debugSummary = embeddingService.getDebugSummary();
  const apiKey = process.env.BAILIAN_API_KEY || '';
  const dryRun =
    process.argv.includes('--dry-run') || apiKey.includes('please-replace');

  console.log('[Bailian Smoke] 当前配置摘要:');
  console.log(JSON.stringify(debugSummary, null, 2));

  if (dryRun) {
    console.log('[Bailian Smoke] 当前为 dry-run，仅校验配置读取和脚本可执行性');
    return;
  }

  const sampleTexts = [
    '这是第一条文档分片联调文本。',
    '这是第二条文档分片联调文本，用于验证批量向量化结果。',
  ];

  const result = await embeddingService.embedDocuments(sampleTexts);
  console.log('[Bailian Smoke] 向量化成功');
  console.log(
    JSON.stringify(
      {
        inputCount: sampleTexts.length,
        vectorCount: result.vectors.length,
        firstVectorDimension: result.vectors[0]?.length ?? 0,
        totalTokens: result.totalTokens,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error('[Bailian Smoke] 向量化失败');
  console.error(error);
  process.exitCode = 1;
});
