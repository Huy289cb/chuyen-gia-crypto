import {buildAccountResetUpdate} from './account-reset-update';
/** Selected inputs only; no credentials or unfiltered account row. */
export function buildAccountResetReceipt(accountId:number,attemptId:string,startingBalance:number,updatedAt:Date){
 if(!Number.isSafeInteger(accountId)||accountId<=0||!Number.isFinite(startingBalance)||!Number.isFinite(updatedAt.getTime())||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId))throw Error('invalid_reset_receipt_input');
 return {schema:'account-reset-receipt-v1',account_id:accountId,reset_attempt_id:attemptId,
  mutation_kind:'admin_local_reset',input:{starting_balance:startingBalance},
  update:JSON.parse(JSON.stringify(buildAccountResetUpdate(startingBalance,updatedAt))),
  write_started_at:updatedAt.toISOString(),clock_basis:'transaction_insert_not_commit',
  exchange_flatness_verified:false,economic_initial_capital:null,
  deleted_local_history:['pending_orders','position_trade_events','positions','account_snapshots']};
}
