import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';

export const winstonConfig: winston.LoggerOptions = {
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json(),
  ),
  transports: [
    // 输出到控制台
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.timestamp(),
        nestWinstonModuleUtilities.format.nestLike('rag-kb', {
          prettyPrint: true,
        }),
      ),
    }),
    // 输出到 info 日志文件
    new winston.transports.File({
      filename: 'logs/app-info.log',
      level: 'info',
    }),
    // 输出到 error 日志文件
    new winston.transports.File({
      filename: 'logs/app-error.log',
      level: 'error',
    }),
  ],
};
