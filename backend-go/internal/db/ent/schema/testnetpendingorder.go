package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// TestnetPendingOrder holds the schema definition for the TestnetPendingOrder entity.
type TestnetPendingOrder struct {
	ent.Schema
}

// Fields of the TestnetPendingOrder.
func (TestnetPendingOrder) Fields() []ent.Field {
	return []ent.Field{
		field.String("order_id").
			Unique().
			NotEmpty(),
		field.Int("account_id"),
		field.String("symbol").
			NotEmpty(),
		field.String("side").
			NotEmpty(),
		field.Float("entry_price"),
		field.Float("stop_loss"),
		field.Float("take_profit"),
		field.Float("size_usd"),
		field.Float("size_qty"),
		field.Float("risk_usd"),
		field.Float("risk_percent"),
		field.Float("expected_rr"),
		field.Int("linked_prediction_id").
			Optional().
			Nillable(),
		field.Float("invalidation_level").
			Optional().
			Nillable(),
		field.String("method_id").
			Optional(),
		field.String("status").
			Default("pending").
			NotEmpty(),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("executed_at").
			Optional().
			Nillable(),
		field.Float("executed_price").
			Optional().
			Nillable(),
		field.Float("executed_size_qty").
			Optional().
			Nillable(),
		field.Float("executed_size_usd").
			Optional().
			Nillable(),
		field.Float("realized_pnl").
			Optional().
			Nillable(),
		field.Float("realized_pnl_percent").
			Optional().
			Nillable(),
		field.String("close_reason").
			Optional().
			Nillable(),
		field.String("binance_order_id").
			Optional().
			Nillable(),
	}
}

// Edges of the TestnetPendingOrder.
func (TestnetPendingOrder) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("account", TestnetAccount.Type).
			Ref("pending_orders").
			Field("account_id").
			Unique().
			Required(),
	}
}

// Indexes of the TestnetPendingOrder.
func (TestnetPendingOrder) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("account_id"),
		index.Fields("symbol"),
		index.Fields("status"),
	}
}
