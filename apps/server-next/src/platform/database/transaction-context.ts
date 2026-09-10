import type { Prisma } from '../../../prisma/generated/client';

// Application coordinators pass this context to explicit module APIs.
export type TransactionContext = Prisma.TransactionClient;
