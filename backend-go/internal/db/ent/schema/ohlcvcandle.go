package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// OHLCVCandle holds the schema definition for the OHLCVCandle entity.
type OHLCVCandle struct {
	ent.Schema
}

// Fields of the OHLCVCandle.
func (OHLCVCandle) Fields() []ent.Field {
	return []ent.Field{
		field.String("coin").
			NotEmpty(),
		field.Time("timestamp").
			Nillable().
			Immutable(),
		field.Float("open"),
		field.Float("high"),
		field.Float("low"),
		field.Float("close"),
		field.Float("volume").
			Optional(),
		field.String("timeframe").
			Default("15m").
			NotEmpty(),
	}
}

// Edges of the OHLCVCandle.
func (OHLCVCandle) Edges() []ent.Edge {
	return nil
}

// Indexes of the OHLCVCandle.
func (OHLCVCandle) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("coin", "timestamp"),
		index.Fields("coin", "timeframe", "timestamp"),
	}
}
