package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// PriceHistory holds the schema definition for the PriceHistory entity.
type PriceHistory struct {
	ent.Schema
}

// Fields of the PriceHistory.
func (PriceHistory) Fields() []ent.Field {
	return []ent.Field{
		field.String("coin").
			NotEmpty(),
		field.Float("price"),
		field.Time("timestamp").
			Default(time.Now).
			Immutable(),
	}
}

// Edges of the PriceHistory.
func (PriceHistory) Edges() []ent.Edge {
	return nil
}

// Indexes of the PriceHistory.
func (PriceHistory) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("coin", "timestamp"),
	}
}
