import { PrismaClient } from './generated/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // 1. 默认超级管理员
  const admin = await prisma.sys_admins.upsert({
    where: { username: 'admin' },
    update: {},
    create: {
      username: 'admin',
      password_hash: await bcrypt.hash('admin123', 10),
      role: 'super_admin',
    },
  });
  console.log(`✅ Admin user: ${admin.username} (id: ${admin.id})`);

  // 2. 系统模型配置
  const models = await prisma.sys_model_configs.createMany({
    data: [
      {
        provider: 'bailian',
        name: 'deepseek-v4-pro',
        type: 'main',
        is_default: true,
      },
      {
        provider: 'bailian',
        name: 'deepseek-v4-flash',
        type: 'light',
        is_default: false,
      },
      {
        provider: 'bailian',
        name: 'text-embedding-v4',
        type: 'embedding',
        is_default: false,
      },
      {
        provider: 'bailian',
        name: 'qwen3-rerank',
        type: 'rerank',
        is_default: false,
      },
    ],
    skipDuplicates: true,
  });
  console.log(`✅ System models: ${models.count} records`);

  // 3. 基础字典数据
  const dictTypes = await prisma.sys_dict_type.createMany({
    data: [
      { code: 'doc_status', name: '文档状态' },
      { code: 'kb_visibility', name: '知识库可见性' },
      { code: 'member_role', name: '成员角色' },
      { code: 'chat_mode', name: '对话模式' },
    ],
    skipDuplicates: true,
  });
  console.log(`✅ Dict types: ${dictTypes.count} records`);

  const dictItems = await prisma.sys_dict_item.createMany({
    data: [
      // 文档状态
      { type_code: 'doc_status', value: 'pending', label: '待处理', sort: 1 },
      { type_code: 'doc_status', value: 'uploaded', label: '已上传', sort: 2 },
      { type_code: 'doc_status', value: 'parsing', label: '解析中', sort: 3 },
      { type_code: 'doc_status', value: 'ready', label: '就绪', sort: 4 },
      { type_code: 'doc_status', value: 'failed', label: '失败', sort: 5 },
      // 知识库可见性
      { type_code: 'kb_visibility', value: 'private', label: '私有', sort: 1 },
      { type_code: 'kb_visibility', value: 'shared', label: '共享', sort: 2 },
      // 成员角色
      { type_code: 'member_role', value: 'manager', label: '管理员', sort: 1 },
      { type_code: 'member_role', value: 'collaborator', label: '协作者', sort: 2 },
      { type_code: 'member_role', value: 'member', label: '成员', sort: 3 },
      // 对话模式
      { type_code: 'chat_mode', value: 'rag', label: 'RAG 检索', sort: 1 },
      { type_code: 'chat_mode', value: 'direct', label: '直接对话', sort: 2 },
    ],
    skipDuplicates: true,
  });
  console.log(`✅ Dict items: ${dictItems.count} records`);

  console.log('🎉 Seed completed!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
