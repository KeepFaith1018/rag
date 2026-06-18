---
paths: ["apps/server/prisma/schema.prisma"]
---
# Prisma 修改规范
1. 修改 schema 后，请提醒用户运行 `pnpm --filter server prisma migrate dev`,然后运行 `pnpm --filter server prisma generate`。
2. 确保新表名以 `b_` 或 `sys_` 开头。