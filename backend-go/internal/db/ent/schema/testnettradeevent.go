package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// TestnetTradeEvent holds the schema definition for the TestnetTradeEvent entity.
type TestnetTradeEvent struct {
	ent.Schema
}

// Fields of the TestnetTradeEvent.
func (TestnetTradeEvent) Fields() []ent.Field {
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

// Edges of the TestnetTradeEvent.
func (TestnetTradeEvent) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("position", TestnetPosition.Type).
			Ref("events").
			Field("position_id").
			Unique().
			Required(),
	}
}
