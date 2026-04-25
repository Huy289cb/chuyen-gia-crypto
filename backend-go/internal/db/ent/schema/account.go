package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Account holds the schema definition for the Account entity.
type Account struct {
	ent.Schema
}

// Fields of the Account.
func (Account) Fields() []ent.Field {
	return []ent.Field{
		field.String("symbol").
			NotEmpty(),
		field.String("method_id").
			Default("ict").
			NotEmpty(),
		field.Float("starting_balance").
			Default(100),
		field.Float("current_balance").
			Default(100),
		field.Float("equity").
			Default(100),
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
		field.Time("created_at").
			Default(time.Now).
			Immutable(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

// Edges of the Account.
func (Account) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("positions", Position.Type),
		edge.To("pending_orders", PendingOrder.Type),
		edge.To("snapshots", AccountSnapshot.Type),
	}
}

// Indexes of the Account.
func (Account) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("symbol", "method_id").Unique(),
		index.Fields("method_id"),
	}
}
