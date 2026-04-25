package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Position holds the schema definition for the Position entity.
type Position struct {
	ent.Schema
}

// Fields of the Position.
func (Position) Fields() []ent.Field {
	return []ent.Field{
		field.String("position_id").
			Unique().
			NotEmpty(),
		field.Int("account_id"),
		field.String("symbol").
			NotEmpty(),
		field.String("side").
			NotEmpty(),
		field.Float("entry_price"),
		field.Float("current_price").
			Default(0),
		field.Float("stop_loss"),
		field.Float("take_profit"),
		field.Time("entry_time").
			Default(time.Now).
			Immutable(),
		field.String("status").
			Default("open").
			NotEmpty(),
		field.Float("size_usd"),
		field.Float("size_qty"),
		field.Float("risk_usd"),
		field.Float("risk_percent"),
		field.Float("expected_rr"),
		field.Float("realized_pnl").
			Default(0),
		field.Float("unrealized_pnl").
			Default(0),
		field.Float("close_price").
			Optional().
			Nillable(),
		field.Time("close_time").
			Optional().
			Nillable(),
		field.String("close_reason").
			Optional().
			Nillable(),
		field.Int("linked_prediction_id").
			Optional().
			Nillable(),
		field.Float("invalidation_level").
			Optional().
			Nillable(),
		field.Int("tp1_hit").
			Default(0),
		field.Text("ict_strategy").
			Optional(),
		field.Text("tp_levels").
			Optional(),
		field.Int("tp_hit_count").
			Default(0),
		field.Float("partial_closed").
			Default(0),
		field.Float("r_multiple").
			Default(0),
		field.String("method_id").
			Default("ict").
			Optional(),
	}
}

// Edges of the Position.
func (Position) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("account", Account.Type).
			Ref("positions").
			Field("account_id").
			Unique().
			Required(),
		edge.To("events", TradeEvent.Type),
	}
}

// Indexes of the Position.
func (Position) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("account_id"),
		index.Fields("symbol"),
		index.Fields("status"),
		index.Fields("method_id"),
	}
}
