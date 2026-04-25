package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// TestnetAccountSnapshot holds the schema definition for the TestnetAccountSnapshot entity.
type TestnetAccountSnapshot struct {
	ent.Schema
}

// Fields of the TestnetAccountSnapshot.
func (TestnetAccountSnapshot) Fields() []ent.Field {
	return []ent.Field{
		field.Int("account_id"),
		field.Float("balance"),
		field.Float("equity"),
		field.Float("unrealized_pnl").
			Default(0),
		field.Float("realized_pnl").
			Default(0),
		field.Int("open_positions_count").
			Default(0),
		field.Time("timestamp").
			Default(time.Now).
			Immutable(),
	}
}

// Edges of the TestnetAccountSnapshot.
func (TestnetAccountSnapshot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("account", TestnetAccount.Type).
			Ref("snapshots").
			Field("account_id").
			Unique().
			Required(),
	}
}

// Indexes of the TestnetAccountSnapshot.
func (TestnetAccountSnapshot) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("account_id", "timestamp"),
	}
}
