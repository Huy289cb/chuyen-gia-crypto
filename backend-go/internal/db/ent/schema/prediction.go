package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// Prediction holds the schema definition for the Prediction entity.
type Prediction struct {
	ent.Schema
}

// Fields of the Prediction.
func (Prediction) Fields() []ent.Field {
	return []ent.Field{
		field.Int("analysis_id"),
		field.String("coin").
			NotEmpty(),
		field.String("timeframe").
			NotEmpty(),
		field.String("direction").
			NotEmpty(),
		field.Float("target_price").
			Optional(),
		field.Float("confidence").
			Optional(),
		field.Time("predicted_at").
			Default(time.Now).
			Immutable(),
		field.Time("expires_at").
			Optional(),
		field.Float("actual_price").
			Optional(),
		field.Float("accuracy").
			Optional(),
		field.Bool("is_correct").
			Optional(),
		field.String("outcome").
			Optional(),
		field.Float("pnl").
			Default(0),
		field.Int("hit_tp").
			Default(0),
		field.Int("hit_sl").
			Default(0),
		field.Int("linked_position_id").
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
		field.Text("reason_summary").
			Optional(),
		field.String("model_version").
			Default("1.0"),
		field.String("method_id").
			Default("ict").
			Optional(),
	}
}

// Edges of the Prediction.
func (Prediction) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("analysis", AnalysisHistory.Type).
			Ref("predictions").
			Field("analysis_id").
			Unique().
			Required(),
	}
}

// Indexes of the Prediction.
func (Prediction) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("coin", "predicted_at"),
		index.Fields("method_id"),
		index.Fields("linked_position_id"),
	}
}
