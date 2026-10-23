import type {PrismaClient} from '@prisma/client';
import {commitAtomicVerifiedClose} from '../src/utils/atomic-verified-close';
export function validateClient(db:PrismaClient){return commitAtomicVerifiedClose(db,{positionId:'p',accountId:1,closePrice:100,closeReason:'manual',realizedPnl:1,entryFee:0,exitFee:0,fundingFee:0,walletAuthoritative:true});}
