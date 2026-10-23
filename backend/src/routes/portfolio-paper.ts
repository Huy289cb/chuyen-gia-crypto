import { Router } from 'express';
import { advancePortfolioPaper, portfolioPaperStatus, startPortfolioTestbed } from '../portfolio/paper-service';
import { PortfolioBusyError } from '../portfolio/paper-store';
import { PORTFOLIO_PAPER_DASHBOARD_HTML } from '../portfolio/paper-dashboard';
import { CCT_PAPER_POLICY } from '../portfolio/policy-registry';
import type { PortfolioTestbedRequest } from '../portfolio/paper-service';
import { livePortfolioStatus } from '../portfolio/live-runtime';
import { PORTFOLIO_LIVE_DASHBOARD_HTML } from '../portfolio/live-dashboard';

const router = Router();
router.get('/live/view', (_req, res) => { res.type('html').send(PORTFOLIO_LIVE_DASHBOARD_HTML); });
router.get('/live', async (_req, res): Promise<void> => {
  try { res.json({ success: true, data: await livePortfolioStatus() }); }
  catch { res.status(503).json({ success: false, error: 'Live portfolio status is unavailable' }); }
});
router.get('/view', (_req, res) => { res.type('html').send(PORTFOLIO_PAPER_DASHBOARD_HTML); });
router.get('/', async (req, res): Promise<void> => {
  const query = req.query ?? {};
  const hasQuery = Object.keys(query).length > 0;
  if (hasQuery && (query.policyId !== CCT_PAPER_POLICY.id || !['dev64', 'prior64', 'continuous128'].includes(String(query.window))
    || Object.keys(query).some(key => key !== 'policyId' && key !== 'window'))) {
    res.status(400).json({ success: false, error: 'Unknown registered paper report window' }); return;
  }
  try { res.json({ success: true, data: await portfolioPaperStatus(hasQuery ? query as unknown as PortfolioTestbedRequest : undefined) }); }
  catch (error) { res.status(500).json({ success: false, error: (error as Error).message }); }
});
router.post('/advance', async (req, res): Promise<void> => {
  if (Object.keys(req.body ?? {}).length) {
    res.status(400).json({ success: false, error: 'This paper wallet does not accept policy overrides' }); return;
  }
  try { res.json({ success: true, data: await advancePortfolioPaper() }); }
  catch (error) { res.status(error instanceof PortfolioBusyError ? 409 : 503).json({ success: false, error: (error as Error).message }); }
});
router.post('/testbed', async (req, res): Promise<void> => {
  const legacy = req.body?.days === 14 && Object.keys(req.body).every(key => key === 'days');
  const cct = req.body?.policyId === CCT_PAPER_POLICY.id && ['dev64', 'prior64', 'continuous128'].includes(req.body?.window)
    && Object.keys(req.body).every(key => key === 'policyId' || key === 'window');
  if (!legacy && !cct) {
    res.status(400).json({ success: false, error: 'Use {days:14} or the registered CCT policyId/window; capital, risk and source are fixed' }); return;
  }
  try { res.status(202).json({ success: true, data: await startPortfolioTestbed(cct ? req.body as PortfolioTestbedRequest : undefined) }); }
  catch (error) { res.status(error instanceof PortfolioBusyError ? 409 : 503).json({ success: false, error: (error as Error).message }); }
});
export default router;
