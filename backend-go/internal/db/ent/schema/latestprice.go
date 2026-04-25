package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/field"
)

// LatestPrice holds the schema definition for the LatestPrice entity.
type LatestPrice struct {
	ent.Schema
}

// Fields of the LatestPrice.
func (LatestPrice) Fields() []ent.Field {
	return []ent.Field{
		field.String("coin").
			Unique().
			NotEmpty(),
		field.Float("price"),
		field.Float("change_24h").
			Optional(),
		field.Float("change_7d").
			Optional(),
		field.Float("market_cap").
			Optional(),
		field.Float("volume_24h").
			Optional(),
		field.Time("updated_at").
			Default(time.Now).
			UpdateDefault(time.Now),
	}
}

// Edges of the LatestPrice.
func (LatestPrice) Edges() []ent.Edge {
	return nil
}
