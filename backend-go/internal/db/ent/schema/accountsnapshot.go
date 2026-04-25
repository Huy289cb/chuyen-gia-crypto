package schema

import (
	"time"

	"entgo.io/ent"
	"entgo.io/ent/schema/edge"
	"entgo.io/ent/schema/field"
	"entgo.io/ent/schema/index"
)

// AccountSnapshot holds the schema definition for the AccountSnapshot entity.
type AccountSnapshot struct {
	ent.Schema
}

// Fields of the AccountSnapshot.
func (AccountSnapshot) Fields() []ent.Field {
	return []ent.Field{
		field.Int("account_id"),
		field.Float("balance"),
		field.Float("equity"),
		field.Float("unrealized_pnl").
			Default(0),
		field.Int("open_positions").
			Default(0),
		field.Time("timestamp").
			Default(time.Now).
			Immutable(),
	}
}

// Edges of the AccountSnapshot.
func (AccountSnapshot) Edges() []ent.Edge {
	return []ent.Edge{
		edge.From("account", Account.Type).
			Ref("snapshots").
			Field("account_id").
			Unique().
			Required(),
	}
}

// Indexes of the AccountSnapshot.
func (AccountSnapshot) Indexes() []ent.Index {
	return []ent.Index{
		index.Fields("account_id", "timestamp"),
	}
}
