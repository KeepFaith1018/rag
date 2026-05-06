/**
 * 后台管理系统种子数据
 * 运行命令: npx ts-node prisma/seed.ts
 * 或在 Prisma Studio 中手动添加
 */
import { PrismaClient } from './generated/client';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import * as bcrypt from 'bcrypt';

const port = process.env.DATABASE_PORT ? Number(process.env.DATABASE_PORT) : 3306;
const prisma = new PrismaClient({
  adapter: new PrismaMariaDb({
    host: process.env.DATABASE_HOST,
    port,
    user: process.env.DATABASE_USER,
    password: process.env.DATABASE_PASSWORD,
    database: process.env.DATABASE_NAME,
    connectionLimit: 5,
  }),
});

async function main() {
  console.log('开始创建管理员账号...');

  // 默认管理员账号
  const defaultAdmin = {
    username: 'admin',
    password: 'admin123',
    role: 'super_admin',
    is_active: true,
  };

  const existingAdmin = await prisma.sys_admins.findUnique({
    where: { username: defaultAdmin.username },
  });

  if (existingAdmin) {
    console.log(`管理员 ${defaultAdmin.username} 已存在，跳过创建`);
  } else {
    const salt = await bcrypt.genSalt();
    const hashedPassword = await bcrypt.hash(defaultAdmin.password, salt);

    await prisma.sys_admins.create({
      data: {
        username: defaultAdmin.username,
        password_hash: hashedPassword,
        role: defaultAdmin.role,
        is_active: defaultAdmin.is_active,
      },
    });

    console.log(`管理员账号创建成功！`);
    console.log(`用户名: ${defaultAdmin.username}`);
    console.log(`密码: ${defaultAdmin.password}`);
    console.log(`角色: ${defaultAdmin.role}`);
    console.log('');
    console.log('⚠️  请尽快修改默认密码！');
  }
}

main()
  .catch((e) => {
    console.error('种子脚本执行失败:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
