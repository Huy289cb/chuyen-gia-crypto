import 'dotenv/config';

async function main() {
  const { initDatabase } = await import('../src/db/database.js');
  const { getTestnetAccount } = await import('../src/db/testnetDatabase.js');
  const { initTestnetEngine, cleanupTestnetAccountState } = await import('../src/services/testnetEngine.js');

  const db = await initDatabase();
  const account = await getTestnetAccount(db, 'BTC', 'kim_nghia');

  if (!account) {
    throw new Error('Testnet account not found for BTC/kim_nghia');
  }

  const client = await initTestnetEngine();
  if (!client) {
    throw new Error('Failed to initialize testnet engine');
  }

  const result = await cleanupTestnetAccountState(db, account);
  console.log('[TestnetCleanup] Cleanup completed:', JSON.stringify({
    cancelledOrderIds: result.cancelledOrderIds,
    walletBalance: result.balance?.walletBalance ?? null,
    equity: result.balance ? result.balance.walletBalance + result.balance.totalUnrealizedProfit : null,
  }));

  await new Promise((resolve, reject) => {
    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

main().catch((error) => {
  console.error('[TestnetCleanup] Cleanup failed:', error.message);
  process.exitCode = 1;
});
