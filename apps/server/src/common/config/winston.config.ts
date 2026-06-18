import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import 'winston-daily-rotate-file';

const dailyRotateOptions = {
  datePattern: 'YYYY-MM-DD',
  zippedArchive: false,
  maxSize: '20m',
  maxFiles: '14d',
};

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
    // 按天切分 info 日志文件
    new winston.transports.DailyRotateFile({
      filename: 'logs/%DATE%/app-info.log',
      level: 'info',
      ...dailyRotateOptions,
    }),
    // 按天切分 error 日志文件
    new winston.transports.DailyRotateFile({
      filename: 'logs/%DATE%/app-error.log',
      level: 'error',
      ...dailyRotateOptions,
    }),
  ],
};
