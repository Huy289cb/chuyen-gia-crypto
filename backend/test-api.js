// Simple API test script to verify multi-method endpoints
const http = require('http');

const API_BASE = 'http://localhost:3001';

async function testApiEndpoint(endpoint, description) {
  return new Promise((resolve) => {
    const url = `${API_BASE}${endpoint}`;
    console.log(`[Test] Testing: ${description}`);
    console.log(`[Test] URL: ${url}`);
    
    http.get(url, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          console.log(`[Test] Status: ${res.statusCode}`);
          console.log(`[Test] Response: ${JSON.stringify(json, null, 2)}`);
          
          if (res.statusCode === 200 || res.statusCode === 201) {
            console.log(`[Test] ✓ PASS: ${description}`);
          } else {
            console.log(`[Test] ✗ FAIL: ${description} (status ${res.statusCode})`);
          }
          
          resolve({ passed: res.statusCode < 400, status: res.statusCode, data: json });
        } catch (error) {
          console.log(`[Test] ✗ FAIL: ${description} (parse error)`);
          console.log(`[Test] Raw response: ${data}`);
          resolve({ passed: false, error: error.message });
        }
      });
    }).on('error', (error) => {
      console.log(`[Test] ✗ FAIL: ${description} (connection error)`);
      console.log(`[Test] Error: ${error.message}`);
      resolve({ passed: false, error: error.message });
    });
  });
}

async function runApiTests() {
  console.log('[Test] Starting API endpoint tests...\n');
  
  const tests = [
    { endpoint: '/api/analysis?method=ict', description: 'Analysis endpoint with ICT method' },
    { endpoint: '/api/analysis?method=kim_nghia', description: 'Analysis endpoint with Kim Nghia method' },
    { endpoint: '/api/accounts?method=ict', description: 'Accounts endpoint with ICT method' },
    { endpoint: '/api/accounts?method=kim_nghia', description: 'Accounts endpoint with Kim Nghia method' },
    { endpoint: '/api/positions?method=ict', description: 'Positions endpoint with ICT method' },
    { endpoint: '/api/positions?method=kim_nghia', description: 'Positions endpoint with Kim Nghia method' },
    { endpoint: '/api/performance?symbol=BTC&method=ict', description: 'Performance endpoint with ICT method' },
    { endpoint: '/api/performance?symbol=BTC&method=kim_nghia', description: 'Performance endpoint with Kim Nghia method' }
  ];
  
  const results = {};
  
  for (const test of tests) {
    const result = await testApiEndpoint(test.endpoint, test.description);
    results[test.description] = result;
    console.log();
  }
  
  console.log('[Test] API Test Results:');
  console.log('======================');
  for (const [test, result] of Object.entries(results)) {
    const status = result.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`${status}: ${test}`);
  }
  
  const allPassed = Object.values(results).every(r => r.passed === true);
  console.log('\n[Test] Overall:', allPassed ? '✓ ALL API TESTS PASSED' : '✗ SOME API TESTS FAILED');
  
  process.exit(allPassed ? 0 : 1);
}

// Check if backend is running
console.log('[Test] Checking if backend is running...');
http.get(API_BASE, (res) => {
  console.log('[Test] Backend is running, starting API tests...\n');
  runApiTests();
}).on('error', (error) => {
  console.log('[Test] ✗ Backend is not running');
  console.log('[Test] Please start the backend first: cd backend && npm start');
  console.log('[Test] Skipping API tests');
  process.exit(1);
});
