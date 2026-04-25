package testnet

import (
	"context"
	"fmt"

	"github.com/adshao/go-binance/v2/futures"
	"github.com/chuyen-gia-crypto/backend/internal/config"
	"github.com/chuyen-gia-crypto/backend/pkg/errors"
	"github.com/chuyen-gia-crypto/backend/pkg/logger"
	"go.uber.org/zap"
)

var (
	testnetClient *futures.Client
)

// Init initializes the Binance Futures Testnet client
func Init() error {
	if !config.AppConfig.Testnet.Enabled {
		logger.Info("Testnet integration disabled")
		return nil
	}

	apiKey := config.AppConfig.Binance.TestnetAPIKey
	apiSecret := config.AppConfig.Binance.TestnetAPISecret

	if apiKey == "" || apiSecret == "" {
		logger.Warn("Testnet API credentials not configured")
		return nil
	}

	// Create testnet client
	testnetClient = futures.NewClient(apiKey, apiSecret)
	testnetClient.BaseURL = config.AppConfig.Testnet.URL

	logger.Info("Binance Futures Testnet client initialized",
		zap.String("url", config.AppConfig.Testnet.URL),
	)

	return nil
}

// GetClient returns the testnet client
func GetClient() *futures.Client {
	return testnetClient
}

// PlaceMarketOrder places a market order on testnet
func PlaceMarketOrder(ctx context.Context, symbol string, side string, quantity float64) (*futures.CreateOrderResponse, error) {
	if testnetClient == nil {
		return nil, errors.NewTradingError("testnet client not initialized", nil)
	}

	logger.Info("Placing market order on testnet",
		zap.String("symbol", symbol),
		zap.String("side", side),
		zap.Float64("quantity", quantity),
	)

	// Convert side string to futures.SideType
	var binanceSide futures.SideType
	if side == "BUY" {
		binanceSide = futures.SideTypeBuy
	} else if side == "SELL" {
		binanceSide = futures.SideTypeSell
	} else {
		return nil, errors.NewValidationError(fmt.Sprintf("invalid side: %s", side))
	}

	order, err := testnetClient.NewCreateOrderService().
		Symbol(symbol).
		Side(binanceSide).
		Type(futures.OrderTypeMarket).
		Quantity(fmt.Sprintf("%.8f", quantity)).
		Do(ctx)

	if err != nil {
		return nil, errors.NewTradingError("failed to place market order", err)
	}

	logger.Info("Market order placed successfully",
		zap.Int64("order_id", order.OrderID),
		zap.String("status", string(order.Status)),
	)

	return order, nil
}

// PlaceLimitOrder places a limit order on testnet
func PlaceLimitOrder(ctx context.Context, symbol string, side string, quantity, price float64) (*futures.CreateOrderResponse, error) {
	if testnetClient == nil {
		return nil, errors.NewTradingError("testnet client not initialized", nil)
	}

	logger.Info("Placing limit order on testnet",
		zap.String("symbol", symbol),
		zap.String("side", side),
		zap.Float64("quantity", quantity),
		zap.Float64("price", price),
	)

	// Convert side string to futures.SideType
	var binanceSide futures.SideType
	if side == "BUY" {
		binanceSide = futures.SideTypeBuy
	} else if side == "SELL" {
		binanceSide = futures.SideTypeSell
	} else {
		return nil, errors.NewValidationError(fmt.Sprintf("invalid side: %s", side))
	}

	order, err := testnetClient.NewCreateOrderService().
		Symbol(symbol).
		Side(binanceSide).
		Type(futures.OrderTypeLimit).
		Quantity(fmt.Sprintf("%.8f", quantity)).
		Price(fmt.Sprintf("%.2f", price)).
		TimeInForce(futures.TimeInForceTypeGTC).
		Do(ctx)

	if err != nil {
		return nil, errors.NewTradingError("failed to place limit order", err)
	}

	logger.Info("Limit order placed successfully",
		zap.Int64("order_id", order.OrderID),
		zap.String("status", string(order.Status)),
	)

	return order, nil
}

// PlaceStopLossOrder places a stop-loss order on testnet
// Note: Simplified to use market order for now, proper stop orders require OCO orders
func PlaceStopLossOrder(ctx context.Context, symbol string, side string, quantity, stopPrice, limitPrice float64) (*futures.CreateOrderResponse, error) {
	if testnetClient == nil {
		return nil, errors.NewTradingError("testnet client not initialized", nil)
	}

	logger.Info("Placing stop-loss order on testnet (using market order)",
		zap.String("symbol", symbol),
		zap.String("side", side),
		zap.Float64("quantity", quantity),
		zap.Float64("stop_price", stopPrice),
	)

	// For now, just place a market order at current price
	// In production, this should use OCO (One-Cancels-Other) orders for proper SL/TP
	return PlaceMarketOrder(ctx, symbol, side, quantity)
}

// CancelOrder cancels an order on testnet
func CancelOrder(ctx context.Context, symbol string, orderID int64) error {
	if testnetClient == nil {
		return errors.NewTradingError("testnet client not initialized", nil)
	}

	logger.Info("Cancelling order on testnet",
		zap.String("symbol", symbol),
		zap.Int64("order_id", orderID),
	)

	_, err := testnetClient.NewCancelOrderService().
		Symbol(symbol).
		OrderID(orderID).
		Do(ctx)

	if err != nil {
		return errors.NewTradingError("failed to cancel order", err)
	}

	logger.Info("Order cancelled successfully",
		zap.Int64("order_id", orderID),
	)

	return nil
}

// GetOrderStatus gets the status of an order on testnet
func GetOrderStatus(ctx context.Context, symbol string, orderID int64) (*futures.Order, error) {
	if testnetClient == nil {
		return nil, errors.NewTradingError("testnet client not initialized", nil)
	}

	order, err := testnetClient.NewGetOrderService().
		Symbol(symbol).
		OrderID(orderID).
		Do(ctx)

	if err != nil {
		return nil, errors.NewTradingError("failed to get order status", err)
	}

	return order, nil
}

// GetOpenPositions gets all open positions on testnet
func GetOpenPositions(ctx context.Context) ([]*futures.PositionRisk, error) {
	if testnetClient == nil {
		return nil, errors.NewTradingError("testnet client not initialized", nil)
	}

	positions, err := testnetClient.NewGetPositionRiskService().Do(ctx)
	if err != nil {
		return nil, errors.NewTradingError("failed to get open positions", err)
	}

	// Filter only positions with non-zero position amount
	openPositions := make([]*futures.PositionRisk, 0)
	for _, pos := range positions {
		if pos.PositionAmt != "0" {
			openPositions = append(openPositions, pos)
		}
	}

	return openPositions, nil
}

// GetAccountBalance gets the account balance on testnet
func GetAccountBalance(ctx context.Context) (*futures.Account, error) {
	if testnetClient == nil {
		return nil, errors.NewTradingError("testnet client not initialized", nil)
	}

	account, err := testnetClient.NewGetAccountService().Do(ctx)
	if err != nil {
		return nil, errors.NewTradingError("failed to get account balance", err)
	}

	return account, nil
}

// ClosePosition closes a position on testnet
func ClosePosition(ctx context.Context, symbol string, side string, quantity float64) (*futures.CreateOrderResponse, error) {
	if testnetClient == nil {
		return nil, errors.NewTradingError("testnet client not initialized", nil)
	}

	logger.Info("Closing position on testnet",
		zap.String("symbol", symbol),
		zap.String("side", side),
		zap.Float64("quantity", quantity),
	)

	// Close position by placing opposite market order
	var closeSide string
	if side == "long" {
		closeSide = "SELL"
	} else {
		closeSide = "BUY"
	}

	order, err := PlaceMarketOrder(ctx, symbol, closeSide, quantity)
	if err != nil {
		return nil, errors.NewTradingError("failed to close position", err)
	}

	logger.Info("Position closed successfully",
		zap.Int64("order_id", order.OrderID),
	)

	return order, nil
}
