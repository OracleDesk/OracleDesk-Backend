"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const config_1 = require("../config");
const logger_1 = require("./logger");
const globalForPrisma = globalThis;
exports.prisma = globalForPrisma.prisma ??
    new client_1.PrismaClient({
        log: config_1.config.NODE_ENV === 'development'
            ? [
                { emit: 'event', level: 'query' },
                { emit: 'event', level: 'error' },
                { emit: 'event', level: 'warn' },
            ]
            : [{ emit: 'event', level: 'error' }],
    });
if (config_1.config.NODE_ENV !== 'production') {
    globalForPrisma.prisma = exports.prisma;
}
// Log slow queries in development
if (config_1.config.NODE_ENV === 'development') {
    exports.prisma.$on('query', (e) => {
        if (e.duration > 200) {
            logger_1.logger.warn({ query: e.query, duration: e.duration }, 'Slow query detected');
        }
    });
}
exports.prisma.$on('error', (e) => {
    logger_1.logger.error({ message: e.message }, 'Prisma error');
});
exports.default = exports.prisma;
