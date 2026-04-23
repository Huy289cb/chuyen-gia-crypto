// Test bias consistency validation for position decisions
import { describe, it, expect } from 'vitest';

// Mock the validation function logic
function validatePositionDecisions(decisions, bias, openPositions) {
  if (!decisions || !Array.isArray(decisions)) return null;
  
  const validActions = ['hold', 'close_early', 'close_partial', 'move_sl', 'reverse'];
  
  // Create position lookup map
  const positionMap = new Map();
  if (openPositions && Array.isArray(openPositions)) {
    openPositions.forEach(pos => {
      positionMap.set(pos.position_id, pos);
    });
  }
  
  return decisions
    .filter(dec => {
      // Required fields
      if (!dec.position_id || !dec.action || !dec.reason) {
        return false;
      }
      
      // Validate action
      if (!validActions.includes(dec.action)) {
        return false;
      }
      
      // Validate confidence
      const confidence = parseFloat(dec.confidence);
      if (isNaN(confidence) || confidence < 0 || confidence > 1) {
        return false;
      }
      
      // Validate optional fields based on action
      if (dec.action === 'close_partial' && (!dec.close_percent || dec.close_percent <= 0 || dec.close_percent > 1)) {
        return false;
      }
      
      if (dec.action === 'move_sl' && !dec.new_sl) {
        return false;
      }
      
      // CRITICAL: Check bias consistency for close_early and reverse actions
      if (dec.action === 'close_early' || dec.action === 'reverse') {
        const position = positionMap.get(dec.position_id);
        if (position) {
          // If bias aligns with position, reject close_early/reverse
          if (bias === 'bullish' && position.side === 'long') {
            dec.action = 'hold';
            dec.reason = 'Auto-corrected: Bias aligns with position direction. Holding position.';
          }
          if (bias === 'bearish' && position.side === 'short') {
            dec.action = 'hold';
            dec.reason = 'Auto-corrected: Bias aligns with position direction. Holding position.';
          }
        }
      }
      
      return true;
    })
    .map(dec => ({
      ...dec,
      confidence: parseFloat(dec.confidence),
      close_percent: dec.close_percent ? parseFloat(dec.close_percent) : null,
      new_sl: dec.new_sl ? parseFloat(dec.new_sl) : null,
      new_tp: dec.new_tp ? parseFloat(dec.new_tp) : null
    }));
}

describe('Bias Consistency Validation', () => {
  it('should auto-correct close_early to hold when bias=bearish and position=short', () => {
    const decisions = [
      {
        position_id: 'pos-1',
        action: 'close_early',
        confidence: 0.9,
        reason: 'Position in slight loss, market showing bearish signs. Better to close early and reassess.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-1',
        side: 'short',
        entry_price: 78386.89
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'bearish', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('hold');
    expect(result[0].reason).toContain('Auto-corrected');
  });

  it('should auto-correct close_early to hold when bias=bullish and position=long', () => {
    const decisions = [
      {
        position_id: 'pos-2',
        action: 'close_early',
        confidence: 0.85,
        reason: 'Taking profit early due to uncertainty.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-2',
        side: 'long',
        entry_price: 75000
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'bullish', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('hold');
    expect(result[0].reason).toContain('Auto-corrected');
  });

  it('should allow close_early when bias changes (bearish bias with long position)', () => {
    const decisions = [
      {
        position_id: 'pos-3',
        action: 'close_early',
        confidence: 0.9,
        reason: 'Bias reversed to bearish, closing long position to avoid further loss.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-3',
        side: 'long',
        entry_price: 75000
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'bearish', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('close_early');
    expect(result[0].reason).not.toContain('Auto-corrected');
  });

  it('should allow close_early when bias changes (bullish bias with short position)', () => {
    const decisions = [
      {
        position_id: 'pos-4',
        action: 'close_early',
        confidence: 0.9,
        reason: 'Bias reversed to bullish, closing short position to avoid further loss.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-4',
        side: 'short',
        entry_price: 78386.89
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'bullish', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('close_early');
    expect(result[0].reason).not.toContain('Auto-corrected');
  });

  it('should allow hold action regardless of bias', () => {
    const decisions = [
      {
        position_id: 'pos-5',
        action: 'hold',
        confidence: 0.8,
        reason: 'Position aligned with bias, holding for target.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-5',
        side: 'short',
        entry_price: 78386.89
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'bearish', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('hold');
    expect(result[0].reason).not.toContain('Auto-corrected');
  });

  it('should auto-correct reverse to hold when bias aligns with position', () => {
    const decisions = [
      {
        position_id: 'pos-6',
        action: 'reverse',
        confidence: 0.9,
        reason: 'Reversing position based on new analysis.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-6',
        side: 'short',
        entry_price: 78386.89
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'bearish', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('hold');
    expect(result[0].reason).toContain('Auto-corrected');
  });

  it('should handle neutral bias without auto-correction', () => {
    const decisions = [
      {
        position_id: 'pos-7',
        action: 'close_early',
        confidence: 0.8,
        reason: 'Market uncertain, closing position.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-7',
        side: 'short',
        entry_price: 78386.89
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'neutral', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('close_early');
    expect(result[0].reason).not.toContain('Auto-corrected');
  });

  it('should handle missing position in map without auto-correction', () => {
    const decisions = [
      {
        position_id: 'pos-unknown',
        action: 'close_early',
        confidence: 0.9,
        reason: 'Closing position.'
      }
    ];
    
    const openPositions = [
      {
        position_id: 'pos-8',
        side: 'short',
        entry_price: 78386.89
      }
    ];
    
    const result = validatePositionDecisions(decisions, 'bearish', openPositions);
    
    expect(result).toHaveLength(1);
    expect(result[0].action).toBe('close_early');
    expect(result[0].reason).not.toContain('Auto-corrected');
  });
});
