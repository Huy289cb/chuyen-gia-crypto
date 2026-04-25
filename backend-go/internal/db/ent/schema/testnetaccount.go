package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// TestnetAccount holds the schema definition for the TestnetAccount entity.
type TestnetAccount struct {
	ent.Schema
}

// Fields of the TestnetAccount.
func (TestnetAccount) Fields() []ent.Field {
	return []ent.Field{
		field.String("symbol").
			NotEmpty(),
		field.String("method_id").
			NotEmpty(),
		field.Float("starting_balance"),
		field.Float("current_balance"),
		field.Float("equity"),
		field.Float("unrealized_pnl").
			Default(0),
		field.Float("realized_pnl").
			Default(0),
		field.Int("total_trades").
			Default(0),
		field.Int("winning_trades").
			Default(0),
		field.Int("losing_trades").
			Default(0),
		field.Float("max_drawdown").
			Default(0),
		field.Int("consecutive_losses").
			Default(0),
		field.Time("last_trade_time").
			Optional().
			Nillable(),
		field.Time("cooldown_until").
			Optional().
			Nillable(),
		field.String("api_key_hash").
			Optional(),
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

// Edges of the TestnetAccount.
func (TestnetAccount) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("positions", TestnetPosition.Type),
		edge.To("pending_orders", TestnetPendingOrder.Type),
		edge.To("snapshots", TestnetAccountSnapshot.Type),
	}
}

// Indexes of the TestnetAccount.
func (TestnetAccount) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("symbol", "method_id").Unique(),
		index.Fields("method_id"),
	}
}
