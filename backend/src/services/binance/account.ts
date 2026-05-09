/**
 * Binance Futures Account Module
 * 
 * Account-related endpoints for Binance Futures
 */

import { get } from './client';
import { endpoints } from './endpoints';

interface AccountInfo {
  feeTier: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  updateTime: number;
  totalInitialMargin: number;
  totalMaintMargin: number;
  totalWalletBalance: number;
  totalUnrealizedProfit: number;
  totalMarginBalance: number;
  totalPositionInitialMargin: number;
  totalOpenOrderInitialMargin: number;
  maxWithdrawAmount: number;
  assets: Array<{
    asset: string;
    walletBalance: number;
    unrealizedProfit: number;
  }>;
  positions: Array<{
    symbol: string;
    positionAmt: number;
    entryPrice: number;
    markPrice: number;
    unRealizedProfit: number;
    liquidationPrice: number;
    leverage: number;
    maxNotionalValue: number;
    marginType: string;
    isolatedMargin: number;
    isAutoAddMargin: boolean;
    positionSide: string;
    notional: number;
    isolatedWallet: number;
  }>;
}

interface BalanceInfo {
  walletBalance: number;
  availableBalance: number;
  crossWalletBalance: number;
  crossUnPnl: number;
  maxWithdrawAmount: number;
  totalWalletBalance: number;
  totalAvailableBalance: number;
  totalUnrealizedProfit: number;
  balances: Array<{
    asset: string;
    balance: number;
    availableBalance: number;
    crossWalletBalance: number;
    crossUnPnl: number;
    maxWithdrawAmount: number;
  }>;
}

interface PositionRisk {
  symbol: string;
  positionAmt: number;
  entryPrice: number;
  markPrice: number;
  unRealizedProfit: number;
  liquidationPrice: number;
  leverage: number;
  maxNotionalValue: number;
  marginType: string;
  isolatedMargin: number;
  isAutoAddMargin: boolean;
  positionSide: string;
  notional: number;
  isolatedWallet: number;
}

/**
 * Get account information
 * @returns {Promise<object>} Account information
 */
export async function getAccount(): Promise<AccountInfo> {
  try {
    const response: any = await get(endpoints.ACCOUNT, {}, true);
    
    return {
      feeTier: response.feeTier,
      canTrade: response.canTrade,
      canWithdraw: response.canWithdraw,
      canDeposit: response.canDeposit,
      updateTime: response.updateTime,
      totalInitialMargin: parseFloat(response.totalInitialMargin),
      totalMaintMargin: parseFloat(response.totalMaintMargin),
      totalWalletBalance: parseFloat(response.totalWalletBalance),
      totalUnrealizedProfit: parseFloat(response.totalUnrealizedProfit),
      totalMarginBalance: parseFloat(response.totalMarginBalance),
      totalPositionInitialMargin: parseFloat(response.totalPositionInitialMargin),
      totalOpenOrderInitialMargin: parseFloat(response.totalOpenOrderInitialMargin),
      maxWithdrawAmount: parseFloat(response.maxWithdrawAmount),
      assets: response.assets.map((asset: any) => ({
        asset: asset.asset,
        walletBalance: parseFloat(asset.walletBalance),
        unrealizedProfit: parseFloat(asset.unrealizedProfit),
      })),
      positions: response.positions.map((pos: any) => ({
        symbol: pos.symbol,
        positionAmt: parseFloat(pos.positionAmt),
        entryPrice: parseFloat(pos.entryPrice),
        markPrice: parseFloat(pos.markPrice),
        unRealizedProfit: parseFloat(pos.unRealizedProfit),
        liquidationPrice: parseFloat(pos.liquidationPrice),
        leverage: parseInt(pos.leverage),
        maxNotionalValue: parseFloat(pos.maxNotionalValue),
        marginType: pos.marginType,
        isolatedMargin: parseFloat(pos.isolatedMargin),
        isAutoAddMargin: pos.isAutoAddMargin === 'true',
        positionSide: pos.positionSide,
        notional: parseFloat(pos.notional),
        isolatedWallet: parseFloat(pos.isolatedWallet),
      })),
    };
  } catch (error: any) {
    console.error('[BinanceAccount] Failed to get account:', error.message);
    throw error;
  }
}

/**
 * Get account balance
 * @returns {Promise<object>} Balance information
 */
export async function getBalance(): Promise<BalanceInfo> {
  try {
    const response: any = await get(endpoints.BALANCE, {}, true);
    
    // Find USDT balance
    const usdtBalance = response.find((asset: any) => asset.asset === 'USDT');
    
    // Calculate total wallet balance across all assets
    const totalWalletBalance = response.reduce((sum: number, b: any) => sum + parseFloat(b.balance || 0), 0);
    const totalAvailableBalance = response.reduce((sum: number, b: any) => sum + parseFloat(b.availableBalance || 0), 0);
    
    return {
      // USDT specific
      walletBalance: parseFloat(usdtBalance?.balance || 0),
      availableBalance: parseFloat(usdtBalance?.availableBalance || 0),
      crossWalletBalance: parseFloat(usdtBalance?.crossWalletBalance || 0),
      crossUnPnl: parseFloat(usdtBalance?.crossUnPnl || 0),
      maxWithdrawAmount: parseFloat(usdtBalance?.maxWithdrawAmount || 0),
      
      // Total across all assets
      totalWalletBalance: totalWalletBalance,
      totalAvailableBalance: totalAvailableBalance,
      totalUnrealizedProfit: response.reduce((sum: number, b: any) => sum + parseFloat(b.crossUnPnl || 0), 0),
      
      // All balances
      balances: response.map((b: any) => ({
        asset: b.asset,
        balance: parseFloat(b.balance || 0),
        availableBalance: parseFloat(b.availableBalance || 0),
        crossWalletBalance: parseFloat(b.crossWalletBalance || 0),
        crossUnPnl: parseFloat(b.crossUnPnl || 0),
        maxWithdrawAmount: parseFloat(b.maxWithdrawAmount || 0),
      })),
    };
  } catch (error: any) {
    console.error('[BinanceAccount] Failed to get balance:', error.message);
    throw error;
  }
}

/**
 * Get position risk information
 * @param {string} symbol - Trading symbol (optional)
 * @returns {Promise<Array>} Position risk data
 */
export async function getPositionRisk(symbol: string | null = null): Promise<PositionRisk[]> {
  try {
    const params = symbol ? { symbol } : {};
    const response: any = await get(endpoints.POSITION_RISK, params, true);
    
    return response.map((pos: any) => ({
      symbol: pos.symbol,
      positionAmt: parseFloat(pos.positionAmt),
      entryPrice: parseFloat(pos.entryPrice),
      markPrice: parseFloat(pos.markPrice),
      unRealizedProfit: parseFloat(pos.unRealizedProfit),
      liquidationPrice: parseFloat(pos.liquidationPrice),
      leverage: parseInt(pos.leverage),
      maxNotionalValue: parseFloat(pos.maxNotionalValue),
      marginType: pos.marginType,
      isolatedMargin: parseFloat(pos.isolatedMargin),
      isAutoAddMargin: pos.isAutoAddMargin === 'true',
      positionSide: pos.positionSide,
      notional: parseFloat(pos.notional),
      isolatedWallet: parseFloat(pos.isolatedWallet),
    }));
  } catch (error: any) {
    console.error('[BinanceAccount] Failed to get position risk:', error.message);
    throw error;
  }
}

/**
 * Get current position for a symbol
 * @param {string} symbol - Trading symbol
 * @returns {Promise<object|null>} Position data or null if no position
 */
export async function getCurrentPosition(symbol: string): Promise<PositionRisk | null> {
  try {
    const positions = await getPositionRisk(symbol);
    
    // Find position with non-zero quantity
    const position = positions.find(pos => parseFloat(String(pos.positionAmt)) !== 0);
    
    if (!position) {
      return null;
    }
    
    return position;
  } catch (error: any) {
    console.error('[BinanceAccount] Failed to get current position:', error.message);
    throw error;
  }
}
