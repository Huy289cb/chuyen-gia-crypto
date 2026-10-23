-- Independent of account/position reset. No FK, account creation, cascade, or billing-price inference.
-- recorded_at is insertion clock, not commit ordering or complete provider coverage proof.
CREATE TABLE public.provider_request_journal (
  request_id text NOT NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT provider_request_journal_pkey PRIMARY KEY (request_id,event_type),
  CONSTRAINT provider_request_journal_id_check CHECK (length(btrim(request_id)) > 0 AND length(request_id) <= 512),
  CONSTRAINT provider_request_journal_type_check CHECK (event_type IN ('llm_provider_request','llm_provider_result')),
  CONSTRAINT provider_request_journal_metadata_check CHECK (jsonb_typeof(metadata) = 'object')
);
CREATE INDEX provider_request_journal_recorded_at_idx ON public.provider_request_journal (recorded_at,request_id,event_type);
