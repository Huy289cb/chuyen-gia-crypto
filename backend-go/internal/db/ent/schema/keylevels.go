package schema

import (
	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
)

// KeyLevels holds the schema definition for the KeyLevels entity.
type KeyLevels struct {
	ent.Schema
}

// Fields of the KeyLevels.
func (KeyLevels) Fields() []ent.Field {
	return []ent.Field{
		field.Int("analysis_id"),
		field.String("coin").
			NotEmpty(),
		field.String("level_type").
			NotEmpty(),
		field.Text("description").
			Optional(),
		field.Text("price_levels").
			Optional(),
	}
}

// Edges of the KeyLevels.
func (KeyLevels) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("analysis", AnalysisHistory.Type).
			Ref("key_levels").
			Field("analysis_id").
			Unique().
			Required(),
	}
}
