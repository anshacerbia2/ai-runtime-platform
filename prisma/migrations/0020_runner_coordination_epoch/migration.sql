BEGIN;

CREATE TABLE control.runner_coordination (
  id integer PRIMARY KEY CHECK (id = 1),
  epoch integer NOT NULL CHECK (epoch > 0 AND epoch < 2147483646),
  state text NOT NULL CHECK (state IN ('ACTIVE', 'PAUSED')),
  marker uuid,
  revision integer NOT NULL CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT runner_coordination_active_marker
    CHECK (state <> 'ACTIVE' OR marker IS NOT NULL)
);

INSERT INTO control.runner_coordination (id, epoch, state, marker, revision)
VALUES (1, 1, 'PAUSED', NULL, 1);

COMMIT;
