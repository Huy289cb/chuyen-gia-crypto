import path from 'node:path';
import { runHistoricalPaperTestbed } from './historical-replay';
import { implementationPackage, markTestbedFailed, publishTestbed, queuedCctTestbedRegistration, type PortfolioTestbedRequest, type CctTestbedWindow } from './paper-service';
import { CCT_PAPER_POLICY } from './policy-registry';
import { runCctHistoricalPaperTestbed } from './cct-historical-replay';

function request(): PortfolioTestbedRequest | undefined {
  return process.env.PORTFOLIO_TESTBED_POLICY === CCT_PAPER_POLICY.id
    ? { policyId: CCT_PAPER_POLICY.id, window: process.env.PORTFOLIO_TESTBED_WINDOW as CctTestbedWindow } : undefined;
}

async function run(): Promise<void> {
  const cctRequest = request();
  if (cctRequest) {
    const registration = await queuedCctTestbedRegistration(process.env.PORTFOLIO_TESTBED_JOB_ID ?? '', cctRequest,
      process.env.PORTFOLIO_TESTBED_PROTOCOL_SHA256 ?? '');
    const report = await runCctHistoricalPaperTestbed(registration);
    await publishTestbed(report, cctRequest); return;
  }
  const report = await runHistoricalPaperTestbed({
    dataDir: path.join(implementationPackage, 'data'), outputDir: path.join(implementationPackage, 'outputs'),
    protocolPath: path.join(implementationPackage, 'protocol.json'),
  });
  await publishTestbed(report);
}
void run().catch(async (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  await markTestbedFailed(process.env.PORTFOLIO_TESTBED_JOB_ID ?? '', message, request());
  process.exitCode = 1;
});
