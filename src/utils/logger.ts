import winston from 'winston';

const isProduction = process.env.NODE_ENV === 'production';

/**
 * Logger estruturado com separação de destinos:
 * - Console (Railway): apenas WARN e ERROR
 * - File combined.log: tudo (para debug local)
 * - File error.log: apenas ERROR
 *
 * Logs de nível INFO (tokens detectados, transações, P&L) são gravados
 * pelo código de negócio diretamente no MySQL/Redis para o dashboard consumir.
 * Não poluem o stdout do Railway.
 */

const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.colorize(),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `[${timestamp as string}] ${level}: ${message as string}${metaStr}`;
  }),
);

const jsonFormat = winston.format.combine(
  winston.format.timestamp(),
  winston.format.json(),
);

const effectiveLevel = process.env.LOG_LEVEL ?? (isProduction ? 'warn' : 'info');

const logger = winston.createLogger({
  level: effectiveLevel,
  format: isProduction ? jsonFormat : consoleFormat,
  transports: [
    new winston.transports.Console({
      level: isProduction ? 'warn' : effectiveLevel,
      format: isProduction ? jsonFormat : consoleFormat,
    }),
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: jsonFormat,
      maxsize: 5_242_880,
      maxFiles: 3,
    }),
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: jsonFormat,
      maxsize: 10_485_760,
      maxFiles: 5,
    }),
  ],
});

export { logger };
