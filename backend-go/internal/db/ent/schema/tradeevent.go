package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// TradeEvent holds the schema definition for the TradeEvent entity.
type TradeEvent struct {
	ent.Schema
}

// Fields of the TradeEvent.
func (TradeEvent) Fields() []ent.Field {
	return []ent.Field{
		field.Int("position_id"),
		field.String("event_type").
			NotEmpty(),
		field.Text("event_data").
			Optional(),
		field.Time("timestamp").
			Default(time.Now).
			Immutable(),
	}
}

// Edges of the TradeEvent.
func (TradeEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("position", Position.Type).
			Ref("events").
			Field("position_id").
			Unique().
			Required(),
	}
}
