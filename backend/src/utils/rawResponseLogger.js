const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(process.cwd(), 'logs', 'raw-responses');
const MAX_DAYS = 7;

/**
 * Ensure log directory exists
 */
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}

/**
 * Log raw response to daily file
 * @param {string} content - Raw response content
 * @param {string} prefix - File prefix (default: 'raw-response')
 */
export function logRawResponse(content, prefix = 'raw-response') {
  try {
    ensureLogDir();
    
    const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `${prefix}-${date}-${timestamp}.txt`;
    const filePath = path.join(LOG_DIR, fileName);
    
    fs.writeFileSync(filePath, content, 'utf8');
    console.log(`[RawResponseLogger] Logged to: ${fileName}`);
  } catch (error) {
    console.error('[RawResponseLogger] Failed to log raw response:', error.message);
  }
}

/**
 * Clean up old log files older than specified days
 * @param {number} days - Number of days to keep (default: 7)
 */
export function cleanupOldLogs(days = MAX_DAYS) {
  try {
    if (!fs.existsSync(LOG_DIR)) {
      console.log('[RawResponseLogger] Log directory does not exist, skipping cleanup');
      return;
    }
    
    const files = fs.readdirSync(LOG_DIR);
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - days);
    
    let deletedCount = 0;
    
    for (const file of files) {
      const filePath = path.join(LOG_DIR, file);
      const stats = fs.statSync(filePath);
      
      if (stats.mtime < cutoffDate) {
        fs.unlinkSync(filePath);
        deletedCount++;
        console.log(`[RawResponseLogger] Deleted old log: ${file}`);
      }
    }
    
    console.log(`[RawResponseLogger] Cleanup complete: deleted ${deletedCount} files older than ${days} days`);
  } catch (error) {
    console.error('[RawResponseLogger] Failed to cleanup old logs:', error.message);
  }
}

/**
 * Get log directory path
 */
export function getLogDir() {
  return LOG_DIR;
}
