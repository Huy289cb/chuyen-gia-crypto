package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AnalysisHistory holds the schema definition for the AnalysisHistory entity.
type AnalysisHistory struct {
	ent.Schema
}

// Fields of the AnalysisHistory.
func (AnalysisHistory) Fields() []ent.Field {
	return []ent.Field{
		field.String("coin").
			NotEmpty(),
		field.Time("timestamp").
			Default(time.Now).
			Immutable(),
		field.Float("current_price"),
		field.String("bias").
			NotEmpty(),
		field.String("action").
			NotEmpty(),
		field.Float("confidence"),
		field.Text("narrative").
			Optional(),
		field.Text("comparison").
			Optional(),
		field.Text("market_sentiment").
			Optional(),
		field.Text("disclaimer").
			Optional(),
		field.String("method_id").
			Default("ict").
			NotEmpty(),
		field.Text("breakout_retest").
			Optional(),
		field.Text("position_decisions").
			Optional(),
		field.Text("alternative_scenario").
			Optional(),
		field.Float("suggested_entry").
			Optional(),
		field.Float("suggested_stop_loss").
			Optional(),
		field.Float("suggested_take_profit").
			Optional(),
		field.Float("expected_rr").
			Optional(),
		field.Float("invalidation_level").
			Optional(),
		field.Text("raw_question").
			Optional(),
		field.Text("raw_answer").
			Optional(),
	}
}

// Edges of the AnalysisHistory.
func (AnalysisHistory) Edges() []ent.Edge {
	return []ent.Edge{
		edge.To("predictions", Prediction.Type),
		edge.To("key_levels", KeyLevels.Type),
	}
}

// Indexes of the AnalysisHistory.
func (AnalysisHistory) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("coin", "timestamp"),
		index.Fields("method_id"),
	}
}
