# Multi-Method Paper Trading Implementation Plan

> **[BIG UPDATE]** This is a major architectural change to support multiple trading methods running in parallel with staggered scheduling. Implement in a separate conversation after careful review.

This plan implements a second trading method (kim-nghia-paper-trading) that runs in staggered parallel with the existing ICT method, using separate accounts (100U each) with method_id tracking for independent performance comparison.

## Architecture Overview

**Method Configuration:**
- Method 1 (ICT): Runs at 0m, 15m, 30m, 45m (every 15 minutes)
- Method 2 (KimNghia): Runs at 7m30s, 22m30s, 37m30s, 52m30s (7.5 min offset)
- Each method has separate account with 100U starting balance
- Accounts: BTC-ICT (100U), BTC-KimNghia (100U)
- ETH trading disabled for both methods (focus on BTC only)

**Database Strategy:**
- Add `method_id` column to accounts table
- Unique constraint: (symbol, method_id)
- Add `method_id` column to: predictions, positions, pending_orders, analysis_history
- Each method operates on its own account (account_id linked to method)
- Separate performance tracking per account/method

## Phase 1: Backend - Database Schema Changes

### 1.1 Add method_id Columns (Migration)

**Files to modify:**
- `backend/src/db/migrations.js` - Add new migration 6

**Changes:**
```sql
-- Add method_id to accounts table (first, to support method-specific accounts)
ALTER TABLE accounts ADD COLUMN method_id TEXT DEFAULT 'ict';

-- Drop existing unique constraint on symbol
-- Note: SQLite doesn't support DROP CONSTRAINT directly, need to recreate table
-- Migration will handle this by creating new table and copying data

-- Add method_id to predictions table
ALTER TABLE predictions ADD COLUMN method_id TEXT DEFAULT 'ict';

-- Add method_id to positions table
ALTER TABLE positions ADD COLUMN method_id TEXT DEFAULT 'ict';

-- Add method_id to pending_orders table
ALTER TABLE pending_orders ADD COLUMN method_id TEXT DEFAULT 'ict';

-- Add method_id to analysis_history table
ALTER TABLE analysis_history ADD COLUMN method_id TEXT DEFAULT 'ict';

-- Add index for method_id filtering
CREATE INDEX IF NOT EXISTS idx_predictions_method ON predictions(method_id);
CREATE INDEX IF NOT EXISTS idx_positions_method ON positions(method_id);
CREATE INDEX IF NOT EXISTS idx_pending_orders_method ON pending_orders(method_id);
CREATE INDEX IF NOT EXISTS idx_accounts_method ON accounts(method_id);
```

**Migration logic (SAFE - preserves all existing data):**

For accounts table (SQLite requires table recreation for constraint changes):
1. **Backup existing data**: Create backup of accounts table (optional but recommended)
2. Add method_id column to existing accounts table: `ALTER TABLE accounts ADD COLUMN method_id TEXT DEFAULT 'ict'`
3. Update existing records: `UPDATE accounts SET method_id = 'ict' WHERE method_id IS NULL`
4. Create new accounts_new table with new schema:
   ```sql
   CREATE TABLE accounts_new (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     symbol TEXT NOT NULL,
     method_id TEXT NOT NULL DEFAULT 'ict',
     starting_balance REAL NOT NULL DEFAULT 100,
     current_balance REAL NOT NULL DEFAULT 100,
     equity REAL NOT NULL DEFAULT 100,
     unrealized_pnl REAL DEFAULT 0,
     realized_pnl REAL DEFAULT 0,
     total_trades INTEGER DEFAULT 0,
     winning_trades INTEGER DEFAULT 0,
     losing_trades INTEGER DEFAULT 0,
     max_drawdown REAL DEFAULT 0,
     consecutive_losses INTEGER DEFAULT 0,
     last_trade_time DATETIME,
     cooldown_until DATETIME,
     created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
     UNIQUE(symbol, method_id)
   )
   ```
5. Copy all data from accounts to accounts_new:
   ```sql
   INSERT INTO accounts_new (symbol, method_id, starting_balance, current_balance, equity, unrealized_pnl, realized_pnl, total_trades, winning_trades, losing_trades, max_drawdown, consecutive_losses, last_trade_time, cooldown_until, created_at, updated_at)
   SELECT symbol, 'ict', starting_balance, current_balance, equity, unrealized_pnl, realized_pnl, total_trades, winning_trades, losing_trades, max_drawdown, consecutive_losses, last_trade_time, cooldown_until, created_at, updated_at
   FROM accounts
   ```
6. Verify data copy: Check row count matches before dropping
7. Drop old table: `DROP TABLE accounts`
8. Rename new table: `ALTER TABLE accounts_new RENAME TO accounts`
9. Recreate indexes on accounts table
10. Insert BTC-KimNghia account: `INSERT INTO accounts (symbol, method_id, starting_balance, current_balance, equity) VALUES ('BTC', 'kim_nghia', 100, 100, 100)`

For other tables (predictions, positions, pending_orders, analysis_history):
- Add method_id column with DEFAULT 'ict'
- Existing records automatically get method_id = 'ict'
- No data loss, only schema addition
- Handle duplicate column errors gracefully

### 1.2 Update Database Functions

**Files to modify:**
- `backend/src/db/database.js`

**Functions to update:**
- `getOrCreateAccount()` - Add method_id parameter, use (symbol, method_id) for lookup
- `saveAnalysis()` - Add method_id parameter, save to analysis_history
- `savePrediction()` - Add method_id parameter, save to predictions
- `createPosition()` - Add method_id parameter, save to positions
- `createPendingOrder()` - Add method_id parameter, save to pending_orders
- `getPositions()` - Add optional method_id filter (or filter by account_id)
- `getPendingOrders()` - Add optional method_id filter (or filter by account_id)
- `getRecentAnalysisWithPredictions()` - Add optional method_id filter
- `getAllAccounts()` - Return all accounts including method-specific ones

**Example signature change:**
```javascript
// Before
export async function getOrCreateAccount(db, symbol, startingBalance)
export async function saveAnalysis(db, coin, priceData, analysis)

// After  
export async function getOrCreateAccount(db, symbol, methodId, startingBalance)
export async function saveAnalysis(db, coin, priceData, analysis, methodId = 'ict')
```

**Account lookup logic:**
- Use `WHERE symbol = ? AND method_id = ?` instead of just `WHERE symbol = ?`
- Each method gets its own account: (BTC, ict) and (BTC, kim_nghia)
- Both start with 100U balance

## Phase 2: Backend - Method Configuration & Analyzer Factory

### 2.1 Create Method Configuration

**New file:** `backend/src/config/methods.js`

```javascript
export const METHODS = {
  ict: {
    methodId: 'ict',
    name: 'ICT Smart Money',
    description: 'ICT Smart Money Concepts analysis',
    scheduleOffset: 0, // Runs at 0m, 15m, 30m, 45m
    systemPrompt: '...', // Existing ICT prompt from groqAnalyzer.js
    enabled: true
  },
  kim_nghia: {
    methodId: 'kim_nghia',
    name: 'Kim Nghia (SMC + Volume + Fib)',
    description: 'SMC + Volume + Fibonacci analysis',
    scheduleOffset: 450, // 7.5 minutes = 450 seconds
    systemPrompt: '...', // New prompt from docs/kim-nghia-paper-trading.md
    enabled: true
  }
};

export const ENABLED_METHODS = Object.values(METHODS).filter(m => m.enabled);
```

### 2.2 Create Generic Analyzer Factory

**New file:** `backend/src/analyzers/analyzerFactory.js`

```javascript
import { getGroqClient } from '../groq-client.js';

export function createAnalyzer(methodConfig) {
  return {
    methodId: methodConfig.methodId,
    analyze: async (priceData, db = null) => {
      const client = getGroqClient();
      if (!client) {
        return generateFallbackAnalysis(priceData, methodConfig.methodId);
      }

      // Use method-specific system prompt
      const response = await client.analyze({
        systemPrompt: methodConfig.systemPrompt,
        userPrompt: buildUserPrompt(priceData, db, methodConfig.methodId),
        temperature: 0.3,
        maxRetries: 2
      });

      return formatAnalysisResponse(response, priceData, methodConfig.methodId);
    }
  };
}

function buildUserPrompt(priceData, db, methodId) {
  // Build user prompt based on method-specific requirements
  // Include historical context, open positions, pending orders filtered by method_id
}

function formatAnalysisResponse(rawResponse, priceData, methodId) {
  // Format response with method_id tagging
  const formatted = /* existing format logic */;
  formatted.method_id = methodId;
  return formatted;
}
```

### 2.3 Refactor Existing Groq Analyzer

**File to modify:** `backend/src/groqAnalyzer.js`

**Changes:**
- Extract system prompt to `METHODS.ict.systemPrompt` in config file
- Extract user prompt building logic to reusable function
- Keep `analyzeWithGroq()` as wrapper for backward compatibility
- Add method_id parameter (default 'ict')

## Phase 3: Backend - Staggered Scheduler

### 3.1 Update Scheduler for Staggered Execution

**File to modify:** `backend/src/scheduler.js`

**Current behavior:**
- Single cron job: `*/15 * * * *` (every 15 minutes)

**New behavior:**
- Keep existing 15-minute job for ICT method
- Add new 15-minute job with 7.5-minute offset for KimNghia method
- Each job runs its own analysis with method-specific analyzer

**Implementation:**
```javascript
import { METHODS, ENABLED_METHODS } from './config/methods.js';
import { createAnalyzer } from './analyzers/analyzerFactory.js';

export async function startScheduler() {
  // Initialize database
  await initDb();
  
  // ICT Method - Runs at 0m, 15m, 30m, 45m
  cron.schedule('*/15 * * * *', () => {
    runMethodAnalysis('ict').catch(err => {
      console.error('[Scheduler] ICT analysis failed:', err.message);
    });
  });
  
  // KimNghia Method - Runs at 7m30s, 22m30s, 37m30s, 52m30s
  cron.schedule('7,22,37,52 * * * *', () => {
    runMethodAnalysis('kim_nghia').catch(err => {
      console.error('[Scheduler] KimNghia analysis failed:', err.message);
    });
  });
  
  // Existing validation/retention jobs (unchanged)
  // ...
}

async function runMethodAnalysis(methodId) {
  const method = METHODS[methodId];
  const analyzer = createAnalyzer(method);
  
  console.log(`[Scheduler][${method.name}] Starting analysis...`);
  
  try {
    // Fetch price data
    const priceData = await fetchPrices(db);
    
    // Get or create method-specific account
    const account = await getOrCreateAccount(db, 'BTC', methodId, 100);
    
    // Run method-specific analysis
    const analysis = await analyzer.analyze(priceData, db);
    
    // Save to database with method_id
    await saveAnalysisWithMethod(db, 'BTC', priceData, analysis, methodId);
    
    // Cache with method_id
    cache.setMethod(methodId, {
      prices: priceData,
      analysis: analysis,
      lastUpdated: priceData.timestamp
    });
    
    // Get open positions for this method's account
    const openPositions = await getPositions(db, { account_id: account.id, status: 'open' });
    
    // Auto-entry evaluation (method-specific)
    await evaluateAutoEntryForMethod(db, analysis, account, openPositions, methodId);
    
    console.log(`[Scheduler][${method.name}] Analysis complete - Account: ${account.id}, Balance: $${account.current_balance.toFixed(2)}`);
  } catch (error) {
    console.error(`[Scheduler][${method.name}] Failed:`, error.message);
  }
}
```

### 3.2 Update Cache for Multi-Method Support

**File to modify:** `backend/src/cache.js`

**Changes:**
- Change from single cache to method-specific cache
- Add `setMethod(methodId, data)` and `getMethod(methodId)` methods
- Add `getAllMethods()` to retrieve all cached analyses

**New structure:**
```javascript
class Cache {
  constructor() {
    this.caches = {
      ict: { data: null, timestamp: null },
      kim_nghia: { data: null, timestamp: null }
    };
    this.ttlMs = 20 * 60 * 1000;
  }

  setMethod(methodId, data) {
    this.caches[methodId] = {
      data,
      timestamp: Date.now()
    };
  }

  getMethod(methodId) {
    const cache = this.caches[methodId];
    if (!cache || !cache.data) return null;
    
    const age = Date.now() - cache.timestamp;
    if (age > this.ttlMs) return null;
    
    return {
      data: cache.data,
      age: Math.floor(age / 1000),
      cachedAt: new Date(cache.timestamp).toISOString()
    };
  }

  // Keep existing set/get for backward compatibility (defaults to 'ict')
  set(data) { this.setMethod('ict', data); }
  get() { return this.getMethod('ict'); }
}
```

### 3.3 Update Auto-Entry Logic for Method-Specific Execution

**File to modify:** `backend/src/services/autoEntryLogic.js`

**Changes:**
- Add method_id parameter to `evaluateAutoEntry()`
- Create separate config per method in `METHODS` config
- Method-specific settings: confidence threshold, R:R ratio, etc.

**New config structure:**
```javascript
// In backend/src/config/methods.js
export const METHODS = {
  ict: {
    // ... existing fields
    autoEntry: {
      minConfidence: 70,
      minRRRatio: 2.0,
      riskPerTrade: 0.01,
      maxPositionsPerSymbol: 8,
      // ... other settings
    }
  },
  kim_nghia: {
    // ... existing fields
    autoEntry: {
      minConfidence: 62, // Different threshold
      minRRRatio: 2.5, // Different R:R
      riskPerTrade: 0.10, // 10% risk per trade
      maxPositionsPerSymbol: 8,
      // ... other settings
    }
  }
};
```

## Phase 4: Backend - API Endpoint Updates

### 4.1 Add Method Filter to Endpoints

**File to modify:** `backend/src/routes.js`

**Endpoints to update:**
- `GET /api/positions` - Add `?method=ict|kim_nghia` query param (filter by account_id via method)
- `GET /api/accounts` - Return all accounts (including method-specific), or filter by `?method=ict|kim_nghia`
- `GET /api/accounts/:symbol` - Change to `GET /api/accounts/:symbol/:method` or use query param
- `POST /api/accounts/reset/:symbol` - Change to support method parameter
- `GET /api/performance` - Add `?method=ict|kim_nghia` query param
- `GET /api/performance/equity-curve` - Add method filter (by account_id)
- `GET /api/performance/trades` - Add method filter (by account_id)
- `GET /api/analysis/latest` - Add `?method=ict|kim_nghia` query param

**Example implementation:**
```javascript
// GET /api/positions?method=ict
router.get('/positions', async (req, res) => {
  try {
    const { method } = req.query;
    const account = await getAccountBySymbolAndMethod(db, 'BTC', method);
    const positions = await getPositions(db, { 
      account_id: account.id,
      status: 'open'
    });
    res.json(positions);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// GET /api/accounts?method=ict
router.get('/accounts', async (req, res) => {
  try {
    const { method } = req.query;
    let accounts;
    if (method) {
      accounts = await getAccountsByMethod(db, method);
    } else {
      accounts = await getAllAccounts(db);
    }
    res.json(accounts);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

**New database functions needed:**
- `getAccountBySymbolAndMethod(db, symbol, methodId)` - Lookup account by (symbol, method_id)
- `getAccountsByMethod(db, methodId)` - Get all accounts for a method

### 4.2 Add Method Comparison Endpoint

**New endpoint:** `GET /api/compare`

**Returns:** Side-by-side comparison of both methods
```json
{
  "ict": {
    "account": { /* account data */ },
    "performance": { /* metrics */ },
    "positions": [ /* open positions */ ],
    "lastAnalysis": { /* latest analysis */ }
  },
  "kim_nghia": {
    "account": { /* account data */ },
    "performance": { /* metrics */ },
    "positions": [ /* open positions */ ],
    "lastAnalysis": { /* latest analysis */ }
  }
}
```

## Phase 5: Frontend - Tab Switcher

### 5.1 Add Method Tab Switcher to Header

**File to modify:** `frontend/app/layout/Header.tsx`

**Changes:**
- Add tab switcher component below navigation
- Tabs: "ICT Method" | "Kim Nghia Method"
- Store selected method in URL query param or local state
- Pass selected method to all child components

**Component structure:**
```tsx
<Header>
  {/* Existing navigation */}
  
  {/* New method switcher */}
  <MethodSwitcher 
    methods={['ict', 'kim_nghia']}
    selected={selectedMethod}
    onChange={setSelectedMethod}
  />
</Header>
```

### 5.2 Update usePaperTrading Hook

**File to modify:** `frontend/app/hooks/usePaperTrading.js`

**Changes:**
- Add `method` parameter to hook
- Filter API calls by method_id
- Return method-specific data

**New signature:**
```javascript
const { accounts, positions, tradeHistory, loading } = usePaperTrading(method = 'ict');
```

### 5.3 Update Page Components to Use Method Filter

**File to modify:** `frontend/app/page.tsx`

**Changes:**
- Add selectedMethod state
- Pass selectedMethod to usePaperTrading hook
- Pass selectedMethod to all sections
- Update API calls to include method query param

**Example:**
```tsx
export default function Home() {
  const [selectedMethod, setSelectedMethod] = useState('ict');
  
  const { accounts, positions, tradeHistory } = usePaperTrading(selectedMethod);
  
  return (
    <Header 
      selectedMethod={selectedMethod}
      onMethodChange={setSelectedMethod}
    />
    <TradingDashboard 
      accounts={accounts}
      method={selectedMethod}
    />
    {/* Other sections with method prop */}
  );
}
```

### 5.4 Update Account Display to Show Method Distinction

**File to modify:** `frontend/app/sections/TradingDashboard.tsx`

**Changes:**
- Display method name in account card
- Show method-specific balance (100U starting balance each)
- Add visual distinction (color/badge) between methods
- Show both accounts when no method selected, or single account when method selected

**UI Example (with method switcher):**
```
┌─────────────────────────────────┐
│ [ICT Method] [Kim Nghia Method] │
├─────────────────────────────────┤
│ BTC Account - ICT Method        │
│ Balance: $105.50 (+5.50%)       │
│ Starting: $100.00               │
│ Win Rate: 65% | Trades: 20      │
└─────────────────────────────────┘
```

**UI Example (comparison view):**
```
┌─────────────────────────────────┬─────────────────────────────────┐
│ BTC - ICT Method                │ BTC - Kim Nghia Method          │
│ Balance: $105.50 (+5.50%)       │ Balance: $102.30 (+2.30%)       │
│ Starting: $100.00               │ Starting: $100.00               │
│ Win Rate: 65% | Trades: 20      │ Win Rate: 58% | Trades: 15      │
└─────────────────────────────────┴─────────────────────────────────┘
```

## Phase 6: Frontend - Rules Page with Query Param

### 6.1 Update Rules Page to Support Query Param

**File to modify:** `frontend/app/rules/page.tsx`

**Changes:**
- Read `method` query param from URL
- Display method-specific rules based on param
- Default to 'ict' if no param provided
- Add method selector at top of page

**Implementation:**
```tsx
export default function RulesPage() {
  const searchParams = useSearchParams();
  const method = searchParams.get('method') || 'ict';
  
  const methodConfig = METHODS[method];
  
  return (
    <div>
      <MethodSelector 
        current={method}
        onChange={(m) => router.push(`/rules?method=${m}`)}
      />
      
      <h1>{methodConfig.name} Rules</h1>
      
      {/* Method-specific rules content */}
      {method === 'ict' ? <ICTRules /> : <KimNghiaRules />}
    </div>
  );
}
```

### 6.2 Create Kim Nghia Rules Content

**New file:** `frontend/app/rules/kim-nghia-rules.tsx`

**Content:**
- Similar structure to existing rules page
- Use content from `docs/kim-nghia-paper-trading.md`
- Translate to Vietnamese/English
- Include:
  - Auto-entry criteria (method-specific)
  - Multi-timeframe analysis (H4 + H1 + M15)
  - SMC concepts (OB, FVG, EQH/EQL, CHoCH, BOS)
  - Volume analysis
  - Fibonacci confluence
  - Position management rules

## Phase 7: Documentation Updates

### 7.1 Update Paper Trading Documentation

**File to modify:** `docs/paper-trading.md`

**Additions:**
- Multi-method architecture section
- Separate accounts per method explanation
- Method_id tracking in database
- Staggered scheduler description
- Account creation per method (100U each)
- Performance comparison approach

### 7.2 Create Kim Nghia Method Documentation

**File already exists:** `docs/kim-nghia-paper-trading.md`

**Enhancements:**
- Add integration details with existing system
- Document method-specific configuration
- Explain staggered execution
- Add API endpoint examples

### 7.3 Update API Documentation

**File to modify:** `docs/api-paper-trading.md`

**Additions:**
- Method query parameter documentation
- New `/api/compare` endpoint
- Updated response formats with method_id
- Example requests for each method

## Implementation Order

1. **Phase 1** - Database schema changes (highest priority, breaking change)
2. **Phase 2** - Method configuration & analyzer factory
3. **Phase 3** - Staggered scheduler implementation
4. **Phase 4** - API endpoint updates
5. **Phase 5** - Frontend tab switcher
6. **Phase 6** - Rules page with query param
7. **Phase 7** - Documentation updates

## Testing Checklist

- [ ] Migration runs successfully on existing database
- [ ] Accounts table recreated with UNIQUE(symbol, method_id) constraint
- [ ] BTC-ICT account created with 100U balance
- [ ] BTC-KimNghia account created with 100U balance
- [ ] ICT method runs at correct times (0m, 15m, 30m, 45m)
- [ ] KimNghia method runs at correct times (7m30s, 22m30s, 37m30s, 52m30s)
- [ ] Both methods save analysis with correct method_id
- [ ] Positions created with correct method_id and linked to correct account
- [ ] API endpoints filter correctly by method (via account_id)
- [ ] Frontend tab switcher works and shows correct account
- [ ] Rules page displays correct content based on query param
- [ ] Performance metrics calculated correctly per method/account
- [ ] Cache stores and retrieves method-specific data
- [ ] Auto-entry uses method-specific config and account
- [ ] Account reset works per method

## Risk Mitigation

- **Database migration**: 
  - Test on backup database first
  - Use transaction for atomic operations
  - Verify data copy before dropping old table
  - Keep backup of original accounts table
- **Scheduler timing**: Monitor logs to ensure no overlap
- **Cache consistency**: Ensure cache keys don't conflict
- **API compatibility**: Keep backward compatibility for existing endpoints
- **Frontend state**: Ensure method selection persists across page navigation
- **Data integrity**: Verify all positions/predictions linked to correct accounts after migration

## Commit Message Suggestion

```
feat: [BIG UPDATE] Add multi-method paper trading support

- Add method_id to database schema (accounts, predictions, positions, pending_orders, analysis_history)
- Implement staggered scheduler for parallel method execution (ICT: 0/15/30/45m, KimNghia: 7.5/22.5/37.5/52.5m)
- Create separate accounts per method (BTC-ICT: 100U, BTC-KimNghia: 100U)
- Add method configuration and analyzer factory
- Update API endpoints with method filtering
- Add frontend tab switcher for method selection
- Create rules page for Kim Nghia method with query param support

Breaking change: Database migration required (safe, preserves existing data)
```
